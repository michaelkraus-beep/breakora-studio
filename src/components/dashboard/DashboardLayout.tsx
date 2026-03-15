import React, { useCallback, useMemo } from 'react';
import { Layout, Model, TabNode, IJsonModel, Actions, DockLocation } from 'flexlayout-react';
import 'flexlayout-react/style/dark.css';
import { CandlestickChart } from './CandlestickChart';
import { NuTape } from './NuTape';
import { FootTape } from './FootTape';
import { TradeTape } from './TradeTape';
import { OrderBookView } from './OrderBookView';
import { Candle, Ticker, Trade } from '../../types/market';
import { LayoutGrid, Plus, Monitor, Settings } from 'lucide-react';
import { ChartGroup } from './ChartGroup';
import { useSharedStream } from '../../hooks/use-shared-stream';
import { cn } from '../../lib/utils';
import { SymbolSelector } from './SymbolSelector';

interface DashboardLayoutProps {
  symbol: string;
  marketType: 'spot' | 'perp';
  tickSize: number;
  onActiveChartChange?: (state: { symbol: string, marketType: 'spot' | 'perp', timeframe: string }) => void;
}

const DEFAULT_LAYOUT: IJsonModel = {
  global: {
    tabEnableClose: true,
    tabEnableRename: true,
    tabEnablePopout: false,
    tabSetEnableMaximize: true,
    tabSetEnableTabStrip: true,
    tabSetEnableDrop: true,
    splitterSize: 1,
    tabSetTabLocation: "top",
  },
  borders: [],
  layout: {
    type: "row",
    weight: 100,
    children: [
      {
        type: "column",
        weight: 70,
        children: [
          {
            type: "tabset",
            weight: 100,
            children: [
              {
                type: "tab",
                name: "Chart 1",
                component: "chart",
                id: "chart-1"
              }
            ]
          }
        ]
      },
      {
        type: "column",
        weight: 30,
        children: [
          {
            type: "tabset",
            weight: 66,
            children: [
              {
                type: "tab",
                name: "Order Book",
                component: "order_book",
                id: "order-book-1"
              },
              {
                type: "tab",
                name: "Nu Tape",
                component: "nu_tape",
                id: "nu-tape-1"
              }
            ]
          },
          {
            type: "tabset",
            weight: 33,
            children: [
              {
                type: "tab",
                name: "Foot Tape",
                component: "foot_tape",
                id: "foot-tape-1"
              },
              {
                type: "tab",
                name: "Recent Trades",
                component: "trades",
                id: "trades-1"
              }
            ]
          }
        ]
      }
    ]
  }
};

const SelfStreamingFootTape = ({ symbol, marketType }: { symbol: string, marketType: 'spot' | 'perp' }) => {
    const { candles, ticker, tickSize } = useSharedStream(symbol, marketType, '1m');
    return <FootTape candles={candles} symbol={symbol} ticker={ticker} tickSize={tickSize} />;
};

const SelfStreamingNuTape = ({ symbol, marketType }: { symbol: string, marketType: 'spot' | 'perp' }) => {
    const { trades, ticker } = useSharedStream(symbol, marketType, '1m');
    return <NuTape trades={trades} symbol={symbol} ticker={ticker} />;
};

const SelfStreamingTradeTape = ({ symbol, marketType }: { symbol: string, marketType: 'spot' | 'perp' }) => {
    const { trades } = useSharedStream(symbol, marketType, '1m');
    return <TradeTape trades={trades} />;
};

const SelfStreamingOrderBook = ({ symbol, marketType }: { symbol: string, marketType: 'spot' | 'perp' }) => {
    const { tickSize } = useSharedStream(symbol, marketType, '1m');
    return <OrderBookView symbol={symbol} marketType={marketType} tickSize={tickSize} />;
};

const STORAGE_KEY = "breakora_dashboard_v5_final";
const CHART_STATES_KEY = "breakora_chart_states_v1";

interface ChartState {
    symbol: string;
    timeframe: string;
    showSettings: boolean;
    marketType: 'spot' | 'perp';
}

export const DashboardLayout = React.memo(function DashboardLayout({
  symbol: initialSymbol,
  marketType: initialMarketType,
  tickSize,
  onActiveChartChange
}: DashboardLayoutProps) {
  
  const [model, setModel] = React.useState<Model>(() => {
    // ... (existing model init)
    const savedLayout = localStorage.getItem(STORAGE_KEY);
    if (savedLayout) {
      try {
        return Model.fromJson(JSON.parse(savedLayout));
      } catch (e) {
        console.error("Failed to load saved layout", e);
      }
    }
    return Model.fromJson(DEFAULT_LAYOUT);
  });

  const [chartStates, setChartStates] = React.useState<Record<string, ChartState>>(() => {
    const saved = localStorage.getItem(CHART_STATES_KEY);
    return saved ? JSON.parse(saved) : {};
  });

  const onModelChange = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model.toJson()));
    
    // Notify active chart change
    const selectedNode = model.getSelectedNode();
    if (selectedNode && selectedNode.getType() === 'tab' && (selectedNode as TabNode).getComponent() === 'chart') {
        const id = selectedNode.getId();
        const state = chartStates[id] || { 
            symbol: initialSymbol, 
            timeframe: '1m', 
            showSettings: false, 
            marketType: initialMarketType 
        };
        onActiveChartChange?.({
            symbol: state.symbol,
            marketType: state.marketType,
            timeframe: state.timeframe
        });
    }
  }, [model, chartStates, initialSymbol, initialMarketType, onActiveChartChange]);

  const updateChartState = useCallback((instanceId: string, updates: Partial<ChartState>) => {
    setChartStates(prev => {
        const newState = {
            ...prev,
            [instanceId]: {
                ...(prev[instanceId] || { 
                    symbol: initialSymbol, 
                    timeframe: '1m', 
                    showSettings: false, 
                    marketType: initialMarketType 
                }),
                ...updates
            }
        };
        localStorage.setItem(CHART_STATES_KEY, JSON.stringify(newState));
        return newState;
    });

    // Also notify if this is the active tab
    const selectedNode = model.getSelectedNode();
    if (selectedNode?.getId() === instanceId) {
        const fullState = {
            ...(chartStates[instanceId] || { 
                symbol: initialSymbol, 
                timeframe: '1m', 
                showSettings: false, 
                marketType: initialMarketType 
            }),
            ...updates
        };
        onActiveChartChange?.({
            symbol: fullState.symbol,
            marketType: fullState.marketType,
            timeframe: fullState.timeframe
        });
    }
  }, [initialSymbol, initialMarketType, model, chartStates, onActiveChartChange]);

  const resetLayout = useCallback(() => {
    const newModel = Model.fromJson(DEFAULT_LAYOUT);
    setModel(newModel);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newModel.toJson()));
  }, []);

  const addTab = useCallback((componentType: string, targetNodeId?: string) => {
    // ... (existing addTab logic)
    if (componentType === 'chart') {
        let chartCount = 0;
        model.visitNodes((node) => {
            if (node.getType() === 'tab' && (node as TabNode).getComponent() === 'chart') {
                chartCount++;
            }
        });
        if (chartCount >= 5) {
            alert("Maximum of 5 chart tabs allowed.");
            return;
        }
    }

    const id = `${componentType}-${Date.now()}`;
    const name = componentType === "chart" ? `Chart ${Math.floor(Math.random() * 100)}` : componentType.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
    
    const json = {
      type: "tab",
      component: componentType,
      name: name,
      id: id
    };
    
    try {
        if (targetNodeId) {
            model.doAction(Actions.addNode(json, targetNodeId, DockLocation.CENTER, -1));
        } else {
            model.doAction(Actions.addNode(json, "chart-1", DockLocation.CENTER, -1));
        }
    } catch (e) {
        model.doAction(Actions.addNode(json, "order-book-1", DockLocation.CENTER, -1));
    }
  }, [model]);

  const onRenderTabSet = useCallback((node: any, renderValues: any) => {
      const selectedTab = node.getSelectedNode() as TabNode | undefined;
      const isChart = selectedTab && selectedTab.getComponent() === 'chart';
      const instanceId = selectedTab?.getId();

      renderValues.buttons.push(
          <div key="cockpit-controls" className="flex items-center gap-1.5 mr-1 h-full">
              {isChart && instanceId && (
                  <div className="flex items-center gap-1.5 mr-2 pr-2 border-r border-white/10 h-full">
                      <SymbolSelector 
                        currentSymbol={chartStates[instanceId]?.symbol || initialSymbol}
                        onSymbolChange={(s) => updateChartState(instanceId, { symbol: s })}
                        marketType={chartStates[instanceId]?.marketType || initialMarketType}
                        onMarketTypeChange={(t) => updateChartState(instanceId, { marketType: t })}
                        isCompact={true}
                      />
                      
                      <div className="flex items-center bg-zinc-900 rounded px-1.5 py-0.5 border border-zinc-800/50">
                        <select 
                            value={chartStates[instanceId]?.timeframe || '1m'}
                            onChange={(e) => updateChartState(instanceId, { timeframe: e.target.value })}
                            className="bg-transparent border-none text-[9px] font-bold text-zinc-400 focus:ring-0 cursor-pointer hover:text-zinc-200 transition-colors uppercase leading-tight"
                        >
                            <option value="1m">1m</option>
                            <option value="3m">3m</option>
                            <option value="5m">5m</option>
                            <option value="15m">15m</option>
                            <option value="30m">30m</option>
                            <option value="1h">1h</option>
                            <option value="2h">2h</option>
                            <option value="4h">4h</option>
                            <option value="1d">1d</option>
                            <option value="1w">1w</option>
                        </select>
                      </div>

                      <button 
                        onClick={() => updateChartState(instanceId, { showSettings: !chartStates[instanceId]?.showSettings })}
                        className={cn(
                            "p-1 rounded transition-all duration-200 border",
                            chartStates[instanceId]?.showSettings 
                                ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/30" 
                                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 border-transparent hover:border-zinc-800"
                        )}
                        title="Chart Settings"
                      >
                        <Settings size={12} />
                      </button>
                  </div>
              )}

              <div className="flex items-center gap-1 mr-1">
                  <button 
                    onClick={() => addTab('chart', node.getId())}
                    className="hover:text-cyan-400 text-zinc-500 transition-colors p-1"
                    title="Add Chart"
                  >
                      <Plus size={14} strokeWidth={3} />
                  </button>
                  <button 
                    onClick={() => addTab('order_book', node.getId())}
                    className="hover:text-white text-zinc-600 transition-colors p-1"
                    title="Add Order Book"
                  >
                      <Plus size={10} />
                  </button>
              </div>
          </div>
      );
  }, [addTab, chartStates, initialSymbol, initialMarketType, updateChartState]);

  const factory = useCallback((node: TabNode) => {
    const component = node.getComponent();
    const instanceId = node.getId();
    const state = chartStates[instanceId] || { 
        symbol: initialSymbol, 
        timeframe: '1m', 
        showSettings: false, 
        marketType: initialMarketType 
    };

    switch (component) {
      case "chart":
        return (
            <ChartGroup 
                instanceId={instanceId} 
                symbol={state.symbol} 
                timeframe={state.timeframe}
                marketType={state.marketType}
                showSettings={state.showSettings}
                onToggleSettings={() => updateChartState(instanceId, { showSettings: !state.showSettings })}
            />
        );
      case "foot_tape":
        return <SelfStreamingFootTape symbol={state.symbol} marketType={state.marketType} />;
      case "nu_tape":
        return <SelfStreamingNuTape symbol={state.symbol} marketType={state.marketType} />;
      case "trades":
        return <SelfStreamingTradeTape symbol={state.symbol} marketType={state.marketType} />;
      case "order_book":
        return <SelfStreamingOrderBook symbol={state.symbol} marketType={state.marketType} />;
    }
  }, [chartStates, initialSymbol, initialMarketType, updateChartState]);

  return (
    <div className="flex-1 relative overflow-hidden bg-zinc-950 group">
      <Layout 
        model={model} 
        factory={factory} 
        onModelChange={onModelChange}
        onRenderTabSet={onRenderTabSet}
      />
      
      {/* Reset Layout Button - Floating (Keep for convenience) */}
      <button 
        onClick={resetLayout}
        className="absolute bottom-4 right-4 z-50 p-2 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 rounded-full text-zinc-500 hover:text-cyan-400 transition-all opacity-0 group-hover:opacity-100 shadow-xl"
        title="Reset Layout"
      >
        <LayoutGrid size={16} />
      </button>

      <style>{`
        .flexlayout__layout {
          position: absolute;
          left: 0;
          top: 0;
          right: 0;
          bottom: 0;
          background-color: #020202;
          overflow: hidden;
        }
        .flexlayout__tabset {
          background: rgba(9, 9, 11, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 4px;
        }
        .flexlayout__tabset_header {
          background: rgba(24, 24, 27, 0.8) !important;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
          height: 32px !important;
        }
        .flexlayout__tab {
          background-color: transparent;
          overflow: hidden;
        }
        .flexlayout__tab_button {
          background: transparent !important;
          color: #71717a !important;
          font-family: 'Orbitron', sans-serif !important;
          font-size: 9px !important;
          text-transform: uppercase !important;
          letter-spacing: 0.1em !important;
          padding: 0px 16px !important;
          border-right: 1px solid rgba(255, 255, 255, 0.05) !important;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
          display: flex !important;
          align-items: center !important;
        }
        .flexlayout__tab_button:hover {
          color: #22d3ee !important;
          background: rgba(34, 211, 238, 0.05) !important;
        }
        .flexlayout__tab_button--selected {
          background: rgba(34, 211, 238, 0.1) !important;
          color: #22d3ee !important;
          border-bottom: 2px solid #22d3ee !important;
          font-weight: bold !important;
          text-shadow: 0 0 10px rgba(34, 211, 238, 0.5) !important;
        }
        .flexlayout__splitter {
          background-color: #09090b !important;
          width: 1px !important;
        }
        .flexlayout__splitter:hover {
          background-color: #22d3ee55 !important;
        }
        .flexlayout__splitter_drag {
          background-color: #22d3ee;
        }
        /* Hide Popout/Float buttons */
        .flexlayout__tab_button_popout,
        .flexlayout__tab_toolbar_button-float,
        .flexlayout__tabset_header_button_popout,
        .flexlayout__tabset_header_button_float {
          display: none !important;
        }
        .flexlayout__tabset-maximized {
            z-index: 1000;
        }
        /* Cockpit specific header tweaks */
        .flexlayout__tabset_header_content {
            font-size: 10px;
            color: #52525b;
        }
      `}</style>
    </div>
  );
});

