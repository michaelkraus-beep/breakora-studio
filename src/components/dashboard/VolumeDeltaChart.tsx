import React from 'react';
import { Candle } from '../../types/market';

interface VolumeDeltaProps {
  candles: Candle[];
  height?: number;
}

export function VolumeDeltaChart({ candles, height = 150 }: VolumeDeltaProps) {
  // Calculate Volume and Imbalance (Delta) for each candle
  const data = candles.slice(-50).map(c => {
    let delta = 0;
    let hasFootprint = false;

    if (c.footprint && Object.keys(c.footprint).length > 0) {
      Object.values(c.footprint).forEach(level => {
        delta += level.delta;
      });
      hasFootprint = true;
    } else {
      // Fallback approximation: Use direction * volume
      // This makes the delta bar height equal to volume bar height, but colored by direction
      const isBullish = c.close >= c.open;
      delta = isBullish ? c.volume : -c.volume;
    }

    return {
      time: c.time,
      volume: c.volume,
      delta,
      isBullish: c.close >= c.open,
      hasFootprint
    };
  });

  const maxVol = Math.max(...data.map(d => d.volume), 1);
  // For imbalance, we want the max absolute delta to scale the bars
  const maxDelta = Math.max(...data.map(d => Math.abs(d.delta)), 1);

  return (
    <div className="w-full bg-zinc-950 border-t border-zinc-800" style={{ height }}>
      <div className="px-4 py-2 border-b border-zinc-800 flex justify-between items-center">
        <h3 className="text-xs font-bold text-zinc-400 font-display tracking-wider">VOLUME & IMBALANCE</h3>
        <div className="flex gap-3">
            <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-zinc-600 rounded-sm"></div>
                <span className="text-[10px] text-zinc-600 font-mono">VOL</span>
            </div>
            <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-500 rounded-sm"></div>
                <div className="w-2 h-2 bg-red-500 rounded-sm"></div>
                <span className="text-[10px] text-zinc-600 font-mono">DELTA</span>
            </div>
        </div>
      </div>
      <div className="flex items-end h-[calc(100%-32px)] px-4 gap-1">
        {data.map((item, i) => {
          const volHeightPct = (item.volume / maxVol) * 100;
          const deltaHeightPct = (Math.abs(item.delta) / maxDelta) * 100;
          const deltaColor = item.delta >= 0 ? 'bg-green-500' : 'bg-red-500';
          
          return (
            <div 
              key={item.time} 
              className="flex-1 flex flex-row items-end gap-[1px] group relative h-full"
            >
              {/* Volume Bar (Left) */}
              <div 
                className="flex-1 min-h-[1px] transition-all duration-300 bg-zinc-600 opacity-80 hover:opacity-100"
                style={{ height: `${volHeightPct}%` }}
              />
              
              {/* Imbalance/Delta Bar (Right) */}
              <div 
                className={`flex-1 min-h-[1px] transition-all duration-300 ${deltaColor} opacity-80 hover:opacity-100`}
                style={{ height: `${deltaHeightPct}%` }}
              />

              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block bg-zinc-900 text-xs text-white p-2 rounded border border-zinc-800 whitespace-nowrap z-20 shadow-lg pointer-events-none">
                <div className="font-mono text-zinc-400 mb-1">{new Date(item.time).toLocaleTimeString()}</div>
                <div className="font-mono flex justify-between gap-4">
                    <span>Vol:</span>
                    <span className="text-zinc-200">{item.volume.toFixed(2)}</span>
                </div>
                <div className="font-mono flex justify-between gap-4">
                    <span>Delta:</span>
                    <span className={item.delta >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {item.delta > 0 ? '+' : ''}{item.delta.toFixed(2)}
                    </span>
                </div>
                {!item.hasFootprint && (
                    <div className="text-[9px] text-zinc-600 mt-1 italic text-center">(Estimated)</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
