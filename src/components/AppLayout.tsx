import { ReactNode } from 'react';
import { NavLink } from '@/components/NavLink';
import { BarChart3, CandlestickChart, LayoutGrid, Network } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

const NAV_ITEMS = [
  { to: '/', label: 'Scanner', icon: BarChart3 },
  { to: '/candlestick-patterns', label: 'Candles', icon: CandlestickChart },
  { to: '/chart-patterns', label: 'Charts', icon: LayoutGrid },
  { to: '/market-structure', label: 'SMC', icon: Network },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="flex h-[100dvh] flex-col bg-background">
        {/* Top nav bar for pages */}
        <nav className="flex border-b border-border bg-card px-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className="flex flex-1 items-center justify-center gap-1 py-2 text-[9px] text-muted-foreground transition-colors"
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
      {/* Sidebar nav */}
      <nav className="flex w-14 flex-col items-center gap-1 border-r border-border bg-card py-3">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className="group flex flex-col items-center gap-0.5 rounded px-2 py-2 text-muted-foreground transition-colors hover:text-foreground"
            activeClassName="text-primary bg-primary/10"
          >
            <item.icon className="h-4 w-4" />
            <span className="text-[7px] font-medium uppercase tracking-wider">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
