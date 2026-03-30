import { useState, useMemo } from 'react';
import { PatternPageShell } from '@/components/PatternPageShell';
import { useSharedPatternScanner } from '@/contexts/PatternScannerContext';
import type { SmcAnalysis } from '@/lib/smc';
import { TrendingUp, TrendingDown, Activity, Gauge, Shield, Clock, Zap, Target, BarChart3, Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const MarketStructurePage = () => {
  const { structureGroups, scanning, lastScanTime, scanProgress, runScan, smcAnalysis } = useSharedPatternScanner();

  return (
    <div className="flex h-full flex-col">
      {/* SMC Dashboard */}
      {smcAnalysis && <SmcDashboard analysis={smcAnalysis} />}

      {/* Pattern results */}
      <div className="flex-1 min-h-0">
        <PatternPageShell
          title="Market Structure"
          subtitle="BOS, CHoCH, FVG, OB, Liquidity, Traps, Sweeps"
          groups={structureGroups}
          scanning={scanning}
          lastScanTime={lastScanTime}
          scanProgress={scanProgress}
          onRescan={runScan}
        />
      </div>
    </div>
  );
};

function SmcDashboard({ analysis }: { analysis: SmcAnalysis }) {
  const [expanded, setExpanded] = useState(true);

  const phaseColor: Record<string, string> = {
    accumulation: 'text-accent',
    expansion: 'text-primary',
    retracement: 'text-yellow-500',
    distribution: 'text-destructive',
  };

  const sessionLabel: Record<string, string> = {
    asian: '🌏 Asian',
    london: '🇬🇧 London',
    new_york: '🇺🇸 New York',
    off_hours: '⏸ Off-Hours',
  };

  const bullWidth = analysis.probBull;
  const bearWidth = analysis.probBear;
  const bias = bullWidth > 55 ? 'Bullish' : bearWidth > 55 ? 'Bearish' : 'Neutral';
  const biasColor = bullWidth > 55 ? 'text-primary' : bearWidth > 55 ? 'text-destructive' : 'text-muted-foreground';

  return (
    <div className="border-b border-border bg-secondary/20">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Gauge className="h-3.5 w-3.5 text-accent" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">SMC Dashboard</span>
          <Badge className={`text-[9px] px-2 py-0 rounded-full border-0 ${
            bullWidth > 55 ? 'bg-primary/20 text-primary' : bearWidth > 55 ? 'bg-destructive/20 text-destructive' : 'bg-muted text-muted-foreground'
          }`}>
            {bias}
          </Badge>
        </div>
        <span className="text-[10px] text-muted-foreground">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          {/* Probability bar */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="flex items-center gap-1 text-[10px] text-primary font-medium">
                <TrendingUp className="h-3 w-3" /> {bullWidth}% Bull
              </span>
              <span className="flex items-center gap-1 text-[10px] text-destructive font-medium">
                {bearWidth}% Bear <TrendingDown className="h-3 w-3" />
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden flex">
              <div
                className="h-full bg-primary transition-all duration-500 rounded-l-full"
                style={{ width: `${bullWidth}%` }}
              />
              <div
                className="h-full bg-destructive transition-all duration-500 rounded-r-full"
                style={{ width: `${bearWidth}%` }}
              />
            </div>
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <InfoCard
              icon={<Layers className="h-3 w-3" />}
              label="Phase"
              value={analysis.marketPhase}
              valueClass={phaseColor[analysis.marketPhase] || 'text-foreground'}
            />
            <InfoCard
              icon={<Clock className="h-3 w-3" />}
              label="Session"
              value={sessionLabel[analysis.session] || analysis.session}
            />
            <InfoCard
              icon={<Activity className="h-3 w-3" />}
              label="Volatility"
              value={analysis.volatilityOk ? (analysis.volatilityExpansion ? 'Expanding' : 'Normal') : 'Low'}
              valueClass={analysis.volatilityExpansion ? 'text-accent' : analysis.volatilityOk ? 'text-primary' : 'text-yellow-500'}
            />
            <InfoCard
              icon={<BarChart3 className="h-3 w-3" />}
              label="ATR"
              value={`$${analysis.atr < 1 ? analysis.atr.toPrecision(3) : analysis.atr.toFixed(2)}`}
            />
          </div>

          {/* Liquidity pools summary */}
          {analysis.liquidityPools.length > 0 && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Liquidity Pools</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {analysis.liquidityPools.slice(0, 6).map((pool, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className={`text-[9px] py-0 rounded-full ${
                      pool.type === 'above' ? 'border-destructive/30 text-destructive' : 'border-primary/30 text-primary'
                    }`}
                  >
                    {pool.type === 'above' ? '↑' : '↓'} ${pool.price < 1 ? pool.price.toPrecision(4) : pool.price.toFixed(2)} ({pool.strength}x)
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Range info */}
          {analysis.range && (
            <div className="rounded bg-secondary/50 px-2.5 py-1.5 flex items-center gap-2">
              <Shield className="h-3 w-3 text-accent flex-shrink-0" />
              <span className="text-[10px] text-foreground/80">
                Range detected: ${analysis.range.low.toPrecision(5)} – ${analysis.range.high.toPrecision(5)} ({analysis.range.touches} touches)
              </span>
            </div>
          )}

          {/* Key levels */}
          {analysis.keyLevels.length > 0 && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Key Levels</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {analysis.keyLevels
                  .filter(l => l.type !== 'psychological')
                  .slice(0, 6)
                  .map((level, i) => (
                    <Badge key={i} variant="outline" className="text-[9px] py-0 rounded-full border-accent/30 text-accent">
                      {level.name}: ${level.price < 1 ? level.price.toPrecision(4) : level.price.toFixed(2)}
                    </Badge>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InfoCard({ icon, label, value, valueClass }: { icon: React.ReactNode; label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-lg bg-secondary/40 px-2.5 py-2">
      <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
        {icon}
        <span className="text-[9px] uppercase tracking-wider">{label}</span>
      </div>
      <span className={`text-[11px] font-bold capitalize ${valueClass || 'text-foreground'}`}>{value}</span>
    </div>
  );
}

export default MarketStructurePage;
