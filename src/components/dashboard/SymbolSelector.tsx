import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Check, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SymbolSelectorProps {
  currentSymbol: string;
  onSymbolChange: (symbol: string) => void;
  marketType: 'spot' | 'perp';
  onMarketTypeChange: (type: 'spot' | 'perp') => void;
  isCompact?: boolean;
}

interface AssetTicker {
  symbol: string;
  baseAsset: string;
  baseAssetIcon?: string;
  price: number;
  change24h: number;
  volume: number;
}

export function SymbolSelector({ currentSymbol, onSymbolChange, marketType, onMarketTypeChange, isCompact = false }: SymbolSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [assets, setAssets] = useState<Map<string, AssetTicker>>(new Map());
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const wsRef = useRef<WebSocket | null>(null);

  // Auto-position Portal dropdown
  useLayoutEffect(() => {
    if (isOpen && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setDropdownPos({
            top: rect.bottom + window.scrollY,
            left: rect.left + window.scrollX,
            width: Math.max(rect.width, 280) // Minimum width for the search/list
        });
    }
  }, [isOpen]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const baseUrl = `/api/binance/ticker24?type=${marketType}`;
        const res = await fetch(baseUrl);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();
        
        if (!Array.isArray(data)) throw new Error('Invalid data');

        const topAssets = data
            .filter((t: any) => t.symbol.endsWith('USDT'))
            .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

        const initialMap = new Map<string, AssetTicker>();
        topAssets.forEach((t: any) => {
            initialMap.set(t.symbol, {
                symbol: t.symbol,
                baseAsset: t.symbol.replace('USDT', ''),
                price: parseFloat(t.lastPrice),
                change24h: parseFloat(t.priceChangePercent),
                volume: parseFloat(t.quoteVolume)
            });
        });
        
        setAssets(initialMap);
        startStream(topAssets.map((t: any) => t.symbol));
      } catch (e) {
        console.error("Failed to init symbols", e);
      } finally {
        setLoading(false);
      }
    };
    init();
    return () => { if (wsRef.current) wsRef.current.close(); };
  }, [marketType]);

  const startStream = (symbols: string[]) => {
      if (wsRef.current) wsRef.current.close();
      const baseUrl = marketType === 'spot' ? 'wss://stream.binance.com:9443/ws' : 'wss://fstream.binance.com/ws';
      const streams = symbols.map(s => `${s.toLowerCase()}@ticker`).join('/');
      const ws = new WebSocket(`${baseUrl}/${streams}`);
      ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.e === '24hrTicker') {
              setAssets(prev => {
                  const newMap = new Map(prev);
                  const existing = newMap.get(msg.s) as AssetTicker | undefined;
                  if (existing) {
                      newMap.set(msg.s, {
                          ...existing,
                          price: parseFloat(msg.c),
                          change24h: parseFloat(msg.P),
                          volume: parseFloat(msg.q)
                      });
                  }
                  return newMap;
              });
          }
      };
      wsRef.current = ws;
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
          // Check if click was inside portal (this is tricky with createPortal, so we check distance or a portal selector)
          const portalRoot = document.getElementById('symbol-selector-portal');
          if (portalRoot && portalRoot.contains(event.target as Node)) return;
          setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  const filteredAssets = useMemo(() => {
      const list: AssetTicker[] = Array.from(assets.values());
      if (!search) return list;
      return list.filter(a => 
          a.symbol.toLowerCase().includes(search.toLowerCase()) || 
          a.baseAsset.toLowerCase().includes(search.toLowerCase())
      );
  }, [assets, search]);

  if (isCompact) {
      const formatPrice = (price: number) => {
          if (!price) return '0,00';
          return price < 1 
            ? price.toFixed(4) 
            : price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      };

      return (
        <div className="relative inline-flex items-center" ref={wrapperRef}>
            <div className="flex items-center gap-1.5 h-full">
                <button 
                    ref={buttonRef}
                    onClick={() => setIsOpen(!isOpen)}
                    className={cn(
                        "flex items-center gap-2 hover:bg-zinc-800/80 px-2.5 py-1 rounded border border-zinc-800 transition-all group h-7 min-w-[90px] justify-between",
                        isOpen && "bg-zinc-800 border-cyan-500/50 shadow-[0_0_10px_rgba(34,211,238,0.15)]"
                    )}
                >
                    <span className="text-[10px] font-bold text-cyan-400 font-mono tracking-wider flex items-center whitespace-nowrap overflow-hidden">
                        {currentSymbol.toUpperCase()}
                        <ChevronDown size={12} className={cn("ml-1.5 text-zinc-500 shrink-0 transition-transform duration-300", isOpen && "rotate-180 text-cyan-400")} />
                    </span>
                </button>
                
                <div className="flex bg-zinc-900/40 rounded p-0.5 border border-zinc-800/30 h-7 items-center">
                    <button 
                        onClick={() => onMarketTypeChange('spot')}
                        className={cn(
                            "px-1.5 h-full flex items-center text-[9px] font-mono rounded transition-all",
                            marketType === 'spot' ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30" : "text-zinc-600 hover:text-zinc-400 border border-transparent"
                        )}
                    >
                        S
                    </button>
                    <button 
                        onClick={() => onMarketTypeChange('perp')}
                        className={cn(
                            "px-1.5 h-full flex items-center text-[9px] font-mono rounded transition-all",
                            marketType === 'perp' ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30" : "text-zinc-600 hover:text-zinc-400 border border-transparent"
                        )}
                    >
                        P
                    </button>
                </div>
            </div>

            {isOpen && createPortal(
                <div 
                    id="symbol-selector-portal"
                    className="fixed mt-1 bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl z-[99999] flex flex-col max-h-[500px] animate-in fade-in zoom-in-95 duration-150 overflow-hidden"
                    style={{ 
                        top: dropdownPos.top, 
                        left: dropdownPos.left,
                        width: Math.max(dropdownPos.width, 320)
                    }}
                >
                    <div className="p-2 border-b border-zinc-800 shrink-0 bg-zinc-950/95 backdrop-blur-md sticky top-0 z-10">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={13} />
                            <input 
                                type="text" 
                                placeholder="Search markets..." 
                                className="w-full bg-zinc-900/50 border border-zinc-800/80 rounded pl-9 pr-2 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500/50 focus:bg-zinc-900 transition-all font-mono"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                autoFocus
                            />
                        </div>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-1.5 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                        {loading && assets.size === 0 ? (
                            <div className="flex flex-col items-center justify-center p-12 text-zinc-500 gap-3">
                                <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                                <span className="text-[10px] font-mono uppercase tracking-widest animate-pulse">Synchronizing</span>
                            </div>
                        ) : (
                            <div className="space-y-0.5">
                                {filteredAssets.map((asset) => (
                                    <button
                                        key={asset.symbol}
                                        onClick={() => {
                                            onSymbolChange(asset.symbol.toLowerCase());
                                            setIsOpen(false);
                                            setSearch('');
                                        }}
                                        className={cn(
                                            "w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-zinc-900 hover:shadow-inner transition-all text-left group border border-transparent hover:border-zinc-800/50",
                                            currentSymbol.toUpperCase() === asset.symbol && "bg-cyan-500/10 border-cyan-500/20 shadow-[inset_0_0_10px_rgba(34,211,238,0.05)]"
                                        )}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-7 h-7 rounded-full bg-zinc-800/50 flex items-center justify-center shrink-0 overflow-hidden border border-zinc-700/50 group-hover:border-zinc-600 transition-colors">
                                                <img 
                                                    src={`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/icon/${asset.baseAsset.toLowerCase()}.png`}
                                                    alt={asset.baseAsset}
                                                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-all"
                                                    onError={(e) => {
                                                        (e.target as HTMLImageElement).style.display = 'none';
                                                        (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                                                    }}
                                                />
                                                <span className="hidden text-[10px] font-bold text-zinc-500">{asset.baseAsset[0]}</span>
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className={cn("font-bold text-sm leading-tight", currentSymbol.toUpperCase() === asset.symbol ? "text-cyan-400" : "text-zinc-100")}>
                                                        {asset.baseAsset}
                                                    </span>
                                                    {marketType === 'perp' && (
                                                        <span className="text-[8px] bg-amber-500/10 text-amber-500 px-1 rounded-sm border border-amber-500/20 font-bold">PERP</span>
                                                    )}
                                                </div>
                                                <span className="text-[9px] text-zinc-500 font-mono tracking-tighter opacity-70">{asset.symbol}</span>
                                            </div>
                                        </div>
                                        
                                        <div className="flex flex-col items-end shrink-0 gap-0.5">
                                            <span className="text-xs font-mono font-bold text-zinc-100 tabular-nums">
                                                {formatPrice(asset.price)}
                                            </span>
                                            <div className={cn(
                                                "flex items-center gap-1 text-[9px] font-mono font-bold tabular-nums px-1.5 py-0.5 rounded-sm",
                                                asset.change24h >= 0 ? "text-emerald-400 bg-emerald-400/5 border border-emerald-400/10" : "text-rose-400 bg-rose-400/5 border border-rose-400/10"
                                            )}>
                                                {asset.change24h >= 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                                                {Math.abs(asset.change24h).toFixed(2)}%
                                            </div>
                                        </div>
                                    </button>
                                ))}
                                {filteredAssets.length === 0 && (
                                    <div className="flex flex-col items-center justify-center py-10 text-zinc-600 gap-2">
                                        <Search size={24} className="opacity-20" />
                                        <span className="text-[10px] font-mono tracking-widest uppercase">No assets found</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="p-2 bg-zinc-900/30 border-t border-zinc-900 flex justify-between items-center px-4">
                        <span className="text-[8px] text-zinc-600 font-mono uppercase tracking-widest">{marketType} markets</span>
                        <span className="text-[8px] text-zinc-600 font-mono uppercase tracking-widest">{filteredAssets.length} symbols</span>
                    </div>
                </div>,
                document.body
            )}
        </div>
      );
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="flex items-center gap-2">
        <button 
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-2 hover:bg-zinc-900 p-2 rounded-lg transition-colors group"
        >
            <h1 className="text-3xl font-bold text-white font-display tracking-tight flex items-center gap-2">
                {currentSymbol.toUpperCase()}
                <ChevronDown size={20} className={cn("text-zinc-500 transition-transform duration-200", isOpen && "rotate-180")} />
            </h1>
        </button>
        
        <div className="flex bg-zinc-900 rounded-lg p-0.5 border border-zinc-800">
            <button 
                onClick={() => onMarketTypeChange('spot')}
                className={cn(
                    "px-2 py-0.5 text-[10px] font-mono rounded transition-all",
                    marketType === 'spot' ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"
                )}
            >
                SPOT
            </button>
            <button 
                onClick={() => onMarketTypeChange('perp')}
                className={cn(
                    "px-2 py-0.5 text-[10px] font-mono rounded transition-all",
                    marketType === 'perp' ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"
                )}
            >
                PERP
            </button>
        </div>
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-80 bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl z-50 flex flex-col max-h-[500px] min-h-[300px] animate-in fade-in zoom-in-95 duration-100 overflow-hidden">
            <div className="p-3 border-b border-zinc-800 shrink-0 bg-zinc-950/95 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/80 sticky top-0 z-10">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
                    <input 
                        type="text" 
                        placeholder="Search asset..." 
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/50 font-mono"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        autoFocus
                    />
                </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                {loading && assets.size === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-2">
                        <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs font-mono">Loading market data...</span>
                    </div>
                ) : (
                    <>
                        {filteredAssets.map((asset) => (
                            <button
                                key={asset.symbol}
                                onClick={() => {
                                    onSymbolChange(asset.symbol.toLowerCase());
                                    setIsOpen(false);
                                    setSearch('');
                                }}
                                className={cn(
                                    "w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-zinc-900 transition-colors text-left group shrink-0 border border-transparent hover:border-zinc-800",
                                    currentSymbol.toUpperCase() === asset.symbol && "bg-cyan-400/5 border-cyan-400/20"
                                )}
                            >
                                {/* Left: Avatar + Symbol */}
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 overflow-hidden border border-zinc-700">
                                        <img 
                                            src={`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/icon/${asset.baseAsset.toLowerCase()}.png`}
                                            alt={asset.baseAsset}
                                            className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                                (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                                            }}
                                        />
                                        <span className="hidden text-[10px] font-bold text-zinc-400">{asset.baseAsset[0]}</span>
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className={cn("font-bold font-display text-sm truncate", currentSymbol.toUpperCase() === asset.symbol ? "text-cyan-400" : "text-zinc-200")}>
                                            {asset.baseAsset}
                                        </span>
                                        <span className="text-[10px] text-zinc-500 font-medium truncate">
                                            {asset.symbol}
                                        </span>
                                    </div>
                                </div>

                                {/* Right: Price Stack */}
                                <div className="flex flex-col items-end shrink-0">
                                    <span className="text-sm font-mono font-medium text-zinc-200 tabular-nums tracking-tight">
                                        {asset.price < 1 ? asset.price.toFixed(4) : asset.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                    <div className={cn(
                                        "flex items-center gap-1 text-[10px] font-mono tabular-nums font-medium",
                                        asset.change24h >= 0 ? "text-emerald-400" : "text-rose-400"
                                    )}>
                                        {asset.change24h >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                        {Math.abs(asset.change24h).toFixed(2)}%
                                    </div>
                                </div>
                            </button>
                        ))}
                        {filteredAssets.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-full text-zinc-500 py-8">
                                <span className="text-xs font-mono">No assets found</span>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
      )}
    </div>
  );
}
