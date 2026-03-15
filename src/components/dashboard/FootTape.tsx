import React, { useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { Candle, Ticker } from '../../types/market';
import { Layers, Zap, Settings } from 'lucide-react';
import { cn } from '../../lib/utils';

interface FootTapeProps {
  candles: Candle[];
  symbol: string;
  ticker: Ticker | null;
  tickSize: number;
}

export function FootTape({ candles, symbol, ticker, tickSize }: FootTapeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tapeTicksPerRow, setTapeTicksPerRow] = React.useState(2);

  useEffect(() => {
    const loadSettings = () => {
      try {
        const saved = localStorage.getItem('chartSettings');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.tapeFootprintTicksPerRow) {
            setTapeTicksPerRow(parsed.tapeFootprintTicksPerRow);
          }
        }
      } catch (e) {}
    };
    loadSettings();

    const handleSettingsChange = (e: any) => {
      if (e.detail && e.detail.tapeFootprintTicksPerRow) {
        setTapeTicksPerRow(e.detail.tapeFootprintTicksPerRow);
      }
    };

    window.addEventListener('chartSettingsChanged', handleSettingsChange);
    return () => window.removeEventListener('chartSettingsChanged', handleSettingsChange);
  }, []);

  const currentCandle = candles[candles.length - 1];
  const currentPrice = ticker?.price || currentCandle?.close || 0;

  const { levels, maxVol } = useMemo(() => {
    if (!currentCandle || !currentCandle.footprint) {
      return { levels: new Map(), maxVol: 0 };
    }

    const fpLevels = Object.values(currentCandle.footprint);
    if (fpLevels.length === 0) return { levels: new Map(), maxVol: 0 };

    let maxV = 0;
    const levelMap = new Map();
    const aggTickSize = tickSize * tapeTicksPerRow;

    fpLevels.forEach(l => {
      // Aggregate price using integer math to avoid floating point issues
      const tickIndex = Math.round(l.price / tickSize);
      const aggTickIndex = Math.floor(tickIndex / tapeTicksPerRow);
      const aggPrice = aggTickIndex * aggTickSize;
      const cleanPrice = Number(aggPrice.toFixed(8));

      if (levelMap.has(cleanPrice)) {
        const existing = levelMap.get(cleanPrice);
        existing.buyVolume += l.buyVolume;
        existing.sellVolume += l.sellVolume;
        existing.delta += l.delta;
      } else {
        levelMap.set(cleanPrice, {
          price: cleanPrice,
          buyVolume: l.buyVolume,
          sellVolume: l.sellVolume,
          delta: l.delta
        });
      }
    });

    levelMap.forEach(l => {
      const tot = l.buyVolume + l.sellVolume;
      if (tot > maxV) maxV = tot;
    });

    return { levels: levelMap, maxVol: maxV };
  }, [currentCandle, tickSize, tapeTicksPerRow]);

  // Generate rows around current price
  const rows = useMemo(() => {
    if (!currentPrice || tickSize <= 0) return [];
    
    const aggTickSize = tickSize * tapeTicksPerRow;
    const rowCount = 40; // 40 rows above, 40 below
    
    // Use integer math for center price
    const centerTickIndex = Math.round(currentPrice / tickSize);
    const centerAggTickIndex = Math.floor(centerTickIndex / tapeTicksPerRow);
    const centerPrice = centerAggTickIndex * aggTickSize;
    
    const generatedRows = [];
    for (let i = rowCount; i >= -rowCount; i--) {
        const price = centerPrice + (i * aggTickSize);
        // Fix floating point precision
        const cleanPrice = Number(price.toFixed(8));
        generatedRows.push(cleanPrice);
    }
    return generatedRows;
  }, [currentPrice, tickSize, tapeTicksPerRow]);

  // Auto-scroll to center synchronously to prevent jitter
  useLayoutEffect(() => {
    if (containerRef.current && rows.length > 0) {
        const container = containerRef.current;
        const rowHeight = 22; // Standard height for our rows
        const centerIdx = 40;
        
        // Calculate the exact scroll position to keep currentPrice at the visual center
        const centerRowPrice = rows[centerIdx];
        const aggTickSize = tickSize * tapeTicksPerRow;
        const priceOffset = (centerRowPrice - currentPrice) / aggTickSize;
        
        // baseScroll is where the middle row (centerIdx) is exactly in the middle of the viewport
        const baseScroll = (container.scrollHeight - container.clientHeight) / 2;
        
        // Adjust scroll by the fractional price offset to keep currentPrice perfectly centered
        container.scrollTop = baseScroll + (priceOffset * rowHeight);
    }
  }, [currentPrice, rows, tickSize, tapeTicksPerRow]);

  const formatVol = (v: number) => {
    if (!v) return '-';
    if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    if (v < 1) return v.toFixed(4);
    return v.toFixed(1);
  };

  const formatPrice = (p: number) => {
      if (p < 1) return p.toFixed(4);
      if (p < 10) return p.toFixed(3);
      return p.toFixed(2);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 font-mono text-[10px] overflow-hidden relative">
      <div className="px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/50 flex flex-col gap-1">
        <div className="flex justify-between items-center">
            <h3 className="text-[10px] font-bold text-cyan-400 font-display tracking-wider flex items-center gap-2">
                <Layers size={10} /> FOOT TAPE
            </h3>
            <div className="flex items-center gap-2">
                <button 
                    className="text-zinc-500 hover:text-zinc-300 transition-colors"
                    title="Settings"
                >
                    <Settings size={10} />
                </button>
            </div>
        </div>
      </div>

      {/* Header */}
      <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr] gap-1 px-2 py-1.5 border-b border-zinc-800 bg-zinc-900/30 text-zinc-500 text-[9px] uppercase tracking-wider text-right">
          <div className="text-left">Price</div>
          <div>Bid Vol</div>
          <div>Ask Vol</div>
          <div>Total</div>
          <div>Delta</div>
      </div>

      {/* Tape Area Wrapper */}
      <div className="flex-1 relative overflow-hidden">
          {/* Permanent Magnifier Lens Frame - Static & Always on Top */}
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[32px] pointer-events-none z-40">
              {/* Outer Glow/Shadow */}
              <div className="absolute inset-0 bg-zinc-500/5 shadow-[0_0_20px_rgba(0,0,0,0.2)] rounded-sm" />
              {/* Top & Bottom Borders (Colored by current candle direction) */}
              <div className={cn(
                  "absolute top-0 left-0 right-0 h-[2px] shadow-[0_1px_5px_rgba(0,0,0,0.3)]",
                  currentCandle && currentCandle.close >= currentCandle.open ? "bg-cyan-400/60" : "bg-purple-500/60"
              )} />
              <div className={cn(
                  "absolute bottom-0 left-0 right-0 h-[2px] shadow-[0_-1px_5px_rgba(0,0,0,0.3)]",
                  currentCandle && currentCandle.close >= currentCandle.open ? "bg-cyan-400/60" : "bg-purple-500/60"
              )} />
              {/* Side Accents */}
              <div className={cn(
                  "absolute top-0 bottom-0 left-0 w-[2px]",
                  currentCandle && currentCandle.close >= currentCandle.open ? "bg-cyan-400/60" : "bg-purple-500/60"
              )} />
              <div className={cn(
                  "absolute top-0 bottom-0 right-0 w-[2px]",
                  currentCandle && currentCandle.close >= currentCandle.open ? "bg-cyan-400/60" : "bg-purple-500/60"
              )} />
          </div>

          {/* Tape List */}
          <div 
            ref={containerRef}
            className="absolute inset-0 overflow-y-auto overflow-x-visible scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
          >
              <div className="flex flex-col py-32 overflow-visible">
                  {rows.map((price, idx) => {
                      // Find closest level in map (handling floating point slight differences)
                      let level = levels.get(price);
                      if (!level) {
                          // Try to find a level that is very close
                          for (const [p, l] of levels.entries()) {
                              if (Math.abs(p - price) < tickSize * 0.1) {
                                  level = l;
                                  break;
                              }
                          }
                      }

                      const isCurrentPrice = Math.abs(price - currentPrice) < tickSize * 0.1;
                      
                      // Magnifier Effect Calculation: Continuous smooth interpolation
                      const priceDist = Math.abs(price - currentPrice) / tickSize;
                      let scale = 1.0;
                      let opacity = 0.5;
                      let blur = 0.4; // Even more subtle max blur for rows outside the lens
                      
                      if (priceDist < 3.0) {
                          // Smooth cosine interpolation for organic lens feel
                          const t = priceDist / 3.0; // 0 to 1
                          const factor = (Math.cos(t * Math.PI) + 1) / 2; // 1 at center, 0 at edge
                          scale = 1.0 + (0.35 * factor); // Max scale 1.35
                          opacity = 0.5 + (0.5 * factor); // Max opacity 1.0
                          blur = 0.4 * (1 - factor); // 0 blur at center, 0.4px at edge
                      }

                      let bgColor = 'transparent';
                      let intensity = 0;
                      let isBuyImbalance = false;
                      let isSellImbalance = false;

                      // FIX: Safety check for values
                      const sellVol = level ? Math.max(0, level.sellVolume || 0) : 0;
                      const buyVol = level ? Math.max(0, level.buyVolume || 0) : 0;
                      const delta = level ? (level.delta || 0) : 0;
                      const totalVol = sellVol + buyVol;

                      if (level) {
                          intensity = totalVol / (maxVol || 1);
                          
                          if (buyVol > sellVol) {
                              bgColor = `rgba(34, 197, 94, ${0.1 + intensity * 0.7})`; // Green
                          } else if (sellVol > buyVol) {
                              bgColor = `rgba(239, 68, 68, ${0.1 + intensity * 0.7})`; // Red
                          } else {
                              bgColor = `rgba(113, 113, 122, ${0.1 + intensity * 0.7})`; // Gray
                          }

                          isBuyImbalance = buyVol > sellVol * 3;
                          isSellImbalance = sellVol > buyVol * 3;
                      }

                      return (
                          <div 
                            key={price} 
                            className={cn(
                                "grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr] gap-1 px-1 py-1 items-center text-right relative border-b border-zinc-900/30 mx-auto",
                                isCurrentPrice ? "bg-zinc-800/20" : "hover:bg-zinc-900/30"
                            )}
                            style={{ 
                                transform: `scale(${scale})`,
                                zIndex: scale > 1 ? 20 : 10,
                                width: '74%', // Reduced slightly to ensure no clipping at 1.35x scale
                                height: '22px',
                                minHeight: '22px',
                                opacity: opacity,
                                filter: `blur(${blur}px)`,
                                fontSize: scale > 1.2 ? '9px' : '8px' // Dynamic font size to fit content
                            }}
                          >
                          {/* Background Color Fill */}
                          {level && (
                              <div 
                                className="absolute inset-0 pointer-events-none" 
                                style={{ backgroundColor: bgColor }}
                              />
                          )}

                          {/* Content */}
                          <div className={cn("text-left relative z-10", isCurrentPrice ? "text-cyan-400 font-bold" : "text-zinc-300")}>
                              {formatPrice(price)}
                          </div>
                          
                          <div className={cn("relative z-10", isSellImbalance ? "text-blue-400 font-bold" : "text-purple-400")}>
                              {level ? formatVol(sellVol) : '-'}
                          </div>
                          
                          <div className={cn("relative z-10", isBuyImbalance ? "text-blue-400 font-bold" : "text-cyan-400")}>
                              {level ? formatVol(buyVol) : '-'}
                          </div>
                          
                          <div className="text-zinc-200 relative z-10">
                              {level ? formatVol(totalVol) : '-'}
                          </div>
                          
                          <div className={cn(
                              "relative z-10 flex items-center justify-end gap-1",
                              delta > 0 ? "text-green-400" : 
                              delta < 0 ? "text-red-400" : "text-zinc-500"
                          )}>
                              {level && delta !== 0 && (
                                  <div className={cn(
                                      "w-0 h-0 border-l-[3px] border-r-[3px] border-transparent",
                                      delta > 0 ? "border-b-[4px] border-b-green-400" : "border-t-[4px] border-t-red-400"
                                  )} />
                              )}
                              <span>{level ? formatVol(Math.abs(delta)) : '-'}</span>
                          </div>
                      </div>
                  );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}
