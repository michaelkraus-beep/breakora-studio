import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Activity, DollarSign } from 'lucide-react';

interface BacktesterResultsProps {
  status: string;
  result: any;
}

export function BacktesterResults({ status, result }: BacktesterResultsProps) {
  if (status === 'idle') {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center text-zinc-600 space-y-4">
        <Activity size={48} className="opacity-20 translate-y-2 animate-pulse" />
        <p className="font-sci-fi text-xs tracking-widest uppercase">Awaiting Execution Profile</p>
      </div>
    );
  }

  if (status === 'running') {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center text-cyan-500/50 space-y-4">
        <div className="relative">
            <div className="w-12 h-12 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-6 h-6 bg-cyan-500/10 rounded-full animate-pulse blur-sm" />
            </div>
        </div>
        <p className="font-sci-fi text-xs tracking-widest animate-pulse">Processing Simulation...</p>
      </div>
    );
  }

  if (!result || !result.metrics) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center p-6 space-y-4">
        <div className="text-red-400 font-sci-fi text-xs uppercase tracking-widest bg-red-500/10 border border-red-500/20 px-4 py-2 rounded-lg flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            Simulation Failed or No Metrics Returned
        </div>
        {result?.warnings && result.warnings.length > 0 && (
          <div className="bg-zinc-900/80 border border-white/5 rounded-xl p-4 max-w-md w-full">
            <h5 className="text-[10px] text-zinc-500 uppercase font-sci-fi mb-2 border-b border-white/5 pb-1">Error Details</h5>
            <ul className="space-y-1">
              {result.warnings.map((w: string, i: number) => (
                <li key={i} className="text-[11px] font-mono text-red-500/80 leading-relaxed">• {w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const { metrics } = result;
  
  const StatBox = ({ label, value, icon: Icon, colorClass = "text-cyan-400" }: any) => (
    <div className="bg-zinc-900/40 border border-white/5 rounded-xl p-4 flex flex-col gap-2 relative overflow-hidden group">
      <div className={`absolute top-0 right-0 p-2 opacity-5 group-hover:opacity-10 transition-opacity ${colorClass}`}>
        <Icon size={40} />
      </div>
      <span className="text-[10px] text-zinc-500 uppercase font-sci-fi tracking-wider">{label}</span>
      <span className={`text-xl font-bold font-mono ${colorClass}`}>{value}</span>
    </div>
  );

  return (
    <div className="h-full w-full overflow-y-auto p-6 custom-scrollbar space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatBox label="Net Profit" value={`$${metrics.net_profit.toFixed(2)}`} icon={DollarSign} colorClass={metrics.net_profit >= 0 ? "text-emerald-400" : "text-red-400"} />
        <StatBox label="Win Rate" value={`${(metrics.win_rate * 100).toFixed(1)}%`} icon={Activity} colorClass="text-cyan-400" />
        <StatBox label="Total Trades" value={metrics.total_trades} icon={Activity} colorClass="text-zinc-300" />
        <StatBox label="Profit Factor" value={metrics.profit_factor.toFixed(2)} icon={metrics.profit_factor >= 1 ? TrendingUp : TrendingDown} colorClass={metrics.profit_factor >= 1 ? "text-cyan-400" : "text-amber-400"} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-zinc-900/40 border border-white/5 rounded-xl p-4 space-y-4">
          <h4 className="font-sci-fi text-[10px] text-zinc-500 uppercase tracking-widest border-b border-white/5 pb-2">Risk Metrics</h4>
          <div className="space-y-3">
             <div className="flex justify-between items-center">
                <span className="text-[11px] text-zinc-400">Max Drawdown</span>
                <span className="text-[11px] font-mono text-red-400">{(metrics.max_drawdown * 100).toFixed(2)}%</span>
             </div>
             <div className="flex justify-between items-center">
                <span className="text-[11px] text-zinc-400">Sharpe Ratio</span>
                <span className="text-[11px] font-mono text-cyan-400">{metrics.sharpe_ratio.toFixed(2)}</span>
             </div>
             <div className="flex justify-between items-center">
                <span className="text-[11px] text-zinc-400">Sortino Ratio</span>
                <span className="text-[11px] font-mono text-cyan-400">{metrics.sortino_ratio.toFixed(2)}</span>
             </div>
          </div>
        </div>

        <div className="bg-zinc-900/40 border border-white/5 rounded-xl p-4 space-y-4">
          <h4 className="font-sci-fi text-[10px] text-zinc-500 uppercase tracking-widest border-b border-white/5 pb-2">Trade Details</h4>
          <div className="space-y-3">
             <div className="flex justify-between items-center">
                <span className="text-[11px] text-zinc-400">Avg Trade</span>
                <span className="text-[11px] font-mono text-emerald-400">${metrics.avg_trade.toFixed(2)}</span>
             </div>
             <div className="flex justify-between items-center">
                <span className="text-[11px] text-zinc-400">Avg Win</span>
                <span className="text-[11px] font-mono text-emerald-400">${metrics.avg_win.toFixed(2)}</span>
             </div>
             <div className="flex justify-between items-center">
                <span className="text-[11px] text-zinc-400">Avg Loss</span>
                <span className="text-[11px] font-mono text-red-400">${metrics.avg_loss.toFixed(2)}</span>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
