import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useBinanceStream } from './hooks/use-binance-stream';
import { TickerHeader } from './components/dashboard/TickerHeader';
import { DashboardLayout } from './components/dashboard/DashboardLayout';
import { MarketScanner } from './components/dashboard/MarketScanner';
import { LayoutGrid, Zap } from 'lucide-react';
import { cn } from './lib/utils';
import { Logo } from './components/Logo';

import { useSharedStream } from './hooks/use-shared-stream';
import { useMarketScanner } from './hooks/use-market-scanner';

type View = 'DASHBOARD' | 'SCANNER';

/**
 * Memoized View Wrapper to prevent App's ticker re-renders from hitting the scanner
 */
const ScannerView = React.memo(({ scanner, onSelectSymbol }: { scanner: any, onSelectSymbol: (s: string) => void }) => {
    return (
        <div className="flex-1 overflow-hidden">
            <MarketScanner 
                onSelectSymbol={onSelectSymbol} 
                scannerState={scanner}
            />
        </div>
    );
});

export default function App() {
  const [activeSymbol, setActiveSymbol] = useState(() => localStorage.getItem('activeSymbol') || 'btcusdt');
  const [marketType, setMarketType] = useState<'spot' | 'perp'>(() => {
    const saved = localStorage.getItem('marketType');
    return (saved === 'spot' || saved === 'perp') ? saved : 'spot';
  });
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem('timeframe') || '1m');
  const [currentView, setCurrentView] = useState<View>('DASHBOARD');
  const [spawnRequest, setSpawnRequest] = useState<{ symbol: string; marketType: 'spot' | 'perp'; timestamp: number } | null>(null);
  const [wikiSpawnRequest, setWikiSpawnRequest] = useState<string | null>(null);
  
  // Use shared stream for the global header/ticker
  const { ticker, latency, tickSize } = useSharedStream(activeSymbol, marketType, timeframe);
  
  // Persist state to localStorage
  useEffect(() => {
    localStorage.setItem('activeSymbol', activeSymbol);
  }, [activeSymbol]);

  useEffect(() => {
    localStorage.setItem('marketType', marketType);
  }, [marketType]);

  useEffect(() => {
    localStorage.setItem('timeframe', timeframe);
  }, [timeframe]);

  // Sync active symbol with backend ingestion engine
  useEffect(() => {
    const subscribe = async () => {
      try {
        await fetch('/api/engine/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([activeSymbol])
        });
      } catch (err) {
        console.error("Failed to subscribe backend engine:", err);
      }
    };
    subscribe();
  }, [activeSymbol]);
  
  // Lifted Scanner State
  const scanner = useMarketScanner();

  useEffect(() => {
    const handleOpenWiki = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.slug) {
        setWikiSpawnRequest(customEvent.detail.slug);
        setCurrentView('DASHBOARD');
      }
    };
    window.addEventListener('open-wiki', handleOpenWiki);
    return () => window.removeEventListener('open-wiki', handleOpenWiki);
  }, []);

  const handleActiveChartChange = useCallback((state: { symbol: string, marketType: 'spot' | 'perp', timeframe: string }) => {
    if (!state || !state.symbol || !state.marketType) {
        console.warn("[App] Received invalid state in handleActiveChartChange:", state);
        return;
    }
    setActiveSymbol(state.symbol);
    setMarketType(state.marketType);
    setTimeframe(state.timeframe);
  }, []);

  const handleSelectSymbol = useCallback((symbol: string) => {
    const s = symbol.toLowerCase();
    console.log("[App] Scanner selection triggered for:", s);
    // Defer setting active symbol until the dashboard spawns and selects the new tab
    setSpawnRequest({ symbol: s, marketType, timestamp: Date.now() });
    setCurrentView('DASHBOARD');
  }, [marketType]);

  const handleClearSpawnRequest = useCallback(() => {
    setSpawnRequest(null);
  }, []);

  const handleClearWikiSpawnRequest = useCallback(() => {
    setWikiSpawnRequest(null);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white overflow-hidden font-sans selection:bg-cyan-500/30">
      {/* Navigation / Header - Futuristic Glassmorphism */}
      <div className="h-14 border-b border-white/5 flex items-center px-6 justify-between glass-panel shrink-0 z-50">
        <div className="flex items-center gap-4">
            <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                <Logo size={42} />
            </div>
            <div className="flex flex-col">
                <span className="font-sci-fi font-bold text-xl tracking-tighter text-white leading-none">BREAKORA</span>
            </div>
        </div>
        
        <div className="flex items-center gap-3 bg-black/40 p-1 rounded-xl border border-white/5 shadow-2xl backdrop-blur-xl">
            <NavButton 
                active={currentView === 'DASHBOARD'} 
                onClick={() => setCurrentView('DASHBOARD')}
                icon={<LayoutGrid size={14} />}
                label="DASHBOARD"
            />
            <NavButton 
                active={currentView === 'SCANNER'} 
                onClick={() => setCurrentView('SCANNER')}
                icon={<Zap size={14} />}
                label="SCANNER"
            />
        </div>

        <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
                <span className="text-[10px] font-mono text-zinc-500 uppercase">System Status</span>
                <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(34,211,238,0.8)] animate-pulse" />
                    <span className="text-[10px] font-mono text-cyan-400">ONLINE</span>
                </div>
            </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 relative">
          {currentView === 'DASHBOARD' && (
            <TickerHeader 
                ticker={ticker} 
                latency={latency}
                activeSymbol={activeSymbol}
                onSymbolChange={setActiveSymbol}
                marketType={marketType}
                onMarketTypeChange={setMarketType}
                timeframe={timeframe}
                onTimeframeChange={setTimeframe}
            />
          )}

          {currentView === 'DASHBOARD' && (
            <div className="flex-1 h-full w-full relative min-h-0 flex flex-col">
                <DashboardLayout 
                    symbol={activeSymbol}
                    marketType={marketType}
                    tickSize={tickSize}
                    spawnRequest={spawnRequest}
                    onClearSpawnRequest={handleClearSpawnRequest}
                    wikiSpawnRequest={wikiSpawnRequest}
                    onClearWikiSpawnRequest={handleClearWikiSpawnRequest}
                    onActiveChartChange={handleActiveChartChange}
                />
            </div>
          )}

          {currentView === 'SCANNER' && (
            <ScannerView 
                scanner={scanner}
                onSelectSymbol={handleSelectSymbol}
            />
          )}
      </div>

      {/* Decorative footer line */}
      <div className="h-1 bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent blur-sm" />
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
    return (
        <button 
            onClick={onClick}
            className={cn(
                "flex items-center gap-2 px-4 py-1.5 rounded-lg text-[10px] font-sci-fi transition-all duration-300 relative group overflow-hidden",
                active 
                    ? "text-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.1)]" 
                    : "text-zinc-500 hover:text-zinc-200"
            )}
        >
            {active && (
                <div className="absolute inset-0 bg-cyan-400/10 border border-cyan-400/20 rounded-lg" />
            )}
            <span className={cn("relative z-10", active && "animate-pulse")}>{icon}</span>
            <span className="relative z-10 tracking-[0.1em]">{label}</span>
        </button>
    )
}
