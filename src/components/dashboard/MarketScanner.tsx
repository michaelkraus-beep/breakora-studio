import React from 'react';
import { ArrowUp, ArrowDown, Activity, RefreshCw, Clock, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useMarketScanner } from '../../hooks/use-market-scanner';

interface MarketScannerProps {
    onSelectSymbol?: (symbol: string) => void;
    scannerState: ReturnType<typeof useMarketScanner>;
}

export function MarketScanner({ onSelectSymbol, scannerState }: MarketScannerProps) {
  const { alerts, isScanning, lastScan, filters, setFilters, isSessionActive } = scannerState;
  
  return (
    <div className="flex flex-col h-full bg-zinc-950 overflow-hidden">
      {/* Header - Dashboard Style */}
      <div className="flex flex-col border-b border-zinc-800 bg-zinc-950 shrink-0">
        {/* Top Row: Title & Status */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/50">
            <div className="flex items-center gap-2">
                <Zap className="text-cyan-400" size={16} />
                <h2 className="text-sm font-bold text-zinc-200 font-display tracking-tight uppercase">
                    Algorithmic Market Scanner
                </h2>
            </div>
            <div className="flex items-center gap-4 text-[10px] font-mono">
                 <div className="flex items-center gap-2">
                    <span className="text-zinc-500 uppercase tracking-wider">Status</span>
                    <div className="h-3 w-px bg-zinc-800" />
                    <div className="w-16">
                        {!isSessionActive() ? (
                            <span className="text-zinc-500 flex items-center gap-1.5">
                                <Clock size={10} /> CLOSED
                            </span>
                        ) : isScanning ? (
                            <span className="text-cyan-400 flex items-center gap-1.5">
                                <RefreshCw size={10} className="animate-spin" /> SCANNING
                            </span>
                        ) : (
                            <span className="text-emerald-500 flex items-center gap-1.5">
                                <Activity size={10} /> ACTIVE
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2 pl-4 border-l border-zinc-800">
                    <span className="text-zinc-500 uppercase tracking-wider">Last Scan</span>
                    <span className="text-zinc-300 tabular-nums">{new Date(lastScan).toLocaleTimeString()}</span>
                </div>
            </div>
        </div>

        {/* Bottom Row: Settings Inputs */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 px-4 py-2 bg-zinc-900/30">
            {/* Min Market Cap */}
            <div className="flex flex-col justify-center gap-1">
                <label className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Min Marketcap</label>
                <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded px-2 py-1 h-6">
                    <span className="text-zinc-500 text-[10px] mr-1">$</span>
                    <input 
                        type="number" 
                        value={filters.minMarketCap}
                        onChange={(e) => setFilters(prev => ({ ...prev, minMarketCap: Number(e.target.value) }))}
                        className="w-full bg-transparent border-none text-[10px] font-mono text-zinc-200 focus:ring-0 p-0 placeholder-zinc-700"
                        placeholder="10000000"
                    />
                </div>
            </div>

            {/* Min Volume */}
            <div className="flex flex-col justify-center gap-1">
                <label className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Min 24h Volume</label>
                <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded px-2 py-1 h-6">
                    <span className="text-zinc-500 text-[10px] mr-1">$</span>
                    <input 
                        type="number" 
                        value={filters.minVolume}
                        onChange={(e) => setFilters(prev => ({ ...prev, minVolume: Number(e.target.value) }))}
                        className="w-full bg-transparent border-none text-[10px] font-mono text-zinc-200 focus:ring-0 p-0 placeholder-zinc-700"
                        placeholder="1000000"
                    />
                </div>
            </div>

            {/* Lookback */}
            <div className="flex flex-col justify-center gap-1">
                <label className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Lookback</label>
                <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded h-6 overflow-hidden">
                    <input 
                        type="number" 
                        value={filters.lookbackValue}
                        onChange={(e) => setFilters(prev => ({ ...prev, lookbackValue: Number(e.target.value) }))}
                        className="w-12 bg-transparent border-none text-[10px] font-mono text-zinc-200 focus:ring-0 p-0 pl-2 text-center border-r border-zinc-800"
                    />
                    <select 
                        value={filters.lookbackUnit}
                        onChange={(e) => setFilters(prev => ({ ...prev, lookbackUnit: e.target.value as any }))}
                        className="flex-1 bg-transparent border-none text-[10px] font-mono text-zinc-400 focus:ring-0 p-0 px-1 h-full"
                    >
                        <option value="bars">Periods</option>
                        <option value="minutes">Mins</option>
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                        <option value="weeks">Weeks</option>
                    </select>
                </div>
            </div>

            {/* Min Vol Change */}
            <div className="flex flex-col justify-center gap-1">
                <label className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Min Vol Change %</label>
                <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded px-2 py-1 h-6">
                    <input 
                        type="number" 
                        value={filters.minVolChange}
                        onChange={(e) => setFilters(prev => ({ ...prev, minVolChange: Number(e.target.value) }))}
                        className="w-full bg-transparent border-none text-[10px] font-mono text-zinc-200 focus:ring-0 p-0 placeholder-zinc-700"
                        placeholder="5"
                    />
                    <span className="text-zinc-500 text-[10px] ml-1">%</span>
                </div>
            </div>

            {/* Exchange Hours */}
            <div className="flex flex-col justify-center gap-1">
                <label className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Exchange Hours</label>
                <button 
                    onClick={() => setFilters(prev => ({ ...prev, useExchangeHours: !prev.useExchangeHours }))}
                    className={cn(
                        "flex items-center justify-center gap-2 h-6 rounded text-[10px] font-mono border transition-colors w-full",
                        filters.useExchangeHours 
                            ? "bg-cyan-400/10 border-cyan-400/30 text-cyan-400" 
                            : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300"
                    )}
                >
                    {filters.useExchangeHours ? "ENABLED" : "DISABLED"}
                </button>
            </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-2 pb-6">
        {/* List Header */}
        <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] font-mono text-zinc-500 uppercase border-b border-zinc-800 mb-1 sticky top-0 bg-zinc-950 z-10">
            <div className="col-span-2">Symbol</div>
            <div className="col-span-3">Type</div>
            <div className="col-span-5">Info</div>
            <div className="col-span-2 text-right">First Detected</div>
        </div>

        <div className="flex flex-col gap-1">
        {alerts.map(alert => (
          <div 
            key={alert.id}
            onClick={() => onSelectSymbol && onSelectSymbol(alert.fullSymbol)}
            className={cn(
                "grid grid-cols-12 gap-2 px-4 py-2 rounded border-l-2 border-y-0 border-r-0 transition-all hover:bg-zinc-900 cursor-pointer items-center h-10 animate-in slide-in-from-left-2 duration-200",
                alert.type === 'PRICE_SURGE' && "border-l-cyan-400 bg-cyan-400/5 hover:bg-cyan-400/10",
                alert.type === 'PRICE_DROP' && "border-l-purple-500 bg-purple-500/5 hover:bg-purple-500/10",
                alert.type === 'HIGH_VOLUME' && "border-l-zinc-400 bg-zinc-400/5 hover:bg-zinc-400/10",
                alert.type === 'HIGH_VOLATILITY' && "border-l-zinc-400 bg-zinc-400/5 hover:bg-zinc-400/10"
            )}
          >
            {/* Symbol */}
            <div className="col-span-2 font-bold font-display text-xs text-zinc-200 tracking-tight">
                {alert.symbol}
            </div>

            {/* Type */}
            <div className="col-span-3 flex items-center gap-1.5">
                {alert.type === 'HIGH_VOLUME' && <Activity size={12} className="text-zinc-400" />}
                {alert.type === 'PRICE_SURGE' && <ArrowUp size={12} className="text-cyan-400" />}
                {alert.type === 'PRICE_DROP' && <ArrowDown size={12} className="text-purple-400" />}
                <span className={cn(
                    "text-[10px] font-mono font-bold uppercase",
                    alert.type === 'PRICE_DROP' ? "text-purple-400" : 
                    alert.type === 'PRICE_SURGE' ? "text-cyan-400" : "text-zinc-400"
                )}>
                    {alert.type.replace('_', ' ')}
                </span>
            </div>

            {/* Info / Message */}
            <div className="col-span-5 text-[10px] text-zinc-400 font-mono truncate" title={alert.message}>
                {alert.message}
            </div>

            {/* Time */}
            <div className="col-span-2 text-right text-[10px] text-zinc-600 font-mono flex items-center justify-end gap-1">
                <Clock size={10} />
                {new Date(alert.firstDetected).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}
        </div>

        {alerts.length === 0 && !isScanning && (
            <div className="flex flex-col items-center justify-center h-64 text-zinc-500">
                <div className="mb-4 p-4 bg-zinc-900 rounded-full">
                    <Zap size={24} className="text-zinc-700" />
                </div>
                <p className="text-xs font-mono">No anomalies detected.</p>
            </div>
        )}
      </div>
    </div>
  );
}
