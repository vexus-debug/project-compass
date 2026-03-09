import { useState } from 'react';
import { AlertLog } from '@/components/AlertLog';
import { ScannerMatrix } from '@/components/ScannerMatrix';
import { WatchlistPanel } from '@/components/WatchlistPanel';
import { SettingsPanel } from '@/components/SettingsPanel';
import { useScanner } from '@/hooks/useScanner';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useSettings } from '@/hooks/useSettings';
import { useIsMobile } from '@/hooks/use-mobile';
import { RefreshCw, BarChart3, Bell, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';

type MobileTab = 'scanner' | 'alerts' | 'watchlist';

const Dashboard = () => {
  const { settings, updateSettings } = useSettings();
  const { watchlist, addToWatchlist, removeFromWatchlist, toggleAlerts, isWatched } = useWatchlist();
  const { assets, alerts, scanning, lastScanTime, scanProgress, clearAlerts, runScan } = useScanner(settings, watchlist);
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<MobileTab>('scanner');

  const lastScanStr = lastScanTime
    ? new Date(lastScanTime).toLocaleTimeString('en-US', { hour12: false })
    : '—';

  if (isMobile) {
    return (
      <div className="flex h-[100dvh] flex-col bg-background">
        {/* Compact mobile header */}
        <header className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <h1 className="text-xs font-bold uppercase tracking-[0.15em] text-primary">
              SCANNER
            </h1>
            <span className={`h-1.5 w-1.5 rounded-full ${scanning ? 'bg-primary animate-pulse-dot' : 'bg-muted-foreground'}`} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {assets.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={runScan}
              disabled={scanning}
            >
              <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
            </Button>
            <SettingsPanel settings={settings} onUpdate={updateSettings} />
          </div>
        </header>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'scanner' && (
            <ScannerMatrix
              assets={assets}
              scanning={scanning}
              scanProgress={scanProgress}
              onAddToWatchlist={addToWatchlist}
              isWatched={isWatched}
            />
          )}
          {activeTab === 'alerts' && (
            <AlertLog alerts={alerts} onClear={clearAlerts} />
          )}
          {activeTab === 'watchlist' && (
            <WatchlistPanel
              watchlist={watchlist}
              assets={assets}
              onRemove={removeFromWatchlist}
              onToggleAlerts={toggleAlerts}
            />
          )}
        </div>

        {/* Bottom tab bar */}
        <nav className="flex border-t border-border bg-card safe-area-bottom">
          {([
            { id: 'scanner' as MobileTab, icon: BarChart3, label: 'Scanner' },
            { id: 'alerts' as MobileTab, icon: Bell, label: 'Alerts', badge: alerts.length },
            { id: 'watchlist' as MobileTab, icon: Star, label: 'Watchlist', badge: watchlist.length },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] transition-colors ${
                activeTab === tab.id
                  ? 'text-primary'
                  : 'text-muted-foreground'
              }`}
            >
              <tab.icon className="h-5 w-5" fill={activeTab === tab.id ? 'currentColor' : 'none'} />
              <span className="font-medium">{tab.label}</span>
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="absolute right-1/4 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>
    );
  }

  // Desktop layout (unchanged)
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-3">
          <h1 className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
            BYBIT SCANNER
          </h1>
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${scanning ? 'bg-primary animate-pulse-dot' : 'bg-muted-foreground'}`} />
            {scanning ? 'SCANNING' : 'IDLE'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] tabular-nums text-muted-foreground">
            Last: {lastScanStr}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {assets.length} assets
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={runScan}
            disabled={scanning}
            title="Force scan"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
          </Button>
          <SettingsPanel settings={settings} onUpdate={updateSettings} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-64 flex-shrink-0">
          <AlertLog alerts={alerts} onClear={clearAlerts} />
        </div>
        <div className="flex-1 min-w-0">
          <ScannerMatrix
            assets={assets}
            scanning={scanning}
            scanProgress={scanProgress}
            onAddToWatchlist={addToWatchlist}
            isWatched={isWatched}
          />
        </div>
        <div className="w-56 flex-shrink-0">
          <WatchlistPanel
            watchlist={watchlist}
            assets={assets}
            onRemove={removeFromWatchlist}
            onToggleAlerts={toggleAlerts}
          />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
