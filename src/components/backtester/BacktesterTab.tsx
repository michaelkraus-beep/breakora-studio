import React, { useState } from 'react';
import { ConfigPanel } from './ConfigPanel';
import { BacktesterResults } from './BacktesterResults';

export function BacktesterTab() {
  const [status, setStatus] = useState<string>('idle');
  const [result, setResult] = useState<any>(null);

  const handleRunStart = (id: string) => {
    setStatus('running');
    setResult(null);
  };

  const handleRunComplete = (data: any) => {
    setStatus('completed');
    setResult(data);
  };

  return (
    <div className="h-full w-full flex bg-zinc-950 overflow-hidden">
      <div className="w-1/3 border-r border-white/5 h-full overflow-hidden">
        <ConfigPanel onRunStart={handleRunStart} onRunComplete={handleRunComplete} />
      </div>
      <div className="w-2/3 h-full overflow-hidden">
        <BacktesterResults status={status} result={result} />
      </div>
    </div>
  );
}
