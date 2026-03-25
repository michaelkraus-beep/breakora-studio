import React, { useState, useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';
import { motion } from 'framer-motion';

interface ConfigPanelProps {
  onRunStart: (runId: string) => void;
  onRunComplete: (result: any) => void;
}

export function ConfigPanel({ onRunStart, onRunComplete }: ConfigPanelProps) {
  const [strategies, setStrategies] = useState<any[]>([]);
  const [form, setForm] = useState(() => {
    const saved = localStorage.getItem('bt_config');
    if (saved) return JSON.parse(saved);
    return {
      symbol: 'btcusdt',
      market_type: 'spot',
      timeframe: '1m',
      strategy_name: '',
      start_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      end_date: new Date().toISOString().split('T')[0],
      initial_capital: 10000,
      position_size_pct: 0.1,
      maker_fee: 0.001,
      taker_fee: 0.001,
      slippage_bps: 1.0,
      liquidity_threshold: 5.0,
      is_oos_ratio: 0.7,
      walk_forward_windows: 0
    };
  });

  const [strategyParams, setStrategyParams] = useState<Record<string, any>>(() => {
    const saved = localStorage.getItem('bt_params');
    if (saved) return JSON.parse(saved);
    return {};
  });

  // Persist state
  useEffect(() => {
    localStorage.setItem('bt_config', JSON.stringify(form));
  }, [form]);

  useEffect(() => {
    localStorage.setItem('bt_params', JSON.stringify(strategyParams));
  }, [strategyParams]);

  const [isFetchingData, setIsFetchingData] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<string>('');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetch('/api/backtester/strategies')
      .then(r => r.json())
      .then(data => {
        setStrategies(data);
        if (data.length > 0) {
          setForm(f => {
            if (f.strategy_name) return f; // Keep existing selection
            return { ...f, strategy_name: data[0].name };
          });
          setStrategyParams(p => {
            if (Object.keys(p).length > 0) return p; // Keep existing params
            return data[0].defaults;
          });
        }
      })
      .catch(err => console.error("Failed to load strategies", err));
  }, []);

  const selectedStrategy = strategies.find(s => s.name === form.strategy_name);

  const handleStrategyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const name = e.target.value;
    setForm(f => ({ ...f, strategy_name: name }));
    const strat = strategies.find(s => s.name === name);
    if (strat) {
      setStrategyParams(strat.defaults);
    }
  };

  const handleParamChange = (name: string, value: any) => {
    setStrategyParams(p => ({ ...p, [name]: value }));
  };

  const handleFetchData = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (isFetchingData) return;
    
    setIsFetchingData(true);
    setFetchProgress('Initiating...');
    try {
      const res = await fetch('/api/backtester/data/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: form.symbol,
          timeframe: form.timeframe,
          start_date: form.start_date,
          end_date: form.end_date,
          market_type: form.market_type
        })
      });
      
      const data = await res.json();
      if (data.job_id) {
         const poll = setInterval(async () => {
             try {
                 const statusRes = await fetch(`/api/backtester/data/fetch-status/${data.job_id}`);
                 if (statusRes.ok) {
                     const statusData = await statusRes.json();
                     setFetchProgress(statusData.progress);
                     if (statusData.progress === 'Complete' || statusData.progress.startsWith('Error')) {
                         clearInterval(poll);
                         setIsFetchingData(false);
                         if (statusData.progress === 'Complete') {
                             setTimeout(() => setFetchProgress(''), 3000);
                         }
                     }
                 } else {
                     clearInterval(poll);
                     setIsFetchingData(false);
                     setFetchProgress('Failed to get status');
                 }
             } catch (err) {
                 clearInterval(poll);
                 setIsFetchingData(false);
                 setFetchProgress('Network error');
             }
         }, 1000);
      } else {
         setIsFetchingData(false);
         setFetchProgress('Failed to start');
      }
    } catch (err) {
      console.error("Fetch failed", err);
      setIsFetchingData(false);
      setFetchProgress('Network error');
    }
  };

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    
    debounceRef.current = setTimeout(async () => {
      try {
        const payload = {
          ...form,
          position_size_pct: Number(form.position_size_pct),
          initial_capital: Number(form.initial_capital),
          maker_fee: Number(form.maker_fee),
          taker_fee: Number(form.taker_fee),
          slippage_bps: Number(form.slippage_bps),
          liquidity_threshold: Number(form.liquidity_threshold),
          strategy_params: strategyParams
        };

        const res = await fetch('/api/backtester/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
            console.error("Run failed", await res.text());
            return;
        }

        const data = await res.json();
        onRunStart(data.run_id);

        // Poll for completion
        const poll = setInterval(async () => {
          const statusRes = await fetch(`/api/backtester/status/${data.run_id}`);
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            if (statusData.status === 'completed' || statusData.status === 'failed') {
              clearInterval(poll);
              // Fetch full result
              const resultRes = await fetch(`/api/backtester/result/${data.run_id}`);
              if (resultRes.ok) {
                const fullResult = await resultRes.json();
                onRunComplete(fullResult);
              }
            }
          }
        }, 2000);
        
      } catch (err) {
        console.error("Failed to run backtest", err);
      }
    }, 400); // 400ms debounce
  };

  return (
    <div className="h-full w-full overflow-y-auto p-4 custom-scrollbar">
      <form onSubmit={handleRun} className="space-y-6">
        {/* Core Settings */}
        <div className="space-y-3">
          <h3 className="font-sci-fi text-xs text-cyan-400 mb-2">TARGET ASSET</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-500 uppercase">Symbol</label>
              <input type="text" value={form.symbol} onChange={e => setForm({...form, symbol: e.target.value.toLowerCase()})} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-white uppercase focus:border-cyan-500/50 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-500 uppercase">Type</label>
              <select value={form.market_type} onChange={e => setForm({...form, market_type: e.target.value as any})} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-white focus:border-cyan-500/50 outline-none">
                <option value="spot">Spot</option>
                <option value="perp">Perpetual</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
             <div className="space-y-1">
              <label className="text-[10px] text-zinc-500 uppercase">Start Date</label>
              <input type="date" value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 focus:border-cyan-500/50 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-500 uppercase">End Date</label>
              <input type="date" value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 focus:border-cyan-500/50 outline-none" />
            </div>
          </div>
        </div>

        {/* Strategy */}
        <div className="space-y-3">
          <h3 className="font-sci-fi text-xs text-cyan-400 mb-2">STRATEGY</h3>
          <select value={form.strategy_name} onChange={handleStrategyChange} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white focus:border-cyan-500/50 outline-none">
            {strategies.map(s => <option key={s.name} value={s.name}>{s.name.replace('_', ' ').toUpperCase()}</option>)}
          </select>
          
          {selectedStrategy && (
            <div className="grid grid-cols-2 gap-3 p-3 bg-zinc-900/50 border border-zinc-800/50 rounded-lg">
              {selectedStrategy.params.map((p: any) => (
                <div key={p.name} className="space-y-1">
                  <label className="text-[10px] text-zinc-500 uppercase">{p.name.replace('_', ' ')}</label>
                  <input 
                    type={p.type === 'int' || p.type === 'float' ? 'number' : 'text'} 
                    step={p.type === 'float' ? '0.1' : '1'}
                    value={strategyParams[p.name] ?? p.default} 
                    onChange={e => handleParamChange(p.name, p.type === 'float' ? parseFloat(e.target.value) : parseInt(e.target.value))} 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white focus:border-cyan-500/50 outline-none" 
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Execution */}
        <div className="space-y-3">
          <h3 className="font-sci-fi text-xs text-cyan-400 mb-2">EXECUTION MODEL</h3>
          <div className="grid grid-cols-2 gap-3">
             <div className="space-y-1">
              <label className="text-[10px] text-zinc-500 uppercase">Initial Capital</label>
              <input type="number" value={form.initial_capital} onChange={e => setForm({...form, initial_capital: e.target.valueAsNumber})} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-white focus:border-cyan-500/50 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-500 uppercase">Position Size (%)</label>
              <input type="number" step="0.01" value={form.position_size_pct} onChange={e => setForm({...form, position_size_pct: e.target.valueAsNumber})} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-white focus:border-cyan-500/50 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-500 uppercase">Maker Fee</label>
              <input type="number" step="0.0001" value={form.maker_fee} onChange={e => setForm({...form, maker_fee: e.target.valueAsNumber})} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-white focus:border-cyan-500/50 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-500 uppercase">Taker Fee</label>
              <input type="number" step="0.0001" value={form.taker_fee} onChange={e => setForm({...form, taker_fee: e.target.valueAsNumber})} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-white focus:border-cyan-500/50 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-500 uppercase">Slippage Base (bps)</label>
              <input type="number" step="0.1" value={form.slippage_bps} onChange={e => setForm({...form, slippage_bps: e.target.valueAsNumber})} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-white focus:border-cyan-500/50 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-500 uppercase">Liquidity Thresh (%)</label>
              <input type="number" step="0.1" value={form.liquidity_threshold} onChange={e => setForm({...form, liquidity_threshold: e.target.valueAsNumber})} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-white focus:border-cyan-500/50 outline-none" />
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        {isFetchingData && (
          <div className="space-y-2">
            <div className="flex justify-between items-center text-[10px] font-mono">
              <span className="text-cyan-400 animate-pulse">{fetchProgress || 'PREPARING...'}</span>
              <span className="text-zinc-500">{(fetchProgress.match(/\d+/) || ['0'])[0]}%</span>
            </div>
            <div className="h-1 w-full bg-zinc-900 rounded-full overflow-hidden border border-white/5">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${(fetchProgress.match(/\d+/) || ['0'])[0]}%` }}
                className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]"
              />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 pt-4 border-t border-zinc-800/50">
          <div className="flex gap-3">
            <button 
                type="button" 
                onClick={handleFetchData}
                disabled={isFetchingData}
                className={`flex-1 px-4 py-2 ${isFetchingData ? 'bg-zinc-800 border-zinc-600 cursor-not-allowed text-cyan-500 shadow-[0_0_10px_rgba(34,211,238,0.1)]' : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-700 text-zinc-300'} border rounded-lg text-xs font-sci-fi transition-all duration-300 flex items-center justify-center gap-2`}
            >
                {isFetchingData && <div className="w-3 h-3 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />}
                <span>{isFetchingData ? 'FETCHING...' : (fetchProgress && (fetchProgress === 'Complete' || fetchProgress.startsWith('Error')) ? fetchProgress.toUpperCase() : 'FETCH DATA')}</span>
            </button>
            <motion.button 
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                type="submit" 
                disabled={isFetchingData}
                className={cn(
                    "flex-1 px-4 py-2 rounded-lg text-xs font-sci-fi transition-all duration-300",
                    isFetchingData 
                    ? "bg-zinc-900 border-zinc-800 text-zinc-600 cursor-not-allowed"
                    : "bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)]"
                )}
            >
                RUN BACKTEST
            </motion.button>
          </div>
          <button 
            type="button"
            onClick={() => { localStorage.removeItem('bt_config'); localStorage.removeItem('bt_params'); window.location.reload(); }}
            className="text-[9px] text-zinc-600 hover:text-red-500/70 uppercase font-sci-fi self-center transition-colors"
          >
            Reset Configuration Defaults
          </button>
        </div>
      </form>
    </div>
  );
}
