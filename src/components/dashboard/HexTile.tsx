import React, { useMemo, useState, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { ScanResult } from '../../types/scanner';
import {
  TrendingUp, Activity, Zap, BarChart3,
  ArrowUpRight, ArrowDownRight, Target, Layers,
  Percent, Gauge, Filter
} from 'lucide-react';

interface HexTileProps {
  key?: React.Key;
  result: ScanResult;
  onClick: () => void;
  onHover?: (symbol: string | null) => void;
  delay?: number;
  isActive?: boolean;
}

/** Map score 0-100 to colors/glows */
function scoreToColor(score: number): { bg: string; border: string; glow: string; text: string; outline: string } {
  if (score >= 70) return {
    bg: 'rgba(168, 85, 247, 0.25)',
    border: 'rgba(126, 34, 206, 0.8)',
    glow: '0 0 45px rgba(168, 85, 247, 0.5)',
    text: 'text-purple-400',
    outline: 'border-purple-500/90',
  };
  if (score >= 45) return {
    bg: 'rgba(34, 211, 238, 0.22)',
    border: 'rgba(8, 145, 178, 0.75)',
    glow: '0 0 35px rgba(34, 211, 238, 0.4)',
    text: 'text-cyan-400',
    outline: 'border-cyan-500/90',
  };
  if (score >= 25) return {
    bg: 'rgba(34, 211, 238, 0.12)',
    border: 'rgba(34, 211, 238, 0.6)',
    glow: '0 0 25px rgba(34, 211, 238, 0.3)',
    text: 'text-cyan-500',
    outline: 'border-cyan-500/70',
  };
  return {
    bg: 'rgba(39, 39, 42, 0.35)',
    border: 'rgba(82, 82, 91, 0.7)',
    glow: 'none',
    text: 'text-zinc-500',
    outline: 'border-zinc-700/80',
  };
}

/** Specific item value display helper */
function StatRow({ icon: Icon, label, value, colorClass = "text-zinc-300" }: { icon: any, label: string, value: string | number, colorClass?: string }) {
  if (value === undefined || value === null || (typeof value === 'number' && isNaN(value)) || value === "NONE" || value === "NEUTRAL") return null;

  return (
    <div className="flex items-center justify-between gap-2.5 px-2.5 py-1.5 rounded bg-white/[0.02] border border-white/[0.03]">
      <div className="flex items-center gap-1.5 min-w-0">
        <Icon size={11} className="text-zinc-500 shrink-0" />
        <span className="text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-tight truncate">{label}</span>
      </div>
      <span className={cn("text-[10px] font-mono font-black tabular-nums shrink-0", colorClass)}>{value}</span>
    </div>
  );
}

export function HexTileComponent({ result, onClick, onHover, delay = 0, isActive = false }: HexTileProps) {
  const colors = scoreToColor(result.score || 0);
  const topFilter = (result.triggered_filters && result.triggered_filters[0]) || 'STABLE';
  const tileRef = useRef<HTMLDivElement>(null);
  const [translateOffset, setTranslateOffset] = useState({ x: 0, y: 0 });
  const [flash, setFlash] = useState(false);
  const [internalZIndex, setInternalZIndex] = useState(100);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync internal z-index with isActive but with a delay for shrinking
  useEffect(() => {
    if (isActive) {
      setInternalZIndex(1000);
    } else {
      const timer = setTimeout(() => setInternalZIndex(100), 1000);
      return () => clearTimeout(timer);
    }
  }, [isActive]);

  // CHANGE DETECTION FOR GLOW PULSE
  const detectionKey = `${result.score.toFixed(0)}-${result.triggered_filters.join(',')}`;
  useEffect(() => {
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 2000); 
    return () => clearTimeout(timer);
  }, [detectionKey]);

  // DYNAMIC SCALE CALCULATION
  const activeStatsCount = useMemo(() => {
    let count = 6;
    if ((result.rsi || 50) < 35 || (result.rsi || 50) > 65) count++;
    if (result.macd_signal && result.macd_signal !== 'NEUTRAL') count++;
    if (result.bollinger_b !== undefined && (result.bollinger_b > 1 || result.bollinger_b < 0)) count++;
    if (result.ema_alignment && result.ema_alignment !== 'MIXED') count++;
    if (result.is_new_high || result.is_new_low) count++;
    if (result.delta_divergence) count++;
    if ((result.imbalance_ratio || 0) > 3) count++;
    if ((result.stacked_imbalance || 0) > 0) count++;
    return count;
  }, [result]);

  const hoverScale = Math.min(5.5, 3.5 + (activeStatsCount * 0.15));

  // SMART EXPANSION DIRECTION & DELAY
  const handleMouseEnter = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    
    hoverTimerRef.current = setTimeout(() => {
      onHover?.(result.symbol);
    }, 300); // Intentional delay: 300ms
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    onHover?.(null);
  };

  // Center when active
  useEffect(() => {
    if (isActive) {
      // Small delay to allow chart preview/layout shifts to settle
      const timer = setTimeout(() => {
        if (tileRef.current) {
          const rect = tileRef.current.getBoundingClientRect();
          const cX = window.innerWidth / 2;
          const cY = window.innerHeight / 2;
          const tX = rect.left + rect.width / 2;
          const tY = rect.top + rect.height / 2;
          setTranslateOffset({ x: cX - tX, y: cY - tY });
        }
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setTranslateOffset({ x: 0, y: 0 });
    }
  }, [isActive]);

  return (
    <button
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "hex-tile-wrapper group relative outline-none focus:outline-none pointer-events-auto",
        isActive && "is-expanded"
      )}
      style={{
        animationDelay: `${delay}ms`,
        transformOrigin: 'center',
        width: '120px',
        height: '138px',
        display: 'block',
        zIndex: internalZIndex,
        position: 'relative',
        pointerEvents: 'auto'
      } as React.CSSProperties}
    >
      <div
        ref={tileRef}
        onClick={onClick}
        className={cn(
          "hex-tile relative w-full h-full transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform cursor-pointer",
          flash && "animate-detection-flash"
        )}
        style={{
          clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
          background: colors.bg,
          transform: isActive 
            ? `translate(${translateOffset.x}px, ${translateOffset.y}px) scale(${hoverScale})` 
            : `scale(1)`,
          '--hex-hover-scale': hoverScale
        } as React.CSSProperties}
      >
        {/* Glow & Border */}
        <div className={cn("absolute inset-0 transition-opacity duration-300 opacity-70 group-hover:opacity-100 border-2", colors.outline.replace('border-', 'border-'))}
          style={{
            clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
            boxShadow: flash ? `inset 0 0 50px ${colors.border}` : `inset 0 0 30px ${colors.border}`
          }} />

        <div className={cn(
          "absolute inset-[2.5px] flex flex-col items-center justify-center bg-[#070709]/75 backdrop-blur-md transition-all duration-500",
          isActive ? "bg-[#070709]/100 backdrop-blur-none shadow-2xl" : "group-hover:bg-[#070709]/100 group-hover:backdrop-blur-none"
        )}
          style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }}>

          <div className="absolute inset-0 flex flex-col items-center justify-center transition-all duration-500 group-hover:opacity-0 group-hover:scale-75 group-hover:pointer-events-none z-10 pointer-events-none">
            <span className="font-display font-black text-[14px] text-white/90 leading-none mb-1 tracking-tight">
              {result.symbol.replace('usdt', '').toUpperCase()}
            </span>
            <div className="flex flex-col items-center gap-0.5 opacity-80">
              <span className="text-[9px] font-mono text-zinc-400 tabular-nums">
                ${(result.price || 0).toLocaleString(undefined, { maximumFractionDigits: ((result.price || 0) < 1 ? 5 : 2) })}
              </span>
              <div className={cn("text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1", colors.text)}>
                <Filter size={8} />
                {topFilter}
              </div>
              <div className="flex items-center gap-1.5">
                <span className={cn("text-[10px] font-mono font-black italic", colors.text)}>
                  {(result.score || 0).toFixed(0)}
                </span>
                {result.market_cap_tier && (
                  <span className={cn("text-[7px] font-mono font-bold px-1 py-px rounded border leading-none",
                    result.market_cap_tier === 'MEGA' ? "text-purple-400 border-purple-500/40 bg-purple-500/10" :
                    result.market_cap_tier === 'LARGE' ? "text-cyan-400 border-cyan-500/40 bg-cyan-500/10" :
                    result.market_cap_tier === 'MID' ? "text-sky-400 border-sky-500/40 bg-sky-500/10" :
                    result.market_cap_tier === 'SMALL' ? "text-amber-400 border-amber-500/40 bg-amber-500/10" :
                    "text-zinc-500 border-zinc-600/40 bg-zinc-700/10"
                  )}>
                    {result.market_cap_tier}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div
            className="w-full h-full flex flex-col items-center justify-center transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] opacity-0 scale-[0.99] group-hover:opacity-100 group-hover:scale-100 pointer-events-none delay-100 z-20 will-change-transform"
            style={{
              transform: `scale(calc(1 / var(--hex-hover-scale, 1.2)))`,
              width: 'calc(100% * var(--hex-hover-scale, 1))',
              height: 'calc(100% * var(--hex-hover-scale, 1))'
            }}
          >
            <div className="w-[80%] max-w-[500px] flex flex-col">
              <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-4 shrink-0">
                <div className="flex flex-col">
                  <span className="text-[14px] font-black text-white uppercase tracking-[0.3em] leading-none mb-1">
                    {result.symbol.toUpperCase()}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500">MARKET SCANNER DNA</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className={cn("text-[18px] font-mono font-black italic", colors.text)}>{(result.score || 0).toFixed(1)}%</span>
                  <span className="text-[8px] font-black text-zinc-700 uppercase tracking-tighter">Confidence</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-6">
                <StatRow icon={TrendingUp} label="CHG 5M" value={`${(result.price_change_5m || 0) >= 0 ? '+' : ''}${(result.price_change_5m || 0).toFixed(2)}%`} colorClass={(result.price_change_5m || 0) >= 0 ? "text-emerald-400" : "text-rose-400"} />
                <StatRow icon={TrendingUp} label="CHG 1H" value={`${(result.price_change_1h || 0) >= 0 ? '+' : ''}${(result.price_change_1h || 0).toFixed(2)}%`} colorClass={(result.price_change_1h || 0) >= 0 ? "text-emerald-400" : "text-rose-400"} />

                <StatRow icon={Activity} label="RVOL" value={`${(result.rvol || 1).toFixed(1)}x`} colorClass={(result.rvol || 1) > 2 ? "text-cyan-400" : "text-zinc-400"} />
                <StatRow icon={Zap} label="SURGE" value={`${(result.vol_surge_pct || 0).toFixed(0)}%`} colorClass={(result.vol_surge_pct || 0) > 100 ? "text-amber-400" : "text-zinc-400"} />
                <StatRow icon={Gauge} label="VWAP DEV" value={`${(result.vwap_pct || 0) >= 0 ? '+' : ''}${(result.vwap_pct || 0).toFixed(2)}%`} colorClass={Math.abs(result.vwap_pct || 0) > 1 ? "text-cyan-400" : "text-zinc-400"} />

                <StatRow icon={BarChart3} label="RSI" value={(result.rsi || 50).toFixed(1)} colorClass={(result.rsi || 50) < 35 || (result.rsi || 50) > 65 ? "text-amber-400" : "text-zinc-400"} />
                <StatRow icon={BarChart3} label="MACD" value={result.macd_signal === 'BULLISH' ? "BULLISH" : result.macd_signal === 'BEARISH' ? "BEARISH" : "NEUTRAL"} colorClass={result.macd_signal === 'BULLISH' ? "text-emerald-400" : result.macd_signal === 'BEARISH' ? "text-rose-400" : "text-zinc-500"} />
                <StatRow icon={Percent} label="BB %B" value={(result.bollinger_b || 0.5).toFixed(2)} colorClass={(result.bollinger_b || 0.5) > 1 || (result.bollinger_b || 0.5) < 0 ? "text-amber-400" : "text-zinc-400"} />
                <StatRow icon={Layers} label="EMA ALIGN" value={result.ema_alignment === 'BULLISH' ? "TREND UP" : result.ema_alignment === 'BEARISH' ? "TREND DOWN" : "MIXED"} colorClass={result.ema_alignment === 'BULLISH' ? "text-emerald-400" : result.ema_alignment === 'BEARISH' ? "text-rose-400" : "text-zinc-500"} />

                {result.is_new_high && <StatRow icon={ArrowUpRight} label="RANGE" value="NEW HIGH" colorClass="text-emerald-400" />}
                {result.is_new_low && <StatRow icon={ArrowDownRight} label="RANGE" value="NEW LOW" colorClass="text-rose-400" />}
                <StatRow icon={Target} label="DELTA DIV" value={result.delta_divergence ? "ACTIVE" : "NONE"} colorClass={result.delta_divergence ? "text-amber-400" : "text-zinc-500"} />
                <StatRow icon={Target} label="IMB" value={`${(result.imbalance_ratio || 1).toFixed(1)}:1`} colorClass={(result.imbalance_ratio || 1) > 3 ? "text-amber-400" : "text-zinc-400"} />
                <StatRow icon={Layers} label="STACKED" value={(result.stacked_imbalance || 0) > 0 ? `${result.stacked_imbalance} LVLS` : "NONE"} colorClass={(result.stacked_imbalance || 0) > 0 ? "text-cyan-400" : "text-zinc-500"} />
              </div>

              <div className="shrink-0 pt-4 border-t border-white/5 flex justify-between items-center text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                  BINANCE REAL-TIME FEED
                </div>
                <span className="text-zinc-300 font-bold">${(result.price || 0).toLocaleString(undefined, { maximumFractionDigits: ((result.price || 0) < 1 ? 6 : 4) })}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes detection-flash {
          0% { filter: brightness(1) saturate(1); box-shadow: inset 0 0 0px transparent; }
          20% { filter: brightness(1.8) saturate(1.5); box-shadow: inset 0 0 40px var(--flash-color, rgba(34, 211, 238, 0.7)); }
          100% { filter: brightness(1) saturate(1); box-shadow: inset 0 0 0px transparent; }
        }
        .animate-detection-flash {
          animation: detection-flash 2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </button>
  );
}

export const HexTile = React.memo(HexTileComponent);
