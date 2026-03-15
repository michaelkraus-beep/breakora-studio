import React from 'react';
import { Trade } from '../../types/market';
import { cn } from '../../lib/utils';

interface TradeTapeProps {
  trades: Trade[];
}

export function TradeTape({ trades }: TradeTapeProps) {
  return (
    <div className="flex flex-col h-full bg-zinc-950 border-l border-zinc-800 w-80">
      <div className="px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/50">
        <h3 className="text-[10px] font-bold text-zinc-400 font-mono tracking-wider">RECENT TRADES</h3>
      </div>
      <div className="flex-1 overflow-y-auto font-mono text-[10px]">
        <table className="w-full">
          <thead className="sticky top-0 bg-zinc-950 text-zinc-500 border-b border-zinc-800 z-10">
            <tr>
              <th className="px-2 py-1 text-left font-normal w-1/3">Price</th>
              <th className="px-2 py-1 text-right font-normal w-1/3">Qty</th>
              <th className="px-2 py-1 text-right font-normal w-1/3">Time</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr key={trade.id} className="hover:bg-zinc-900/50 transition-colors h-4">
                <td className={cn("px-2", trade.isBuyerMaker ? "text-purple-500" : "text-cyan-400")}>
                  {trade.price.toFixed(2)}
                </td>
                <td className="px-2 text-right text-zinc-300">
                  {trade.quantity.toFixed(4)}
                </td>
                <td className="px-2 text-right text-zinc-500">
                  {new Date(trade.time).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
