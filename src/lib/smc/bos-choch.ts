import type { Candle } from '@/types/scanner';
import type { SwingPoint, SmcEvent } from './types';

/** Calculate momentum of a candle or series of candles (0-100) */
function calcMomentum(candles: Candle[], startIdx: number, endIdx: number): number {
  if (startIdx < 0 || endIdx >= candles.length || startIdx >= endIdx) return 50;
  const span = candles.slice(startIdx, endIdx + 1);
  const totalRange = span.reduce((s, c) => s + (c.high - c.low), 0);
  const netMove = Math.abs(candles[endIdx].close - candles[startIdx].open);
  const avgVolume = span.reduce((s, c) => s + c.volume, 0) / span.length;
  const lastVolume = candles[endIdx].volume;
  const volumeRatio = avgVolume > 0 ? lastVolume / avgVolume : 1;
  const efficiency = totalRange > 0 ? netMove / totalRange : 0;
  // Combine efficiency and volume ratio into a 0-100 score
  return Math.min(100, Math.round(efficiency * 50 + Math.min(volumeRatio, 3) * 16.7));
}

/** Detect if a BOS failed (price returned to previous range within N candles) */
function isBosFailure(candles: Candle[], breakIndex: number, breakPrice: number, isBullish: boolean, lookforward: number = 5): boolean {
  const end = Math.min(breakIndex + lookforward, candles.length);
  for (let i = breakIndex + 1; i < end; i++) {
    if (isBullish && candles[i].close < breakPrice) return true;
    if (!isBullish && candles[i].close > breakPrice) return true;
  }
  return false;
}

/** Evaluate CHoCH strength (0-100) based on momentum, candle size, break distance */
function chochStrength(candles: Candle[], breakIndex: number, prevSwingPrice: number, breakPrice: number): number {
  const c = candles[breakIndex];
  const bodySize = Math.abs(c.close - c.open);
  const totalRange = c.high - c.low;
  const bodyRatio = totalRange > 0 ? bodySize / totalRange : 0;
  const breakDistance = Math.abs(breakPrice - prevSwingPrice) / prevSwingPrice * 100;
  const momentum = calcMomentum(candles, Math.max(0, breakIndex - 2), breakIndex);
  // Weight: 40% momentum, 30% body ratio, 30% break distance
  return Math.min(100, Math.round(momentum * 0.4 + bodyRatio * 100 * 0.3 + Math.min(breakDistance * 10, 30)));
}

export function detectBosChoch(candles: Candle[], swings: SwingPoint[]): SmcEvent[] {
  const events: SmcEvent[] = [];
  const highs = swings.filter(s => s.type === 'high');
  const lows = swings.filter(s => s.type === 'low');
  const recentThreshold = candles.length - 8;

  // === BOS Detection with momentum & failure ===
  for (let i = 1; i < highs.length; i++) {
    const prevHigh = highs[i - 1];
    for (let j = prevHigh.index + 1; j < candles.length; j++) {
      if (candles[j].close > prevHigh.price) {
        if (j >= recentThreshold) {
          const momentum = calcMomentum(candles, Math.max(0, j - 3), j);
          const failure = isBosFailure(candles, j, prevHigh.price, true);
          const sig = failure ? 'low' : momentum > 60 ? 'high' : 'medium';
          
          if (failure) {
            events.push({
              name: 'Bullish BOS Failure',
              type: 'bearish',
              significance: 'high',
              description: `Price broke above $${prevHigh.price.toPrecision(5)} but failed to hold — potential bear trap`,
              candleIndex: j,
              price: prevHigh.price,
              meta: { momentum, bosFailure: true, isTrap: true },
            });
          } else {
            events.push({
              name: 'Bullish BOS',
              type: 'bullish',
              significance: sig,
              description: `Break above $${prevHigh.price.toPrecision(5)} — momentum ${momentum}/100`,
              candleIndex: j,
              price: prevHigh.price,
              meta: { momentum, bosFailure: false },
            });
          }
        }
        break;
      }
    }
  }

  for (let i = 1; i < lows.length; i++) {
    const prevLow = lows[i - 1];
    for (let j = prevLow.index + 1; j < candles.length; j++) {
      if (candles[j].close < prevLow.price) {
        if (j >= recentThreshold) {
          const momentum = calcMomentum(candles, Math.max(0, j - 3), j);
          const failure = isBosFailure(candles, j, prevLow.price, false);
          const sig = failure ? 'low' : momentum > 60 ? 'high' : 'medium';
          
          if (failure) {
            events.push({
              name: 'Bearish BOS Failure',
              type: 'bullish',
              significance: 'high',
              description: `Price broke below $${prevLow.price.toPrecision(5)} but failed to hold — potential bull trap`,
              candleIndex: j,
              price: prevLow.price,
              meta: { momentum, bosFailure: true, isTrap: true },
            });
          } else {
            events.push({
              name: 'Bearish BOS',
              type: 'bearish',
              significance: sig,
              description: `Break below $${prevLow.price.toPrecision(5)} — momentum ${momentum}/100`,
              candleIndex: j,
              price: prevLow.price,
              meta: { momentum, bosFailure: false },
            });
          }
        }
        break;
      }
    }
  }

  // === CHoCH with strength evaluation ===
  if (highs.length >= 3) {
    const last3 = highs.slice(-3);
    if (last3[1].price < last3[0].price && last3[2].price > last3[1].price) {
      const strength = chochStrength(candles, last3[2].index, last3[1].price, last3[2].price);
      events.push({
        name: 'Bullish CHoCH',
        type: 'bullish',
        significance: strength > 65 ? 'high' : strength > 40 ? 'medium' : 'low',
        description: `Change of character — strength ${strength}/100 — first HH after downtrend`,
        candleIndex: last3[2].index,
        price: last3[2].price,
        meta: { chochStrength: strength },
      });
    }
  }

  if (lows.length >= 3) {
    const last3 = lows.slice(-3);
    if (last3[1].price > last3[0].price && last3[2].price < last3[1].price) {
      const strength = chochStrength(candles, last3[2].index, last3[1].price, last3[2].price);
      events.push({
        name: 'Bearish CHoCH',
        type: 'bearish',
        significance: strength > 65 ? 'high' : strength > 40 ? 'medium' : 'low',
        description: `Change of character — strength ${strength}/100 — first LL after uptrend`,
        candleIndex: last3[2].index,
        price: last3[2].price,
        meta: { chochStrength: strength },
      });
    }
  }

  return events;
}

/** Detect trend continuation: BOS → pullback → BOS */
export function detectContinuationPatterns(candles: Candle[], swings: SwingPoint[]): SmcEvent[] {
  const events: SmcEvent[] = [];
  const highs = swings.filter(s => s.type === 'high');
  const lows = swings.filter(s => s.type === 'low');
  
  // Bullish continuation: HH → HL → HH
  if (highs.length >= 2 && lows.length >= 1) {
    const h1 = highs[highs.length - 2];
    const h2 = highs[highs.length - 1];
    const pullbackLow = lows.find(l => l.index > h1.index && l.index < h2.index);
    if (h2.price > h1.price && pullbackLow && pullbackLow.price > lows[lows.length - 2]?.price) {
      events.push({
        name: 'Bullish Continuation',
        type: 'bullish',
        significance: 'high',
        description: 'BOS → pullback → BOS confirming bullish trend continuation',
        candleIndex: h2.index,
        price: h2.price,
        meta: { isContinuation: true },
      });
    }
  }

  // Bearish continuation: LL → LH → LL
  if (lows.length >= 2 && highs.length >= 1) {
    const l1 = lows[lows.length - 2];
    const l2 = lows[lows.length - 1];
    const pullbackHigh = highs.find(h => h.index > l1.index && h.index < l2.index);
    if (l2.price < l1.price && pullbackHigh && pullbackHigh.price < highs[highs.length - 2]?.price) {
      events.push({
        name: 'Bearish Continuation',
        type: 'bearish',
        significance: 'high',
        description: 'BOS → pullback → BOS confirming bearish trend continuation',
        candleIndex: l2.index,
        price: l2.price,
        meta: { isContinuation: true },
      });
    }
  }

  return events;
}
