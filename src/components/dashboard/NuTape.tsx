import React, { useEffect, useState, useRef } from 'react';
import { Trade, Ticker } from '../../types/market';
import { ArrowUp, ArrowDown, Activity, Layers, Zap, AlertTriangle, Settings, Clock, DollarSign } from 'lucide-react';
import { cn } from '../../lib/utils';

interface NuTapeProps {
  trades: Trade[];
  symbol: string;
  ticker: Ticker | null;
}

interface TapeEvent {
  id: string;
  time: number;
  price: number;
  type: 'IMBALANCE_BUY' | 'IMBALANCE_SELL' | 'ABSORPTION' | 'LARGE_ORDER' | 'SWEEP';
  volume: number;
  message: string;
  delta?: number;
}

export function NuTape({ trades, symbol, ticker }: NuTapeProps) {
  const [events, setEvents] = useState<TapeEvent[]>([]);
  const lastProcessedTradeId = useRef<number>(0);
  const priceLevels = useRef<Map<number, number>>(new Map()); // Price -> Volume accumulator for Absorption
  
  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [largeOrderMultiplier, setLargeOrderMultiplier] = useState(10); // Default increased to 10x
  
  type BaselineMode = '24h' | '1h' | '4h' | 'US_OPEN' | 'EU_OPEN' | 'ASIA_OPEN';
  const [baselineMode, setBaselineMode] = useState<BaselineMode>('24h');
  const [customAvgTradeSize, setCustomAvgTradeSize] = useState<number | null>(null);
  const [loadingBaseline, setLoadingBaseline] = useState(false);

  // Calculate dynamic threshold
  let avgTradeSize = 1000; // Default fallback

  if (baselineMode === '24h') {
      if (ticker && ticker.count && ticker.count > 0) {
          const quoteVolume = ticker.quoteVolume || (ticker.volume * ticker.price);
          avgTradeSize = quoteVolume / ticker.count;
      }
  } else if (customAvgTradeSize !== null) {
      avgTradeSize = customAvgTradeSize;
  }

  // Fetch baseline data when mode changes
  useEffect(() => {
    if (baselineMode === '24h') {
        setCustomAvgTradeSize(null);
        return;
    }

    const fetchBaseline = async () => {
        setLoadingBaseline(true);
        try {
            // Determine start time
            const now = new Date();
            let startTime = 0;
            
            if (baselineMode === '1h') {
                startTime = now.getTime() - 60 * 60 * 1000;
            } else if (baselineMode === '4h') {
                startTime = now.getTime() - 4 * 60 * 60 * 1000;
            } else {
                // Session Opens (UTC)
                const currentYear = now.getUTCFullYear();
                const currentMonth = now.getUTCMonth();
                const currentDate = now.getUTCDate();
                
                let hour = 0;
                let minute = 0;
                
                if (baselineMode === 'US_OPEN') { hour = 13; minute = 30; }
                else if (baselineMode === 'EU_OPEN') { hour = 7; minute = 0; }
                else if (baselineMode === 'ASIA_OPEN') { hour = 0; minute = 0; }
                
                const openTime = Date.UTC(currentYear, currentMonth, currentDate, hour, minute);
                // If open time is in future (e.g. it's 5 AM and we want US Open 13:30), go back to yesterday
                startTime = openTime > now.getTime() ? openTime - 24 * 60 * 60 * 1000 : openTime;
            }

            // Fetch 1m klines to calculate avg trade size
            // We need enough candles to cover the period
            const durationMs = now.getTime() - startTime;
            const limit = Math.min(1000, Math.ceil(durationMs / 60000)); // Max 1000 minutes
            
            // Use proxy
            const res = await fetch(`/api/binance/klines?symbol=${symbol.toUpperCase()}&interval=1m&limit=${limit}&type=spot`); // Assuming spot for now, or pass prop
            const data = await res.json();
            
            if (Array.isArray(data)) {
                let totalQuoteVol = 0;
                let totalTrades = 0;
                
                data.forEach((k: any) => {
                    // k[7] is Quote Asset Volume, k[8] is Number of trades
                    totalQuoteVol += parseFloat(k[7]);
                    totalTrades += parseInt(k[8]);
                });
                
                if (totalTrades > 0) {
                    setCustomAvgTradeSize(totalQuoteVol / totalTrades);
                }
            }
        } catch (e) {
            console.error("Failed to fetch baseline", e);
        } finally {
            setLoadingBaseline(false);
        }
    };

    fetchBaseline();
  }, [baselineMode, symbol]);

  const LARGE_ORDER_THRESHOLD = avgTradeSize * largeOrderMultiplier;

  useEffect(() => {
    if (trades.length === 0) return;

    const newTrades = trades.filter(t => t.id > lastProcessedTradeId.current);
    if (newTrades.length === 0) return;

    const newEvents: TapeEvent[] = [];
    const now = Date.now();

    // Process new trades
    newTrades.forEach(trade => {
      const isBuy = !trade.isBuyerMaker;
      const volume = trade.quantity * trade.price; // Volume in Quote Asset (USDT)
      
      // Logic for Absorption
      const currentVol = priceLevels.current.get(trade.price) || 0;
      const newVol = currentVol + volume;
      priceLevels.current.set(trade.price, newVol);
      
      let isAbsorption = false;
      if (newVol > LARGE_ORDER_THRESHOLD * 5) {
         if (Math.random() > 0.7) {
             isAbsorption = true;
             priceLevels.current.delete(trade.price);
         }
      }

      const isLarge = volume > LARGE_ORDER_THRESHOLD;
      const isImbalance = volume > LARGE_ORDER_THRESHOLD / 2;

      if (!isLarge && !isImbalance && !isAbsorption) return;

      let type: TapeEvent['type'] = 'LARGE_ORDER'; // Default fallback
      let message = '';

      if (isAbsorption) {
          type = 'ABSORPTION';
          message = isLarge ? 'Large Absorption' : 'Absorption';
      } else {
          // It's Large or Imbalance (or both)
          const prefix = isLarge ? 'Large ' : '';
          const side = isBuy ? 'Buy' : 'Sell';
          const suffix = isImbalance ? ' Imbalance' : '';
          
          message = `${prefix}${side}${suffix}`;
          
          if (isImbalance) {
              type = isBuy ? 'IMBALANCE_BUY' : 'IMBALANCE_SELL';
          } else {
              type = 'LARGE_ORDER';
          }
      }

      newEvents.push({
          id: `${trade.id}`,
          time: trade.time,
          price: trade.price,
          type,
          volume,
          message,
          delta: isBuy ? volume : -volume
      });
    });

    lastProcessedTradeId.current = newTrades[0].id; 

    if (newEvents.length > 0) {
        setEvents(prev => [...newEvents, ...prev].slice(0, 50));
    }
  }, [trades, ticker, largeOrderMultiplier]);

  // Calculate Supply/Demand Balance from recent trades
  const recentTrades = trades.slice(0, 100);
  const buyVol = recentTrades.filter(t => !t.isBuyerMaker).reduce((acc, t) => acc + (t.price * t.quantity), 0);
  const sellVol = recentTrades.filter(t => t.isBuyerMaker).reduce((acc, t) => acc + (t.price * t.quantity), 0);
  const totalVol = buyVol + sellVol;
  const buyPercentage = totalVol > 0 ? (buyVol / totalVol) * 100 : 50;

  // Helper for dynamic price formatting
  const formatPrice = (p: number) => {
    if (p < 0.1) return p.toFixed(5);
    if (p < 1) return p.toFixed(4);
    if (p < 10) return p.toFixed(3);
    return p.toFixed(2);
  };

  // Helper for dynamic volume formatting
  const formatVolume = (vol: number) => {
    if (vol >= 1000000) return `$${(vol / 1000000).toFixed(2)}M`;
    if (vol >= 1000) return `$${(vol / 1000).toFixed(1)}k`;
    return `$${vol.toFixed(0)}`;
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 font-mono text-[10px] overflow-hidden relative">
      <div className="px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/50 flex flex-col gap-1">
        <div className="flex justify-between items-center">
            <h3 className="text-[10px] font-bold text-cyan-400 font-display tracking-wider flex items-center gap-2">
                <Zap size={10} /> NU TAPE
            </h3>
            <div className="flex items-center gap-2">
                <button 
                    onClick={() => setShowSettings(!showSettings)}
                    className="text-zinc-500 hover:text-zinc-300 transition-colors"
                    title="Settings"
                >
                    <Settings size={10} />
                </button>
            </div>
        </div>
        
        {/* Supply/Demand Balance Bar */}
        <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden flex">
            <div 
                className="h-full bg-cyan-400 transition-all duration-500 ease-out"
                style={{ width: `${buyPercentage}%` }}
            />
            <div 
                className="h-full bg-purple-500 transition-all duration-500 ease-out"
                style={{ width: `${100 - buyPercentage}%` }}
            />
        </div>
      </div>

      {showSettings && (
          <div className="absolute top-8 left-0 right-0 bg-zinc-900 border-b border-zinc-800 p-2 z-20 animate-in slide-in-from-top-2 shadow-xl">
              <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-baseline">
                        <label className="text-[9px] text-zinc-400 uppercase font-bold">Baseline Period</label>
                        {loadingBaseline && <span className="text-[8px] text-cyan-400 animate-pulse">Updating...</span>}
                    </div>
                    <select 
                        value={baselineMode}
                        onChange={(e) => setBaselineMode(e.target.value as BaselineMode)}
                        className="w-full bg-zinc-700 text-zinc-200 text-[10px] rounded px-1 py-1 border-none focus:ring-1 focus:ring-cyan-400"
                    >
                        <option value="24h">24h Rolling (Default)</option>
                        <option value="1h">Last 1 Hour</option>
                        <option value="4h">Last 4 Hours</option>
                        <option value="ASIA_OPEN">Since Asia Open (00:00 UTC)</option>
                        <option value="EU_OPEN">Since EU Open (07:00 UTC)</option>
                        <option value="US_OPEN">Since US Open (13:30 UTC)</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-baseline">
                        <label className="text-[9px] text-zinc-400 uppercase font-bold">Large Order Multiplier</label>
                        <span className="text-zinc-200 font-mono text-[10px]">{largeOrderMultiplier}x</span>
                    </div>
                    <input 
                        type="range" 
                        min="1" 
                        max="100" 
                        step="1"
                        value={largeOrderMultiplier}
                        onChange={(e) => setLargeOrderMultiplier(parseFloat(e.target.value))}
                        className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 text-[9px] font-mono bg-zinc-950/50 p-1.5 rounded border border-zinc-800/50">
                      <div className="flex flex-col">
                          <span className="text-zinc-500">{baselineMode === '24h' ? '24h Avg Trade' : 'Period Avg Trade'}</span>
                          <span className="text-zinc-300">
                              {formatVolume(avgTradeSize)}
                          </span>
                      </div>
                      <div className="flex flex-col">
                          <span className="text-zinc-500">Threshold</span>
                          <span className="text-cyan-400 font-bold">
                              {formatVolume(LARGE_ORDER_THRESHOLD)}
                          </span>
                      </div>
                  </div>
                  
                  <p className="text-[8px] text-zinc-500 leading-tight">
                      Showing trades &gt; {largeOrderMultiplier}x the 24h average size.
                  </p>
              </div>
          </div>
      )}

      <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
        {events.map(event => (
            <div 
                key={event.id} 
                className={cn(
                    "flex flex-col justify-center px-2 py-1 rounded border-l-2 border-y-0 border-r-0 transition-all animate-in slide-in-from-left-2 duration-200 h-8",
                    event.type === 'IMBALANCE_BUY' && "border-l-cyan-400 bg-cyan-400/5",
                    event.type === 'IMBALANCE_SELL' && "border-l-purple-500 bg-purple-500/5",
                    event.type === 'LARGE_ORDER' && (event.delta && event.delta > 0 ? "border-l-cyan-400 bg-cyan-400/5" : "border-l-purple-500 bg-purple-500/5"),
                    event.type === 'ABSORPTION' && "border-l-zinc-400 bg-zinc-400/5",
                )}
            >
                {/* Row 1: Price | Volume (Avg) */}
                <div className="flex justify-between items-baseline leading-none">
                    <span className="font-bold text-zinc-200 text-[10px]">{formatPrice(event.price)}</span>
                    <div className="flex items-baseline gap-1">
                        <span className="text-zinc-300 font-bold text-[10px]">
                            {formatVolume(event.volume)}
                        </span>
                        <span className="text-[8px] text-zinc-500">
                            ({(event.volume / avgTradeSize).toFixed(1)}x)
                        </span>
                    </div>
                </div>

                {/* Row 2: Message | Time */}
                <div className="flex justify-between items-center mt-0.5 leading-none">
                    <span className={cn(
                        "text-[8px] font-bold uppercase flex items-center gap-1",
                        event.type === 'IMBALANCE_BUY' && "text-cyan-400",
                        event.type === 'IMBALANCE_SELL' && "text-purple-400",
                        event.type === 'LARGE_ORDER' && (event.delta && event.delta > 0 ? "text-cyan-400" : "text-purple-400"),
                        event.type === 'ABSORPTION' && "text-zinc-400",
                    )}>
                        {event.type === 'ABSORPTION' && <Layers size={8} />}
                        {event.type.includes('IMBALANCE') && <Activity size={8} />}
                        {event.type === 'LARGE_ORDER' && <AlertTriangle size={8} />}
                        {event.message}
                    </span>
                    <span className="text-[8px] text-zinc-600 flex items-center gap-0.5">
                        <Clock size={6} />
                        {new Date(event.time).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                </div>
            </div>
        ))}
        {events.length === 0 && (
            <div className="text-center text-zinc-600 py-8 italic text-[10px]">
                Waiting for significant order flow...
            </div>
        )}
      </div>
    </div>
  );
}
