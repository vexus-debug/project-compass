import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ───────────────────────────────────────────────────────────
interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }
type Timeframe = "1" | "5" | "15" | "60" | "240" | "D" | "W";

const SCAN_TIMEFRAMES: Timeframe[] = ["5", "15", "60", "240", "D", "W"];
const ALL_TIMEFRAMES: Timeframe[] = ["1", "5", "15", "60", "240", "D", "W"];
const TOP_SYMBOLS = 30; // reduced for server perf
const BATCH_SIZE = 6;

// ─── Bybit API helpers ──────────────────────────────────────────────
async function bybitFetch(path: string) {
  const res = await fetch(`https://api.bybit.com${path}`);
  if (!res.ok) throw new Error(`Bybit ${res.status}`);
  return res.json();
}

async function fetchTickers(cat: "spot" | "linear") {
  return bybitFetch(`/v5/market/tickers?category=${cat}`);
}

async function fetchKlines(symbol: string, tf: Timeframe, cat: "spot" | "linear", limit = 220): Promise<Candle[]> {
  const data = await bybitFetch(`/v5/market/kline?category=${cat}&symbol=${symbol}&interval=${tf}&limit=${limit}`);
  if (data.retCode !== 0 || !data.result?.list) return [];
  return data.result.list
    .map((k: string[]) => ({ time: parseInt(k[0]), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }))
    .reverse();
}

// ─── Indicator Functions (self-contained) ───────────────────────────

function calculateSMA(data: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) sma.push(NaN);
    else { let s = 0; for (let j = i - period + 1; j <= i; j++) s += data[j]; sma.push(s / period); }
  }
  return sma;
}

function calculateEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  if (!data.length) return ema;
  const k = 2 / (period + 1);
  ema[0] = data[0];
  for (let i = 1; i < data.length; i++) ema[i] = data[i] * k + ema[i - 1] * (1 - k);
  return ema;
}

function calculateDEMA(data: number[], period: number): number[] {
  const e1 = calculateEMA(data, period), e2 = calculateEMA(e1, period);
  return e1.map((v, i) => 2 * v - e2[i]);
}

function calculateVWAP(candles: Candle[]): number {
  let cv = 0, ct = 0;
  for (const c of candles) { const tp = (c.high + c.low + c.close) / 3; ct += tp * c.volume; cv += c.volume; }
  return cv === 0 ? candles[candles.length - 1].close : ct / cv;
}

function calculateLinearRegression(closes: number[], period = 50) {
  const data = closes.slice(-period), n = data.length;
  if (n < 5) return { slope: 0, intercept: 0, rSquared: 0, upper: 0, lower: 0, value: 0 };
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += data[i]; sxy += i * data[i]; sx2 += i * i; }
  const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
  const intercept = (sy - slope * sx) / n;
  const value = slope * (n - 1) + intercept;
  const meanY = sy / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) { ssTot += (data[i] - meanY) ** 2; ssRes += (data[i] - (slope * i + intercept)) ** 2; }
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const stdErr = Math.sqrt(ssRes / (n - 2));
  return { slope, intercept, rSquared, upper: value + 2 * stdErr, lower: value - 2 * stdErr, value };
}

function calculateTR(candles: Candle[]): number[] {
  const tr = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], pc = candles[i - 1].close;
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)));
  }
  return tr;
}

function smoothedAvg(data: number[], period: number): number[] {
  const r: number[] = []; let s = 0;
  for (let i = 0; i < data.length; i++) {
    if (i < period) { s += data[i]; r.push(s / (i + 1)); }
    else r.push((r[i - 1] * (period - 1) + data[i]) / period);
  }
  return r;
}

function calculateATR(candles: Candle[], period = 14): number {
  const a = smoothedAvg(calculateTR(candles), period);
  return a[a.length - 1] || 0;
}

function calculateADX(candles: Candle[], period = 14) {
  if (candles.length < period + 1) return { adx: 0, plusDI: 0, minusDI: 0 };
  const pDM = [0], mDM = [0];
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high, dn = candles[i - 1].low - candles[i].low;
    pDM.push(up > dn && up > 0 ? up : 0); mDM.push(dn > up && dn > 0 ? dn : 0);
  }
  const tr = calculateTR(candles), sTR = smoothedAvg(tr, period), sPDM = smoothedAvg(pDM, period), sMDM = smoothedAvg(mDM, period);
  const dx: number[] = []; let lp = 0, lm = 0;
  for (let i = 0; i < sTR.length; i++) {
    if (sTR[i] === 0) { dx.push(0); continue; }
    lp = (sPDM[i] / sTR[i]) * 100; lm = (sMDM[i] / sTR[i]) * 100;
    const ds = lp + lm; dx.push(ds === 0 ? 0 : (Math.abs(lp - lm) / ds) * 100);
  }
  const adx = smoothedAvg(dx, period);
  return { adx: adx[adx.length - 1] || 0, plusDI: lp, minusDI: lm };
}

function calculateParabolicSAR(candles: Candle[], afStart = 0.02, afStep = 0.02, afMax = 0.2) {
  if (candles.length < 3) return { sar: candles[0]?.low ?? 0, direction: "bull" as const };
  let bull = true, sar = candles[0].low, ep = candles[0].high, af = afStart;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1], curr = candles[i];
    sar = sar + af * (ep - sar);
    if (bull) {
      sar = Math.min(sar, prev.low, i >= 2 ? candles[i - 2].low : prev.low);
      if (curr.low < sar) { bull = false; sar = ep; ep = curr.low; af = afStart; }
      else if (curr.high > ep) { ep = curr.high; af = Math.min(af + afStep, afMax); }
    } else {
      sar = Math.max(sar, prev.high, i >= 2 ? candles[i - 2].high : prev.high);
      if (curr.high > sar) { bull = true; sar = ep; ep = curr.high; af = afStart; }
      else if (curr.low < ep) { ep = curr.low; af = Math.min(af + afStep, afMax); }
    }
  }
  return { sar, direction: bull ? "bull" as const : "bear" as const };
}

function calculateSupertrend(candles: Candle[], period = 10, multiplier = 3) {
  const atrV = calculateTR(candles), atrS = smoothedAvg(atrV, period);
  let ub = 0, lb = 0, st = 0, dir: "bull" | "bear" = "bull";
  for (let i = period; i < candles.length; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2, atr = atrS[i];
    const bu = hl2 + multiplier * atr, bl = hl2 - multiplier * atr;
    ub = bu < ub || candles[i - 1].close > ub ? bu : ub;
    lb = bl > lb || candles[i - 1].close < lb ? bl : lb;
    st = st === ub ? (candles[i].close > ub ? lb : ub) : (candles[i].close < lb ? ub : lb);
    dir = candles[i].close > st ? "bull" : "bear";
  }
  return { value: st, direction: dir };
}

function calculateIchimoku(candles: Candle[], tp = 9, kp = 26, sp = 52) {
  const hl = (s: number, e: number) => { let h = -Infinity, l = Infinity; for (let i = s; i <= e; i++) { if (candles[i].high > h) h = candles[i].high; if (candles[i].low < l) l = candles[i].low; } return (h + l) / 2; };
  const len = candles.length;
  if (len < sp + kp) return { tenkan: 0, kijun: 0, senkouA: 0, senkouB: 0, chikouVsPrice: 0, cloudDirection: "neutral" as const, priceVsCloud: "inside" as const };
  const tenkan = hl(len - tp, len - 1), kijun = hl(len - kp, len - 1);
  const senkouA = (tenkan + kijun) / 2, senkouB = hl(len - sp, len - 1);
  const price = candles[len - 1].close;
  const chikouVsPrice = len > kp ? price - candles[len - kp].close : 0;
  const ct = Math.max(senkouA, senkouB), cb = Math.min(senkouA, senkouB);
  return { tenkan, kijun, senkouA, senkouB, chikouVsPrice, cloudDirection: senkouA > senkouB ? "bull" as const : senkouA < senkouB ? "bear" as const : "neutral" as const, priceVsCloud: price > ct ? "above" as const : price < cb ? "below" as const : "inside" as const };
}

function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  let ag = g / period, al = l / period;
  for (let i = period + 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period; al = (al * (period - 1) + (d < 0 ? -d : 0)) / period; }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function calculateMACD(closes: number[], fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return { macd: 0, signal: 0, histogram: 0 };
  const ef = calculateEMA(closes, fast), es = calculateEMA(closes, slow);
  const ml = ef.map((v, i) => v - es[i]);
  const sl = calculateEMA(ml.slice(slow - 1), signal);
  const mv = ml[ml.length - 1], sv = sl[sl.length - 1];
  return { macd: mv, signal: sv, histogram: mv - sv };
}

function calculateStochastic(candles: Candle[], kP = 14, dP = 3) {
  if (candles.length < kP + dP) return { k: 50, d: 50 };
  const kV: number[] = [];
  for (let i = kP - 1; i < candles.length; i++) {
    let h = -Infinity, l = Infinity;
    for (let j = i - kP + 1; j <= i; j++) { if (candles[j].high > h) h = candles[j].high; if (candles[j].low < l) l = candles[j].low; }
    const r = h - l; kV.push(r === 0 ? 50 : ((candles[i].close - l) / r) * 100);
  }
  const dV: number[] = [];
  for (let i = dP - 1; i < kV.length; i++) { let s = 0; for (let j = i - dP + 1; j <= i; j++) s += kV[j]; dV.push(s / dP); }
  return { k: kV[kV.length - 1], d: dV[dV.length - 1] };
}

function calculateStochRSI(closes: number[], rsiP = 14, stochP = 14, kS = 3, dS = 3) {
  if (closes.length < rsiP + stochP + kS) return { k: 50, d: 50 };
  const rs: number[] = [];
  for (let end = rsiP + 1; end <= closes.length; end++) rs.push(calculateRSI(closes.slice(0, end), rsiP));
  if (rs.length < stochP) return { k: 50, d: 50 };
  const sv: number[] = [];
  for (let i = stochP - 1; i < rs.length; i++) {
    let h = -Infinity, l = Infinity;
    for (let j = i - stochP + 1; j <= i; j++) { if (rs[j] > h) h = rs[j]; if (rs[j] < l) l = rs[j]; }
    const r = h - l; sv.push(r === 0 ? 50 : ((rs[i] - l) / r) * 100);
  }
  const kk = calculateEMA(sv, kS), dd = calculateEMA(kk, dS);
  return { k: kk[kk.length - 1], d: dd[dd.length - 1] };
}

function calculateWilliamsR(candles: Candle[], period = 14): number {
  if (candles.length < period) return -50;
  const r = candles.slice(-period);
  let h = -Infinity, l = Infinity;
  for (const c of r) { if (c.high > h) h = c.high; if (c.low < l) l = c.low; }
  const rng = h - l; return rng === 0 ? -50 : ((h - candles[candles.length - 1].close) / rng) * -100;
}

function calculateCCI(candles: Candle[], period = 20): number {
  if (candles.length < period) return 0;
  const r = candles.slice(-period), tps = r.map(c => (c.high + c.low + c.close) / 3);
  const m = tps.reduce((s, v) => s + v, 0) / period;
  const md = tps.reduce((s, v) => s + Math.abs(v - m), 0) / period;
  return md === 0 ? 0 : (tps[tps.length - 1] - m) / (0.015 * md);
}

function calculateROC(closes: number[], period = 12): number {
  if (closes.length <= period) return 0;
  const p = closes[closes.length - 1 - period];
  return p === 0 ? 0 : ((closes[closes.length - 1] - p) / p) * 100;
}

function calculateMFI(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50;
  let pf = 0, nf = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    const pt = (candles[i - 1].high + candles[i - 1].low + candles[i - 1].close) / 3;
    const mf = tp * candles[i].volume;
    if (tp > pt) pf += mf; else if (tp < pt) nf += mf;
  }
  return nf === 0 ? 100 : 100 - 100 / (1 + pf / nf);
}

function calculateCMF(candles: Candle[], period = 20): number {
  if (candles.length < period) return 0;
  const r = candles.slice(-period);
  let ms = 0, vs = 0;
  for (const c of r) { const rng = c.high - c.low; const mfm = rng === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / rng; ms += mfm * c.volume; vs += c.volume; }
  return vs === 0 ? 0 : ms / vs;
}

function calculateTSI(closes: number[], lp = 25, sp = 13): number {
  if (closes.length < lp + sp + 1) return 0;
  const mom: number[] = []; for (let i = 1; i < closes.length; i++) mom.push(closes[i] - closes[i - 1]);
  const am = mom.map(Math.abs);
  const sm2 = calculateEMA(calculateEMA(mom, lp), sp);
  const sa2 = calculateEMA(calculateEMA(am, lp), sp);
  const d = sa2[sa2.length - 1];
  return d === 0 ? 0 : (sm2[sm2.length - 1] / d) * 100;
}

function calculateBollingerBands(closes: number[], period = 20, stdDev = 2) {
  if (closes.length < period) { const p = closes[closes.length - 1] || 0; return { upper: p, middle: p, lower: p, bandwidth: 0, percentB: 0.5, squeeze: false }; }
  const r = closes.slice(-period), mid = r.reduce((s, v) => s + v, 0) / period;
  const sd = Math.sqrt(r.reduce((s, v) => s + (v - mid) ** 2, 0) / period);
  const u = mid + stdDev * sd, l = mid - stdDev * sd, bw = mid === 0 ? 0 : (u - l) / mid;
  const price = closes[closes.length - 1], rng = u - l;
  return { upper: u, middle: mid, lower: l, bandwidth: bw, percentB: rng === 0 ? 0.5 : (price - l) / rng, squeeze: bw < 0.04 };
}

function calculateKeltnerChannels(candles: Candle[], emaPeriod = 20, atrPeriod = 10, multiplier = 1.5) {
  const closes = candles.map(c => c.close), ev = calculateEMA(closes, emaPeriod);
  const mid = ev[ev.length - 1], atr = calculateATR(candles, atrPeriod);
  return { upper: mid + multiplier * atr, middle: mid, lower: mid - multiplier * atr };
}

function calculateDonchianChannels(candles: Candle[], period = 20) {
  if (candles.length < period) { const p = candles[candles.length - 1]?.close || 0; return { upper: p, lower: p, middle: p, breakoutUp: false, breakoutDown: false }; }
  const lb = candles.slice(-period - 1, -1);
  let h = -Infinity, l = Infinity;
  for (const c of lb) { if (c.high > h) h = c.high; if (c.low < l) l = c.low; }
  const price = candles[candles.length - 1].close;
  return { upper: h, lower: l, middle: (h + l) / 2, breakoutUp: price > h, breakoutDown: price < l };
}

function calculateHistoricalVolatility(closes: number[], period = 20): number {
  if (closes.length < period + 1) return 0;
  const ret: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) if (closes[i - 1] !== 0) ret.push(Math.log(closes[i] / closes[i - 1]));
  if (ret.length < 2) return 0;
  const m = ret.reduce((s, v) => s + v, 0) / ret.length;
  return Math.sqrt(ret.reduce((s, v) => s + (v - m) ** 2, 0) / (ret.length - 1) * 252) * 100;
}

function detectSqueeze(bbU: number, bbL: number, kcU: number, kcL: number): boolean { return bbL > kcL && bbU < kcU; }

function calculateVolumeRatio(candles: Candle[], lookback = 20): number {
  if (candles.length < 2) return 1;
  const cur = candles[candles.length - 1].volume;
  const sl = candles.slice(-Math.min(lookback + 1, candles.length), -1);
  if (!sl.length) return 1;
  const avg = sl.reduce((s, c) => s + c.volume, 0) / sl.length;
  return avg === 0 ? 1 : cur / avg;
}

function calculateOBV(candles: Candle[]) {
  if (candles.length < 2) return { value: 0, trend: "neutral" as const };
  let obv = 0; const os = [0];
  for (let i = 1; i < candles.length; i++) { if (candles[i].close > candles[i - 1].close) obv += candles[i].volume; else if (candles[i].close < candles[i - 1].close) obv -= candles[i].volume; os.push(obv); }
  const lb = Math.min(10, os.length), r = os.slice(-lb), m = Math.floor(lb / 2);
  const a1 = r.slice(0, m).reduce((s, v) => s + v, 0) / m, a2 = r.slice(m).reduce((s, v) => s + v, 0) / (lb - m);
  const pc = a1 === 0 ? 0 : ((a2 - a1) / Math.abs(a1)) * 100;
  return { value: obv, trend: pc > 5 ? "bull" as const : pc < -5 ? "bear" as const : "neutral" as const };
}

function calculateAD(candles: Candle[]) {
  if (candles.length < 2) return { value: 0, trend: "neutral" as const };
  let ad = 0; const as_: number[] = [];
  for (const c of candles) { const r = c.high - c.low; ad += (r === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / r) * c.volume; as_.push(ad); }
  const lb = Math.min(10, as_.length), r = as_.slice(-lb), m = Math.floor(lb / 2);
  const a1 = r.slice(0, m).reduce((s, v) => s + v, 0) / m, a2 = r.slice(m).reduce((s, v) => s + v, 0) / (lb - m);
  const d = a1 === 0 ? 0 : ((a2 - a1) / Math.abs(a1 || 1)) * 100;
  return { value: ad, trend: d > 5 ? "bull" as const : d < -5 ? "bear" as const : "neutral" as const };
}

function calculateVPT(candles: Candle[]) {
  if (candles.length < 2) return { value: 0, trend: "neutral" as const };
  let vpt = 0; const vs = [0];
  for (let i = 1; i < candles.length; i++) { vpt += candles[i].volume * (candles[i - 1].close === 0 ? 0 : (candles[i].close - candles[i - 1].close) / candles[i - 1].close); vs.push(vpt); }
  const lb = Math.min(10, vs.length), r = vs.slice(-lb), m = Math.floor(lb / 2);
  const a1 = r.slice(0, m).reduce((s, v) => s + v, 0) / m, a2 = r.slice(m).reduce((s, v) => s + v, 0) / (lb - m);
  const d = a1 === 0 ? 0 : ((a2 - a1) / Math.abs(a1 || 1)) * 100;
  return { value: vpt, trend: d > 5 ? "bull" as const : d < -5 ? "bear" as const : "neutral" as const };
}

function detectVolumeSpikes(candles: Candle[], threshold = 2.5, lookback = 20) {
  if (candles.length < lookback + 1) return { isSpike: false, ratio: 1, consecutiveHighVolume: 0 };
  const as_ = candles.slice(-lookback - 1, -1), av = as_.reduce((s, c) => s + c.volume, 0) / as_.length;
  const cv = candles[candles.length - 1].volume, ratio = av === 0 ? 1 : cv / av;
  let con = 0;
  for (let i = candles.length - 1; i >= Math.max(0, candles.length - 10); i--) { if (candles[i].volume > av * 1.3) con++; else break; }
  return { isSpike: ratio >= threshold, ratio, consecutiveHighVolume: con };
}

function detectVolumeClusters(candles: Candle[], bins = 20) {
  if (candles.length < 10) return { highVolumeZone: "none" as const, vpocPrice: 0 };
  const lb = Math.min(candles.length, 100), r = candles.slice(-lb), price = candles[candles.length - 1].close;
  let mn = Infinity, mx = -Infinity;
  for (const c of r) { if (c.low < mn) mn = c.low; if (c.high > mx) mx = c.high; }
  const rng = mx - mn;
  if (rng === 0) return { highVolumeZone: "none" as const, vpocPrice: price };
  const bs = rng / bins, vap = new Array(bins).fill(0);
  for (const c of r) { const tp = (c.high + c.low + c.close) / 3; vap[Math.min(Math.floor((tp - mn) / bs), bins - 1)] += c.volume; }
  let mv = 0, vb = 0;
  for (let i = 0; i < bins; i++) if (vap[i] > mv) { mv = vap[i]; vb = i; }
  const vp = mn + (vb + 0.5) * bs, pb = Math.min(Math.floor((price - mn) / bs), bins - 1);
  const z = Math.abs(pb - vb) <= 1 ? "fair_value" : vb < pb ? "support" : "resistance";
  return { highVolumeZone: z as "support" | "resistance" | "fair_value" | "none", vpocPrice: vp };
}

// ─── Trend Analysis (matches client-side analyzeTrend) ──────────────
function analyzePriceStructure(candles: Candle[], lookback = 30): "bull" | "bear" | "neutral" {
  const r = candles.slice(-lookback);
  if (r.length < 8) return "neutral";
  const sh: number[] = [], sl: number[] = [];
  for (let i = 2; i < r.length - 2; i++) {
    if (r[i].high > r[i-1].high && r[i].high > r[i-2].high && r[i].high > r[i+1].high && r[i].high > r[i+2].high) sh.push(r[i].high);
    if (r[i].low < r[i-1].low && r[i].low < r[i-2].low && r[i].low < r[i+1].low && r[i].low < r[i+2].low) sl.push(r[i].low);
  }
  if (sh.length < 2 || sl.length < 2) return "neutral";
  const hh = sh.slice(1).filter((h, i) => h > sh[i]).length;
  const hl = sl.slice(1).filter((l, i) => l > sl[i]).length;
  const lh = sh.slice(1).filter((h, i) => h < sh[i]).length;
  const ll = sl.slice(1).filter((l, i) => l < sl[i]).length;
  const bs = hh + hl, br = lh + ll;
  if (bs >= 2 && bs > br) return "bull";
  if (br >= 2 && br > bs) return "bear";
  return "neutral";
}

function calcTrendConsistency(candles: Candle[], emaPeriod: number, lookbackBars = 20): number {
  const closes = candles.map(c => c.close), ema = calculateEMA(closes, emaPeriod);
  if (ema.length < lookbackBars) return 0;
  const re = ema.slice(-lookbackBars), rc = closes.slice(-lookbackBars);
  const dir = rc[rc.length - 1] > re[re.length - 1] ? "above" : "below";
  let con = 0;
  for (let i = 0; i < lookbackBars; i++) { const ab = rc[i] > re[i]; if ((dir === "above" && ab) || (dir === "below" && !ab)) con++; }
  return con / lookbackBars;
}

function analyzeTrend(candles: Candle[], emaPeriods = { fast: 9, slow: 21, mid: 50, long: 200 }, adxThreshold = 25): any {
  if (candles.length < emaPeriods.long + 10) return null;
  const closes = candles.map(c => c.close);
  const ema9 = calculateEMA(closes, emaPeriods.fast), ema21 = calculateEMA(closes, emaPeriods.slow);
  const ema50 = calculateEMA(closes, emaPeriods.mid), ema200 = calculateEMA(closes, emaPeriods.long);
  const li = closes.length - 1;
  const e9 = ema9[li], e21 = ema21[li], e50 = ema50[li], e200 = ema200[li], price = closes[li];

  const { adx, plusDI, minusDI } = calculateADX(candles);
  const rsi = calculateRSI(closes), macd = calculateMACD(closes);
  const volumeRatio = calculateVolumeRatio(candles);
  const priceStructure = analyzePriceStructure(candles);
  const dema21 = calculateDEMA(closes, 21), demaVal = dema21[dema21.length - 1];
  const ichimoku = calculateIchimoku(candles), psar = calculateParabolicSAR(candles);
  const supertrend = calculateSupertrend(candles), vwap = calculateVWAP(candles);
  const linReg = calculateLinearRegression(closes, 50);
  const stoch = calculateStochastic(candles), stochRsi = calculateStochRSI(closes);
  const williamsR = calculateWilliamsR(candles), cci = calculateCCI(candles);
  const roc = calculateROC(closes), mfi = calculateMFI(candles);
  const cmf = calculateCMF(candles), tsi = calculateTSI(closes);
  const bb = calculateBollingerBands(closes), kc = calculateKeltnerChannels(candles);
  const donchian = calculateDonchianChannels(candles);
  const isSqueeze = detectSqueeze(bb.upper, bb.lower, kc.upper, kc.lower);
  const obv = calculateOBV(candles), ad = calculateAD(candles), vpt = calculateVPT(candles);
  const volSpike = detectVolumeSpikes(candles), volClusters = detectVolumeClusters(candles);
  const consistency50 = calcTrendConsistency(candles, 50, 20), consistency200 = calcTrendConsistency(candles, 200, 30);

  // Weighted voting (simplified - same logic as client)
  let bull = 0, bear = 0, tw = 0;
  const vote = (w: number, sig: "bull" | "bear" | "neutral") => { tw += w; if (sig === "bull") bull += w; else if (sig === "bear") bear += w; };

  // EMA Ribbon
  const emaAligned = e9 > e21 && e21 > e50 && e50 > e200;
  const emaBear = e9 < e21 && e21 < e50 && e50 < e200;
  if (emaAligned) vote(2, "bull"); else if (emaBear) vote(2, "bear"); else { tw += 2; if (e9 > e21 && price > e50) bull += 0.8; else if (e9 < e21 && price < e50) bear += 0.8; }

  // ADX
  if (adx >= adxThreshold) vote(1.8, plusDI > minusDI ? "bull" : "bear"); else tw += 1.8;

  // Ichimoku
  const iFB = ichimoku.priceVsCloud === "above" && ichimoku.cloudDirection === "bull" && ichimoku.tenkan > ichimoku.kijun && ichimoku.chikouVsPrice > 0;
  const iFBr = ichimoku.priceVsCloud === "below" && ichimoku.cloudDirection === "bear" && ichimoku.tenkan < ichimoku.kijun && ichimoku.chikouVsPrice < 0;
  if (iFB) vote(2, "bull"); else if (iFBr) vote(2, "bear"); else { tw += 2; if (ichimoku.priceVsCloud === "above") bull += 0.8; else if (ichimoku.priceVsCloud === "below") bear += 0.8; }

  vote(1.2, psar.direction);
  vote(1.5, supertrend.direction);
  if (price > vwap * 1.002) vote(1, "bull"); else if (price < vwap * 0.998) vote(1, "bear"); else tw += 1;
  if (linReg.rSquared > 0.6) vote(1.3, linReg.slope > 0 ? "bull" : "bear"); else tw += 1.3;
  if (price > demaVal && demaVal > e50) vote(0.8, "bull"); else if (price < demaVal && demaVal < e50) vote(0.8, "bear"); else tw += 0.8;
  vote(1.5, price > e200 ? "bull" : "bear");
  if (priceStructure !== "neutral") vote(1.8, priceStructure); else tw += 1.8;

  // Momentum
  if (rsi > 55 && rsi < 75) vote(1.2, "bull"); else if (rsi < 45 && rsi > 25) vote(1.2, "bear"); else tw += 1.2;
  if (macd.histogram > 0 && macd.macd > 0) vote(1.3, "bull"); else if (macd.histogram < 0 && macd.macd < 0) vote(1.3, "bear"); else tw += 1.3;
  if (stoch.k > 50 && stoch.k < 80 && stoch.k > stoch.d) vote(0.8, "bull"); else if (stoch.k < 50 && stoch.k > 20 && stoch.k < stoch.d) vote(0.8, "bear"); else tw += 0.8;
  if (stochRsi.k > 50 && stochRsi.k < 85) vote(0.7, "bull"); else if (stochRsi.k < 50 && stochRsi.k > 15) vote(0.7, "bear"); else tw += 0.7;
  if (williamsR > -50 && williamsR > -20) vote(0.6, "bull"); else if (williamsR < -50 && williamsR < -80) vote(0.6, "bear"); else tw += 0.6;
  if (cci > 50 && cci < 200) vote(0.8, "bull"); else if (cci < -50 && cci > -200) vote(0.8, "bear"); else tw += 0.8;
  if (roc > 1) vote(0.7, "bull"); else if (roc < -1) vote(0.7, "bear"); else tw += 0.7;
  if (mfi > 55 && mfi < 80) vote(1, "bull"); else if (mfi < 45 && mfi > 20) vote(1, "bear"); else tw += 1;
  if (cmf > 0.05) vote(1, "bull"); else if (cmf < -0.05) vote(1, "bear"); else tw += 1;
  if (tsi > 5) vote(0.9, "bull"); else if (tsi < -5) vote(0.9, "bear"); else tw += 0.9;

  // Volatility
  if (bb.percentB > 0.6 && bb.percentB < 0.95) vote(0.8, "bull"); else if (bb.percentB < 0.4 && bb.percentB > 0.05) vote(0.8, "bear"); else tw += 0.8;
  if (donchian.breakoutUp) vote(1.2, "bull"); else if (donchian.breakoutDown) vote(1.2, "bear"); else { tw += 1.2; if (price > donchian.middle) bull += 0.36; else if (price < donchian.middle) bear += 0.36; }

  // Volume
  if (volumeRatio > 1.3) { const d = bull > bear ? "bull" : bear > bull ? "bear" : null; if (d === "bull") vote(1, "bull"); else if (d === "bear") vote(1, "bear"); else tw += 1; } else tw += 1;
  if (obv.trend !== "neutral") vote(1, obv.trend); else tw += 1;
  if (ad.trend !== "neutral") vote(0.8, ad.trend); else tw += 0.8;
  if (vpt.trend !== "neutral") vote(0.7, vpt.trend); else tw += 0.7;
  if (volClusters.highVolumeZone === "support") vote(0.6, "bull"); else if (volClusters.highVolumeZone === "resistance") vote(0.6, "bear"); else tw += 0.6;

  const maxS = Math.max(bull, bear), sr = tw > 0 ? maxS / tw : 0;
  const isEst = consistency50 > 0.65 || consistency200 > 0.7;
  if (sr < 0.55 || !isEst) return null;

  const direction = bull > bear ? "bull" : "bear";
  const strength = sr >= 0.75 ? "strong" : sr >= 0.65 ? "moderate" : "weak";
  const score = direction === "bull" ? Math.round(bull * 4) : -Math.round(bear * 4);

  let probability = sr * 70 + Math.min((consistency50 + consistency200) / 2, 1) * 10 + Math.min(adx / 60, 1) * 5;
  if (volumeRatio > 1.3 || volSpike.consecutiveHighVolume >= 2) probability += 5;
  if (isSqueeze) probability -= 3;
  probability -= (Math.min(bull, bear) / tw) * 10;
  probability = Math.max(15, Math.min(95, Math.round(probability)));

  return { direction, strength, ema9: e9, ema21: e21, ema50: e50, ema200: e200, adx, volumeRatio, score, rsi, macdHistogram: macd.histogram, priceStructure, plusDI, minusDI, probability };
}

// ─── Pattern Detection ──────────────────────────────────────────────
function detectCandlestickPatterns(candles: Candle[]) {
  if (candles.length < 5) return [];
  const patterns: any[] = [], len = candles.length;
  const avgB = (() => { const sl = candles.slice(-14); return sl.reduce((s, c) => s + Math.abs(c.close - c.open), 0) / sl.length; })();
  const bs = (c: Candle) => Math.abs(c.close - c.open);
  const uw = (c: Candle) => c.high - Math.max(c.open, c.close);
  const lw = (c: Candle) => Math.min(c.open, c.close) - c.low;
  const isBull = (c: Candle) => c.close > c.open;
  const isBear = (c: Candle) => c.close < c.open;
  const rng = (c: Candle) => c.high - c.low;

  // Exclude last (incomplete/still-forming) candle
  for (let i = Math.max(2, len - 4); i < len - 1; i++) {
    const c = candles[i], p = candles[i - 1], p2 = i >= 2 ? candles[i - 2] : null;
    const r = rng(c), b = bs(c);
    if (b < r * 0.1 && r > 0) patterns.push({ name: "Doji", type: "neutral", significance: "medium", candleIndex: i });
    if (lw(c) > b * 2 && uw(c) < b * 0.5 && isBear(p)) patterns.push({ name: "Hammer", type: "bullish", significance: "high", candleIndex: i });
    if (uw(c) > b * 2 && lw(c) < b * 0.5 && isBear(p)) patterns.push({ name: "Inverted Hammer", type: "bullish", significance: "medium", candleIndex: i });
    if (uw(c) > b * 2 && lw(c) < b * 0.5 && isBull(p)) patterns.push({ name: "Shooting Star", type: "bearish", significance: "high", candleIndex: i });
    if (lw(c) > b * 2 && uw(c) < b * 0.5 && isBull(p)) patterns.push({ name: "Hanging Man", type: "bearish", significance: "medium", candleIndex: i });
    if (b > avgB * 1.5 && uw(c) < b * 0.05 && lw(c) < b * 0.05) patterns.push({ name: isBull(c) ? "Bullish Marubozu" : "Bearish Marubozu", type: isBull(c) ? "bullish" : "bearish", significance: "high", candleIndex: i });
    if (b < r * 0.3 && uw(c) > b && lw(c) > b && r > avgB * 0.5) patterns.push({ name: "Spinning Top", type: "neutral", significance: "low", candleIndex: i });
    if (isBull(c) && isBear(p) && c.open <= p.close && c.close >= p.open && b > bs(p)) patterns.push({ name: "Bullish Engulfing", type: "bullish", significance: "high", candleIndex: i });
    if (isBear(c) && isBull(p) && c.open >= p.close && c.close <= p.open && b > bs(p)) patterns.push({ name: "Bearish Engulfing", type: "bearish", significance: "high", candleIndex: i });
    if (isBull(c) && isBear(p) && c.open < p.low && c.close > (p.open + p.close) / 2 && c.close < p.open) patterns.push({ name: "Piercing Line", type: "bullish", significance: "medium", candleIndex: i });
    if (isBear(c) && isBull(p) && c.open > p.high && c.close < (p.open + p.close) / 2 && c.close > p.open) patterns.push({ name: "Dark Cloud Cover", type: "bearish", significance: "medium", candleIndex: i });
    if (isBull(c) && isBear(p) && Math.abs(c.low - p.low) / avgB < 0.05) patterns.push({ name: "Tweezer Bottom", type: "bullish", significance: "medium", candleIndex: i });
    if (isBear(c) && isBull(p) && Math.abs(c.high - p.high) / avgB < 0.05) patterns.push({ name: "Tweezer Top", type: "bearish", significance: "medium", candleIndex: i });
    if (p2) {
      if (isBear(p2) && bs(p) < avgB * 0.3 && isBull(c) && c.close > (p2.open + p2.close) / 2) patterns.push({ name: "Morning Star", type: "bullish", significance: "high", candleIndex: i });
      if (isBull(p2) && bs(p) < avgB * 0.3 && isBear(c) && c.close < (p2.open + p2.close) / 2) patterns.push({ name: "Evening Star", type: "bearish", significance: "high", candleIndex: i });
      if (isBull(p2) && isBull(p) && isBull(c) && p.close > p2.close && c.close > p.close && bs(p2) > avgB * 0.5 && bs(p) > avgB * 0.5 && b > avgB * 0.5) patterns.push({ name: "Three White Soldiers", type: "bullish", significance: "high", candleIndex: i });
      if (isBear(p2) && isBear(p) && isBear(c) && p.close < p2.close && c.close < p.close && bs(p2) > avgB * 0.5 && bs(p) > avgB * 0.5 && b > avgB * 0.5) patterns.push({ name: "Three Black Crows", type: "bearish", significance: "high", candleIndex: i });
    }
  }
  return patterns;
}

function findSwingPoints(candles: Candle[], lookback = 3) {
  const pts: { index: number; price: number; type: "high" | "low" }[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isH = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isL = false;
    }
    if (isH) pts.push({ index: i, price: candles[i].high, type: "high" });
    if (isL) pts.push({ index: i, price: candles[i].low, type: "low" });
  }
  return pts;
}

function pctDiff(a: number, b: number): number { return Math.abs(a - b) / Math.max(a, b) * 100; }

function detectChartPatterns(candles: Candle[]) {
  if (candles.length < 30) return [];
  const patterns: any[] = [], swings = findSwingPoints(candles, 3);
  const highs = swings.filter(s => s.type === "high"), lows = swings.filter(s => s.type === "low");

  for (let i = 0; i < highs.length - 1; i++) {
    const h1 = highs[i], h2 = highs[i + 1];
    if (h2.index - h1.index >= 5 && pctDiff(h1.price, h2.price) < 1.5) {
      const v = lows.find(l => l.index > h1.index && l.index < h2.index);
      if (v && v.price < h1.price * 0.97) patterns.push({ name: "Double Top", type: "bearish", significance: "high", startIndex: h1.index, endIndex: h2.index });
    }
  }
  for (let i = 0; i < lows.length - 1; i++) {
    const l1 = lows[i], l2 = lows[i + 1];
    if (l2.index - l1.index >= 5 && pctDiff(l1.price, l2.price) < 1.5) {
      const p = highs.find(h => h.index > l1.index && h.index < l2.index);
      if (p && p.price > l1.price * 1.03) patterns.push({ name: "Double Bottom", type: "bullish", significance: "high", startIndex: l1.index, endIndex: l2.index });
    }
  }
  for (let i = 0; i < highs.length - 2; i++) {
    const ls = highs[i], hd = highs[i + 1], rs = highs[i + 2];
    if (hd.price > ls.price && hd.price > rs.price && pctDiff(ls.price, rs.price) < 3 && hd.price > ls.price * 1.02)
      patterns.push({ name: "Head & Shoulders", type: "bearish", significance: "high", startIndex: ls.index, endIndex: rs.index });
  }
  for (let i = 0; i < lows.length - 2; i++) {
    const ls = lows[i], hd = lows[i + 1], rs = lows[i + 2];
    if (hd.price < ls.price && hd.price < rs.price && pctDiff(ls.price, rs.price) < 3 && hd.price < ls.price * 0.98)
      patterns.push({ name: "Inverse H&S", type: "bullish", significance: "high", startIndex: ls.index, endIndex: rs.index });
  }

  if (highs.length >= 2 && lows.length >= 2) {
    const rh = highs.slice(-3), rl = lows.slice(-3);
    if (rh.length >= 2 && rl.length >= 2) {
      const flatTop = pctDiff(rh[0].price, rh[rh.length - 1].price) < 1;
      const risingLows = rl[rl.length - 1].price > rl[0].price * 1.01;
      if (flatTop && risingLows) patterns.push({ name: "Ascending Triangle", type: "bullish", significance: "high", startIndex: Math.min(rh[0].index, rl[0].index), endIndex: candles.length - 1 });

      const fallingHighs = rh[rh.length - 1].price < rh[0].price * 0.99;
      const flatBottom = pctDiff(rl[0].price, rl[rl.length - 1].price) < 1;
      if (fallingHighs && flatBottom) patterns.push({ name: "Descending Triangle", type: "bearish", significance: "high", startIndex: Math.min(rh[0].index, rl[0].index), endIndex: candles.length - 1 });

      if (fallingHighs && risingLows) patterns.push({ name: "Symmetrical Triangle", type: "neutral", significance: "medium", startIndex: Math.min(rh[0].index, rl[0].index), endIndex: candles.length - 1 });
    }
  }

  return patterns;
}

function detectMarketStructure(candles: Candle[]) {
  if (candles.length < 20) return [];
  const events: any[] = [], swings = findSwingPoints(candles, 3);
  const highs = swings.filter(s => s.type === "high"), lows = swings.filter(s => s.type === "low");

  // BOS
  for (let i = 1; i < highs.length; i++) {
    const ph = highs[i - 1];
    for (let j = ph.index + 1; j < candles.length; j++) {
      if (candles[j].close > ph.price) { if (j >= candles.length - 5) events.push({ name: "Bullish BOS", type: "bullish", significance: "high", candleIndex: j, price: ph.price }); break; }
    }
  }
  for (let i = 1; i < lows.length; i++) {
    const pl = lows[i - 1];
    for (let j = pl.index + 1; j < candles.length; j++) {
      if (candles[j].close < pl.price) { if (j >= candles.length - 5) events.push({ name: "Bearish BOS", type: "bearish", significance: "high", candleIndex: j, price: pl.price }); break; }
    }
  }

  // CHoCH
  if (highs.length >= 3) {
    const l3 = highs.slice(-3);
    if (l3[1].price < l3[0].price && l3[2].price > l3[1].price) events.push({ name: "Bullish CHoCH", type: "bullish", significance: "high", candleIndex: l3[2].index, price: l3[2].price });
  }
  if (lows.length >= 3) {
    const l3 = lows.slice(-3);
    if (l3[1].price > l3[0].price && l3[2].price < l3[1].price) events.push({ name: "Bearish CHoCH", type: "bearish", significance: "high", candleIndex: l3[2].index, price: l3[2].price });
  }

  // FVG
  const fs = Math.max(1, candles.length - 20);
  for (let i = fs; i < candles.length - 1; i++) {
    const c0 = candles[i - 1], c2 = candles[i + 1];
    if (c2.low > c0.high) events.push({ name: "Bullish FVG", type: "bullish", significance: "medium", candleIndex: i, price: (c0.high + c2.low) / 2 });
    if (c2.high < c0.low) events.push({ name: "Bearish FVG", type: "bearish", significance: "medium", candleIndex: i, price: (c0.low + c2.high) / 2 });
  }

  // Order Blocks
  for (let i = Math.max(1, candles.length - 15); i < candles.length - 2; i++) {
    const c = candles[i], n = candles[i + 1], n2 = candles[i + 2];
    if (c.close < c.open && n.close > c.high && n2.close > n.close) events.push({ name: "Bullish Order Block", type: "bullish", significance: "high", candleIndex: i, price: c.low });
    if (c.close > c.open && n.close < c.low && n2.close < n.close) events.push({ name: "Bearish Order Block", type: "bearish", significance: "high", candleIndex: i, price: c.high });
  }

  // Equal highs/lows
  if (highs.length >= 2) {
    const l2 = highs.slice(-2);
    if (Math.abs(l2[0].price - l2[1].price) / l2[0].price * 100 < 0.3)
      events.push({ name: "Equal Highs (Liquidity)", type: "bearish", significance: "medium", candleIndex: l2[1].index, price: l2[1].price });
  }
  if (lows.length >= 2) {
    const l2 = lows.slice(-2);
    if (Math.abs(l2[0].price - l2[1].price) / l2[0].price * 100 < 0.3)
      events.push({ name: "Equal Lows (Liquidity)", type: "bullish", significance: "medium", candleIndex: l2[1].index, price: l2[1].price });
  }

  return events;
}

// ─── Main Scanner Logic ─────────────────────────────────────────────
async function runFullScan(supabase: any) {
  console.log("Starting full scan...");
  const startTime = Date.now();

  // 1. Fetch tickers
  const categories: ("spot" | "linear")[] = ["linear", "spot"];
  const symbolMap = new Map<string, { symbol: string; category: "spot" | "linear"; price: number; change: number; vol: number }>();

  for (const cat of categories) {
    try {
      const data = await fetchTickers(cat);
      if (data.retCode === 0 && data.result?.list) {
        const sorted = data.result.list
          .filter((t: any) => t.symbol.endsWith("USDT"))
          .sort((a: any, b: any) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
          .slice(0, TOP_SYMBOLS);
        for (const t of sorted) {
          if (!symbolMap.has(t.symbol) || cat === "linear") {
            symbolMap.set(t.symbol, { symbol: t.symbol, category: cat, price: +t.lastPrice, change: +t.price24hPcnt * 100, vol: +t.volume24h });
          }
        }
      }
    } catch (e) { console.error(`Tickers ${cat}:`, e); }
  }

  const symbols = Array.from(symbolMap.values());
  console.log(`Found ${symbols.length} symbols`);

  // 2. Trend scan
  const trendResults: any[] = [];
  const alertResults: any[] = [];
  const alertCooldowns = new Map<string, number>();

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async ({ symbol, category, price, change, vol }) => {
      const signals: any = {};
      for (const tf of ALL_TIMEFRAMES) {
        try {
          const candles = await fetchKlines(symbol, tf, category);
          if (candles.length < 50) continue;
          const signal = analyzeTrend(candles);
          if (signal) {
            signals[tf] = signal;
            // Generate alert
            const key = `${symbol}:${tf}:${signal.direction}`;
            const last = alertCooldowns.get(key);
            if (!last || Date.now() - last > 300000) {
              alertCooldowns.set(key, Date.now());
              alertResults.push({
                id: `${symbol}-${tf}-${Date.now()}`,
                symbol, timeframe: tf, direction: signal.direction,
                strength: signal.strength, price, timestamp: Date.now(), score: signal.score,
              });
            }
          }
        } catch { /* skip */ }
      }
      return { symbol, price, change24h: change, volume24h: vol, signals, lastUpdated: Date.now(), marketType: category };
    }));
    trendResults.push(...results);
    if (i + BATCH_SIZE < symbols.length) await new Promise(r => setTimeout(r, 50));
  }

  // 3. Pattern scan
  const candlestickResults: any[] = [];
  const chartResults: any[] = [];
  const structureResults: any[] = [];

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async ({ symbol, category, price }) => {
      for (const tf of SCAN_TIMEFRAMES) {
        try {
          const candles = await fetchKlines(symbol, tf, category);
          // Use closed candles only (exclude last still-forming candle)
          const closedCandles = candles.slice(0, -1);
          if (closedCandles.length < 20) continue;
          const now = Date.now(), sym = symbol.replace("USDT", "");

          const adjustSig = (baseSig: string, patternType: string) => {
            const asset = trendResults.find((a: any) => a.symbol === symbol);
            if (!asset) return { significance: baseSig, aligned: false };
            const sig = asset.signals[tf];
            if (!sig?.direction) return { significance: baseSig, aligned: false };
            const pDir = patternType === "bullish" ? "bull" : patternType === "bearish" ? "bear" : null;
            if (!pDir) return { significance: baseSig, aligned: false };
            const aligned = pDir === sig.direction;
            if (aligned) return { significance: baseSig === "low" ? "medium" : "high", aligned: true };
            return { significance: baseSig === "high" ? "medium" : "low", aligned: false };
          };

          for (const p of detectCandlestickPatterns(closedCandles)) {
            const ci = p.candleIndex >= 0 && p.candleIndex < closedCandles.length ? closedCandles[p.candleIndex].time : closedCandles[closedCandles.length - 1]?.time ?? now;
            const { significance, aligned } = adjustSig(p.significance, p.type);
            // High-probability filter: skip low significance and unaligned neutral
            if (significance === "low") continue;
            if (significance === "medium" && !aligned && p.type === "neutral") continue;
            candlestickResults.push({ id: `cs-${symbol}-${tf}-${p.name}-${now}`, symbol: sym, timeframe: tf, pattern: { ...p, significance }, price, detectedAt: now, formedAt: ci > 0 ? ci : now, category: "candlestick", trendAligned: aligned });
          }
          for (const p of detectChartPatterns(closedCandles)) {
            const ci = p.endIndex >= 0 && p.endIndex < closedCandles.length ? closedCandles[p.endIndex].time : closedCandles[closedCandles.length - 1]?.time ?? now;
            const { significance, aligned } = adjustSig(p.significance, p.type);
            chartResults.push({ id: `ch-${symbol}-${tf}-${p.name}-${now}`, symbol: sym, timeframe: tf, pattern: { ...p, significance }, price, detectedAt: now, formedAt: ci > 0 ? ci : now, category: "chart", trendAligned: aligned });
          }
          for (const p of detectMarketStructure(closedCandles)) {
            const ci = p.candleIndex >= 0 && p.candleIndex < closedCandles.length ? closedCandles[p.candleIndex].time : closedCandles[closedCandles.length - 1]?.time ?? now;
            const { significance, aligned } = adjustSig(p.significance, p.type);
            structureResults.push({ id: `ms-${symbol}-${tf}-${p.name}-${now}`, symbol: sym, timeframe: tf, pattern: { ...p, significance }, price, detectedAt: now, formedAt: ci > 0 ? ci : now, category: "structure", trendAligned: aligned });
          }
        } catch { /* skip */ }
      }
    }));
    if (i + BATCH_SIZE < symbols.length) await new Promise(r => setTimeout(r, 50));
  }

  // 4. Store results in DB
  const now = new Date().toISOString();
  const updates = [
    { id: "trends", data: trendResults, scanned_at: now },
    { id: "candlestick", data: candlestickResults, scanned_at: now },
    { id: "chart", data: chartResults, scanned_at: now },
    { id: "structure", data: structureResults, scanned_at: now },
    { id: "alerts", data: alertResults.slice(0, 200), scanned_at: now },
    { id: "metadata", data: { duration: Date.now() - startTime, symbolCount: symbols.length, trendCount: trendResults.filter((t: any) => Object.keys(t.signals).length > 0).length, patternCount: candlestickResults.length + chartResults.length + structureResults.length }, scanned_at: now },
  ];

  for (const u of updates) {
    const { error } = await supabase.from("scan_cache").upsert(u);
    if (error) console.error(`Failed to upsert ${u.id}:`, error);
  }

  const duration = Date.now() - startTime;
  console.log(`Scan complete in ${(duration / 1000).toFixed(1)}s — ${trendResults.length} trends, ${candlestickResults.length + chartResults.length + structureResults.length} patterns, ${alertResults.length} alerts`);

  return { duration, symbols: symbols.length, trends: trendResults.length, patterns: candlestickResults.length + chartResults.length + structureResults.length, alerts: alertResults.length };
}

// ─── Handler ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const result = await runFullScan(supabase);

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Scanner error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
