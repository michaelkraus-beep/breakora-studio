import React, { useState, useCallback } from 'react';
import { Layout, Model, TabNode, IJsonModel } from 'flexlayout-react';
import 'flexlayout-react/style/dark.css';
import { ConfigPanel } from './ConfigPanel';
import { BacktesterResults } from './BacktesterResults';

const DEFAULT_LAYOUT: IJsonModel = {
  global: {
    tabEnableClose: false,
    tabEnableRename: false,
    tabEnablePopout: false,
    tabSetEnableMaximize: true,
    tabSetEnableTabStrip: true,
    tabSetEnableDrop: false,
    splitterSize: 1,
    tabSetTabLocation: "top",
  },
  layout: {
    type: "row",
    weight: 100,
    children: [
      {
        type: "tabset",
        weight: 60,
        id: "results-panel",
        children: [{ type: "tab", name: "EXECUTION PROFILE", component: "results", id: "results-tab" }]
      },
      {
        type: "tabset",
        weight: 40,
        id: "config-panel",
        children: [{ type: "tab", name: "CONFIGURATION", component: "config", id: "config-tab" }]
      }
    ]
  }
};

export function BacktesterWorkspace() {
  const [model] = useState<Model>(() => Model.fromJson(DEFAULT_LAYOUT));
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [result, setResult] = useState<any>(null);

  const handleRunStart = (id: string) => {
    setRunId(id);
    setStatus('running');
    setResult(null);
  };

  const handleRunComplete = (data: any) => {
    setStatus('completed');
    setResult(data);
  };

  const factory = useCallback((node: TabNode) => {
    const component = node.getComponent();
    switch (component) {
      case "results":
        return <BacktesterResults status={status} result={result} />;
      case "config":
        return <ConfigPanel onRunStart={handleRunStart} onRunComplete={handleRunComplete} />;
      default:
        return <div>Unknown</div>;
    }
  }, [status, result]);

  return (
    <div className="h-full w-full bg-zinc-950 flex flex-col overflow-hidden">
      <div className="flex-1 relative min-h-0">
        <Layout 
          model={model} 
          factory={factory} 
        />
      </div>
      <style>{`
        .flexlayout__layout { position: absolute; left: 0; top: 0; right: 0; bottom: 0; overflow: hidden; background: transparent; }
        .flexlayout__tabset { background: rgba(9,9,11,0.5); border: 1px solid rgba(255,255,255,0.05); }
        .flexlayout__tabset_header { background: rgba(24,24,27,0.95) !important; border-bottom: 1px solid rgba(255,255,255,0.05) !important; height: 32px !important; }
        .flexlayout__tab_button { background: transparent !important; color: #71717a !important; font-family: 'Orbitron', sans-serif !important; font-size: 9px !important; letter-spacing: 0.1em !important; padding: 0px 16px !important; border-right: 1px solid rgba(255,255,255,0.05) !important; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important; display: flex !important; align-items: center !important; text-transform: uppercase; }
        .flexlayout__tab_button:hover { color: #22d3ee !important; background: rgba(34, 211, 238, 0.05) !important; }
        .flexlayout__tab_button--selected { background: rgba(34, 211, 238, 0.1) !important; color: #22d3ee !important; border-bottom: 2px solid #22d3ee !important; text-shadow: 0 0 10px rgba(34,211,238,0.5); }
        .flexlayout__splitter { background-color: #0c0c0e !important; }
        .flexlayout__splitter:hover { background-color: #22d3ee44 !important; }
      `}</style>
    </div>
  );
}
