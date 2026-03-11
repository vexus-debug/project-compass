import { ReactNode } from 'react';
import { NavLink } from '@/components/NavLink';
import { BarChart3, ChartCandlestick, LayoutGrid, Network, Layers, Zap, Calculator, Activity, ArrowUpDown, Grid3X3, Box, Flame, DollarSign, GitBranch, PieChart } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

const NAV_ITEMS = [
  { to: '/', label: 'Scanner', icon: BarChart3 },
  { to: '/confluence', label: 'Confluence', icon: Zap },
  { to: '/range-scanner', label: 'Range', icon: Layers },
  { to: '/candlestick-patterns', label: 'Candles', icon: ChartCandlestick },
  { to: '/chart-patterns', label: 'Charts', icon: LayoutGrid },
  { to: '/market-structure', label: 'SMC', icon: Network },
  { to: '/market-overview', label: 'Market', icon: Activity },
  { to: '/mtf', label: 'MTF', icon: ArrowUpDown },
  { to: '/heatmap', label: 'Heatmap', icon: Grid3X3 },
  { to: '/supply-demand', label: 'S/D', icon: Box },
  { to: '/volatility', label: 'Vol', icon: Flame },
  { to: '/funding', label: 'Funding', icon: DollarSign },
  { to: '/correlation', label: 'Corr', icon: GitBranch },
  { to: '/sectors', label: 'Sectors', icon: PieChart },
  { to: '/trade-planner', label: 'Trade', icon: Calculator },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="flex h-[100dvh] flex-col bg-background">
        <nav className="flex border-b border-border bg-card px-1 overflow-x-auto scrollbar-hide">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className="flex flex-shrink-0 items-center justify-center gap-1 px-2 py-2 text-[9px] text-muted-foreground transition-colors"
              activeClassName="text-primary border-b-2 border-primary"
            >
              <item.icon className="h-3 w-3" />
              <span className="font-medium">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <nav className="flex w-14 flex-col items-center gap-1 border-r border-border bg-card py-3 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className="flex flex-col items-center justify-center gap-0.5 rounded p-1.5 text-[8px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            activeClassName="bg-primary/10 text-primary"
          >
            <item.icon className="h-4 w-4" />
            <span className="font-medium">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
