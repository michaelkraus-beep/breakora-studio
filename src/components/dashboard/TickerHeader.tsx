import React from 'react';
import { Ticker } from '../../types/market';
import { cn } from '../../lib/utils';
import { ArrowUp, ArrowDown, Plus } from 'lucide-react';
import { SymbolSelector } from './SymbolSelector';

interface TickerHeaderProps {
  ticker: Ticker | null;
  latency: number;
  activeSymbol: string;
  onSymbolChange: (symbol: string) => void;
  marketType: 'spot' | 'perp';
  onMarketTypeChange: (type: 'spot' | 'perp') => void;
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
}

export function TickerHeader({ ticker, latency, activeSymbol, onSymbolChange, marketType, onMarketTypeChange, timeframe, onTimeframeChange }: TickerHeaderProps) {
  if (!ticker) return <div className="h-10 bg-zinc-950 animate-pulse border-b border-zinc-800" />;

  const isPositive = ticker.priceChangePercent >= 0;

  const formatPrice = (p: number) => {
    if (p < 0.1) return p.toFixed(5);
    if (p < 1) return p.toFixed(4);
    if (p < 10) return p.toFixed(3);
    return p.toFixed(2);
  };

  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-zinc-950 border-b border-zinc-800 shrink-0 h-10 relative z-40">
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex flex-row items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 px-2 py-1 bg-zinc-900/30 rounded border border-zinc-800/50">
            <span className="text-xs font-bold text-zinc-400 font-display tracking-wider">BINANCE</span>
          </div>

          <div className="flex items-center gap-1.5 pl-1 border-l border-zinc-800">
            <div className="relative flex h-1.5 w-1.5 shrink-0 ml-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-500"></span>
            </div>
            <div className="flex items-center gap-1 whitespace-nowrap">
                <span className="text-[8px] font-mono text-zinc-600 w-[32px] inline-block text-right tabular-nums">{latency}ms</span>
            </div>
          </div>
        </div>
        
        <div className="h-6 w-px bg-zinc-800 mx-2" />

        <div className="flex items-baseline gap-2">
          <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">Mark</span>
          <span className={cn("text-sm font-mono font-medium tracking-tight leading-tight", isPositive ? "text-cyan-400" : "text-purple-400")}>
            {formatPrice(ticker.price)}
          </span>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">24h</span>
          <div className={cn("flex items-center gap-0.5 font-mono text-[10px]", isPositive ? "text-cyan-400" : "text-purple-400")}>
            {isPositive ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
            <span>{ticker.priceChangePercent.toFixed(2)}%</span>
          </div>
        </div>

        <div className="flex items-baseline gap-2">
            <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">Vol</span>
            <span className="text-zinc-300 font-mono text-[10px]">
                {Number(ticker.volume).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
        </div>
        
        <div className="flex items-baseline gap-2">
            <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">High</span>
            <span className="text-zinc-300 font-mono text-[10px]">{formatPrice(ticker.high)}</span>
        </div>

        <div className="flex items-baseline gap-2">
            <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">Low</span>
            <span className="text-zinc-300 font-mono text-[10px]">{formatPrice(ticker.low)}</span>
        </div>
      </div>
    </div>
  );
}
