import { useState, useMemo } from 'react';
import { useFVGScanner } from '@/hooks/useFVGScanner';
import { Loader2, RefreshCw, TrendingUp, TrendingDown, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Timeframe } from '@/types/scanner';
import { TIMEFRAME_LABELS } from '@/types/scanner';
import type { FVGScanResult, PureFVG } from '@/lib/fvg-scanner';

const TF_OPTIONS: Timeframe[] = ['60', '240', 'D'];
const STRENGTH_FILTERS = ['all', 'extreme', 'strong', 'moderate'] as const;
type StrengthFilter = (typeof STRENGTH_FILTERS)[number];

export default function FVGScanner() {
  const { results, scanning, lastScan, progress, runScan } = useFVGScanner();
  const [tfFilter, setTfFilter] = useState<Timeframe | 'all'>('all');
  const [strengthFilter, setStrengthFilter] = useState<StrengthFilter>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'bullish' | 'bearish'>('all');

  const filtered = useMemo(() => {
    let list = results;
    if (tfFilter !== 'all') list = list.filter(r => r.timeframe === tfFilter);
    if (typeFilter !== 'all') {
      list = list.filter(r => {
        if (typeFilter === 'bullish') return r.bullishCount > 0;
        return r.bearishCount > 0;
      });
    }
    if (strengthFilter !== 'all') {
      list = list.filter(r => r.strongestFVG?.category === strengthFilter);
    }
    return list;
  }, [results, tfFilter, strengthFilter, typeFilter]);

  // Group by strength category
  const grouped = useMemo(() => {
    const extreme = filtered.filter(r => r.strongestFVG?.category === 'extreme');
    const strong = filtered.filter(r => r.strongestFVG?.category === 'strong');
    const moderate = filtered.filter(r => r.strongestFVG?.category === 'moderate');
    return { extreme, strong, moderate };
  }, [filtered]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-sm font-bold text-foreground">FVG Scanner</h1>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Pure imbalance gaps • unfilled only • auto-scans hourly
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lastScan > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {new Date(lastScan).toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={runScan}
              disabled={scanning}
              className="flex items-center gap-1.5 rounded bg-primary/10 px-2.5 py-1.5 text-[10px] font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {scanning ? `${progress.current}/${progress.total}` : 'Scan'}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <Filter className="h-3 w-3 text-muted-foreground" />
          {/* Timeframe filter */}
          <div className="flex gap-0.5">
            <FilterBtn active={tfFilter === 'all'} onClick={() => setTfFilter('all')}>All TF</FilterBtn>
            {TF_OPTIONS.map(tf => (
              <FilterBtn key={tf} active={tfFilter === tf} onClick={() => setTfFilter(tf)}>
                {TIMEFRAME_LABELS[tf]}
              </FilterBtn>
            ))}
          </div>
          <div className="w-px h-4 bg-border" />
          {/* Type filter */}
          <div className="flex gap-0.5">
            <FilterBtn active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>All</FilterBtn>
            <FilterBtn active={typeFilter === 'bullish'} onClick={() => setTypeFilter('bullish')} className="text-[hsl(var(--trend-bull))]">Bull</FilterBtn>
            <FilterBtn active={typeFilter === 'bearish'} onClick={() => setTypeFilter('bearish')} className="text-[hsl(var(--trend-bear))]">Bear</FilterBtn>
          </div>
          <div className="w-px h-4 bg-border" />
          {/* Strength filter */}
          <div className="flex gap-0.5">
            {STRENGTH_FILTERS.map(s => (
              <FilterBtn key={s} active={strengthFilter === s} onClick={() => setStrengthFilter(s)}>
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </FilterBtn>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {scanning && results.length === 0 && (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-2 text-xs text-muted-foreground">Scanning {progress.current}/{progress.total} symbols...</span>
          </div>
        )}

        {!scanning && results.length === 0 && (
          <div className="flex items-center justify-center h-40 text-xs text-muted-foreground">
            No data yet. Click Scan to start.
          </div>
        )}

        {/* Stats bar */}
        {results.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <StatCard label="Extreme" count={grouped.extreme.length} color="text-[hsl(var(--destructive))]" />
            <StatCard label="Strong" count={grouped.strong.length} color="text-[hsl(var(--confluence-hot))]" />
            <StatCard label="Moderate" count={grouped.moderate.length} color="text-muted-foreground" />
          </div>
        )}

        {/* Grouped results */}
        {grouped.extreme.length > 0 && (
          <FVGGroup title="🔥 Extreme Imbalance" results={grouped.extreme} color="destructive" />
        )}
        {grouped.strong.length > 0 && (
          <FVGGroup title="⚡ Strong Imbalance" results={grouped.strong} color="warning" />
        )}
        {grouped.moderate.length > 0 && (
          <FVGGroup title="📊 Moderate Imbalance" results={grouped.moderate} color="muted" />
        )}
      </div>
    </div>
  );
}

function FilterBtn({ active, onClick, children, className }: {
  active: boolean; onClick: () => void; children: React.ReactNode; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground',
        className
      )}
    >
      {children}
    </button>
  );
}

function StatCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="rounded-lg bg-card border border-border px-3 py-2 text-center">
      <div className={cn('text-lg font-bold', color)}>{count}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function FVGGroup({ title, results, color }: {
  title: string; results: FVGScanResult[]; color: string;
}) {
  return (
    <div>
      <h2 className="text-xs font-semibold text-foreground mb-2">{title}</h2>
      <div className="space-y-1.5">
        {results.map((r, idx) => (
          <FVGRow key={`${r.symbol}-${r.timeframe}-${idx}`} result={r} />
        ))}
      </div>
    </div>
  );
}

function FVGRow({ result }: { result: FVGScanResult }) {
  const { symbol, price, change24h, timeframe, fvgs, bullishCount, bearishCount, strongestFVG, distToNearest } = result;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg bg-card border border-border overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-foreground">{symbol.replace('USDT', '')}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-medium">
            {TIMEFRAME_LABELS[timeframe]}
          </span>
          <span className={cn('text-[10px] font-medium', change24h >= 0 ? 'text-[hsl(var(--trend-bull))]' : 'text-[hsl(var(--trend-bear))]')}>
            {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
          </span>
        </div>
        <div className="flex items-center gap-3">
          {bullishCount > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-[hsl(var(--trend-bull))]">
              <TrendingUp className="h-3 w-3" />{bullishCount}
            </span>
          )}
          {bearishCount > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-[hsl(var(--trend-bear))]">
              <TrendingDown className="h-3 w-3" />{bearishCount}
            </span>
          )}
          {strongestFVG && (
            <span className={cn(
              'text-[10px] font-bold px-1.5 py-0.5 rounded',
              strongestFVG.category === 'extreme' ? 'bg-destructive/20 text-[hsl(var(--destructive))]' :
              strongestFVG.category === 'strong' ? 'bg-[hsl(var(--confluence-hot))]/20 text-[hsl(var(--confluence-hot))]' :
              'bg-secondary text-muted-foreground'
            )}>
              {strongestFVG.strength}/100
            </span>
          )}
          {distToNearest !== null && (
            <span className="text-[10px] text-muted-foreground">
              {Math.abs(distToNearest).toFixed(2)}% away
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-1">
          <div className="text-[10px] text-muted-foreground mb-1">
            Price: ${price.toPrecision(6)} • {fvgs.length} unfilled FVG{fvgs.length !== 1 ? 's' : ''}
          </div>
          {fvgs.slice(0, 8).map((fvg, i) => (
            <FVGDetail key={i} fvg={fvg} price={price} />
          ))}
        </div>
      )}
    </div>
  );
}

function FVGDetail({ fvg, price }: { fvg: PureFVG; price: number }) {
  const isBull = fvg.type === 'bullish';
  const dist = ((price - fvg.midpoint) / price * 100);

  return (
    <div className="flex items-center justify-between rounded bg-secondary/50 px-2 py-1.5">
      <div className="flex items-center gap-2">
        {isBull ? <TrendingUp className="h-3 w-3 text-[hsl(var(--trend-bull))]" /> : <TrendingDown className="h-3 w-3 text-[hsl(var(--trend-bear))]" />}
        <div>
          <div className="text-[10px] font-medium text-foreground">
            ${fvg.gapLow.toPrecision(5)} — ${fvg.gapHigh.toPrecision(5)}
          </div>
          <div className="text-[9px] text-muted-foreground">
            Gap {fvg.gapPct.toFixed(3)}% • Vol {fvg.volumeRatio.toFixed(1)}x • {Math.abs(dist).toFixed(2)}% {dist > 0 ? 'below' : 'above'}
          </div>
        </div>
      </div>
      <div className={cn(
        'text-[10px] font-bold px-1.5 py-0.5 rounded',
        fvg.category === 'extreme' ? 'bg-destructive/20 text-[hsl(var(--destructive))]' :
        fvg.category === 'strong' ? 'bg-[hsl(var(--confluence-hot))]/20 text-[hsl(var(--confluence-hot))]' :
        'bg-secondary text-muted-foreground'
      )}>
        {fvg.strength}
      </div>
    </div>
  );
}
