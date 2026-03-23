import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { Layout, Model, TabNode, IJsonModel, Actions, DockLocation } from 'flexlayout-react';
import 'flexlayout-react/style/dark.css';
import { CandlestickChart } from './CandlestickChart';
import { NuTape } from './NuTape';
import { FootTape } from './FootTape';
import { TradeTape } from './TradeTape';
import { OrderBookView } from './OrderBookView';
import { VolumeDeltaChart } from './VolumeDeltaChart';
import { VolumeFootOscillatorPane } from './VolumeFootOscillatorPane';
import { PhaseSqueezerOscillatorPane } from './PhaseSqueezerOscillatorPane';
import { WikiTab } from './WikiTab';
import { Candle, Ticker, Trade } from '../../types/market';
import { LayoutGrid, Plus, Monitor, Settings, Zap } from 'lucide-react';
import { ChartGroup } from './ChartGroup';
import { useSharedStream } from '../../hooks/use-shared-stream';
import { useAdaptivePhaseSqueezer } from '../../hooks/useAdaptivePhaseSqueezer';
import { cn } from '../../lib/utils';
import { SymbolSelector } from './SymbolSelector';
import { ContextualHelp } from './ContextualHelp';

interface DashboardLayoutProps {
  symbol: string;
  marketType: 'spot' | 'perp';
  tickSize: number;
  spawnRequest?: { symbol: string; marketType: 'spot' | 'perp'; timestamp: number } | null;
  onActiveChartChange?: (state: { symbol: string, marketType: 'spot' | 'perp', timeframe: string }) => void;
  onClearSpawnRequest?: () => void;
  wikiSpawnRequest?: string | null;
  onClearWikiSpawnRequest?: () => void;
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
        type: "row",
        weight: 70,
        children: [
          {
            type: "tabset",
            weight: 100,
            id: "main-chart-tabset",
            children: [
              {
                type: "tab",
                name: "Chart",
                component: "chart",
                id: "chart-1"
              },
              {
                type: "tab",
                name: "WIKI",
                component: "wiki",
                id: "wiki-base",
                config: { slug: "introduction" }
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
            weight: 50,
            id: "right-top-tabset",
            children: [
              {
                type: "tab",
                name: "Order Book",
                component: "order_book",
                id: "order-book-1"
              }
            ]
          },
          {
            type: "tabset",
            weight: 50,
            id: "right-bottom-tabset",
            children: [
              {
                type: "tab",
                name: "Foot Tape",
                component: "foot_tape",
                id: "foot-tape-1"
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
  return <FootTape candles={candles || []} symbol={symbol} ticker={ticker} tickSize={tickSize || 0.01} />;
};

const SelfStreamingNuTape = ({ symbol, marketType }: { symbol: string, marketType: 'spot' | 'perp' }) => {
  const { trades, ticker } = useSharedStream(symbol, marketType, '1m');
  return <NuTape trades={trades || []} symbol={symbol} ticker={ticker} />;
};

const SelfStreamingTradeTape = ({ symbol, marketType }: { symbol: string, marketType: 'spot' | 'perp' }) => {
  const { trades } = useSharedStream(symbol, marketType, '1m');
  return <TradeTape trades={trades || []} />;
};

const SelfStreamingOrderBook = ({ symbol, marketType }: { symbol: string, marketType: 'spot' | 'perp' }) => {
  const { tickSize } = useSharedStream(symbol, marketType, '1m');
  return <OrderBookView symbol={symbol} marketType={marketType} tickSize={tickSize || 0.01} />;
};

const SelfStreamingDeltaChart = ({ symbol, marketType }: { symbol: string, marketType: 'spot' | 'perp' }) => {
  const { candles } = useSharedStream(symbol, marketType, '1m');
  return <VolumeDeltaChart candles={candles || []} />;
};

const SelfStreamingFootOscillator = ({ symbol, marketType }: { symbol: string, marketType: 'spot' | 'perp' }) => {
  const { candles } = useSharedStream(symbol, marketType, '1m');
  // For simplicity, we just pass what we can from here. In a real scenario, we'd need more layout info.
  return (
    <div className="w-full h-full overflow-hidden">
      <VolumeFootOscillatorPane
        candles={candles || []}
        width={800}
        height={200}
        chartWidth={600}
        rightBuffer={200}
        xOffset={0}
        slotWidth={10}
        mousePos={{ x: 0, y: 0 }}
      />
    </div>
  );
};

const SelfStreamingPhaseOscillator = ({ symbol, marketType }: { symbol: string, marketType: 'spot' | 'perp' }) => {
  const { candles } = useSharedStream(symbol, marketType, '1m');
  const { oscillatorData } = useAdaptivePhaseSqueezer(candles || [], symbol, '1m');
  return (
    <div className="w-full h-full overflow-hidden">
      <PhaseSqueezerOscillatorPane
        data={oscillatorData || []}
        width={800}
        height={200}
        chartWidth={600}
        rightBuffer={200}
        xOffset={0}
        slotWidth={10}
        mousePos={{ x: 0, y: 0 }}
      />
    </div>
  );
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
  spawnRequest,
  onActiveChartChange,
  onClearSpawnRequest,
  wikiSpawnRequest,
  onClearWikiSpawnRequest
}: DashboardLayoutProps) {

  const [model, setModel] = useState<Model>(() => {
    // Check for hard reset in URL
    const params = new URLSearchParams(window.location.search);
    if (params.get('reset') === 'true') {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CHART_STATES_KEY);
      // Remove 'reset' from URL without page reload
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }

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

  const [chartStates, setChartStates] = useState<Record<string, ChartState>>(() => {
    const saved = localStorage.getItem(CHART_STATES_KEY);
    return saved ? JSON.parse(saved) : {};
  });

  const modelRef = useRef<Model>(model);
  const isSpawningRef = useRef(false);
  const pendingSelectionRef = useRef<string | null>(null);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  // Decoupled sync notification
  const lastNotified = useRef<string>('');
  const initialSymbolRef = useRef(initialSymbol);
  const initialMarketTypeRef = useRef(initialMarketType);

  useEffect(() => {
    initialSymbolRef.current = initialSymbol;
    initialMarketTypeRef.current = initialMarketType;
  }, [initialSymbol, initialMarketType]);

  const onModelChange = useCallback((m: Model) => {
    // Persist to local storage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(m.toJson()));
    // Update local state to keep in sync
    setModel(m);
  }, []);

  // Robust notification of active chart changes
  useEffect(() => {
    if (isSpawningRef.current || pendingSelectionRef.current) return; // Prevent sync during spawning focus transition

    try {
      model.visitNodes((node) => {
        if (node.getType() === 'tab' && (node as TabNode).getComponent() === 'chart' && (node as TabNode).isSelected()) {
          const id = node.getId();
          const state = chartStates[id] || {
            symbol: initialSymbolRef.current,
            marketType: initialMarketTypeRef.current,
            timeframe: '1m',
            showSettings: false
          };
          const key = `${state.symbol}-${state.marketType}-${state.timeframe}`;
          if (key !== lastNotified.current) {
            lastNotified.current = key;
            console.log("[DashboardLayout] Active chart synchronized:", key);
            onActiveChartChange?.({
              symbol: state.symbol,
              marketType: state.marketType,
              timeframe: state.timeframe
            });
          }
        }
      });
    } catch (e) {
      console.warn("Failed to sync active chart state", e);
    }
  }, [model, chartStates, onActiveChartChange]);

  // Sync all unique symbols with backend engine to ensure preloading/persistent recording
  useEffect(() => {
    const allSymbols = new Set<string>();
    
    // 1. Extract from chartStates
    (Object.values(chartStates) as ChartState[]).forEach(state => {
      if (state.symbol) allSymbols.add(state.symbol.toLowerCase());
    });
    
    // 2. Also visit model nodes just in case some aren't in state yet
    try {
      model.visitNodes((node) => {
        if (node.getType() === 'tab') {
           const id = node.getId();
           const state = chartStates[id];
           if (state?.symbol) allSymbols.add(state.symbol.toLowerCase());
        }
      });
    } catch (e) {
      console.warn("[DashboardLayout] Error visiting nodes for sync", e);
    }
    
    if (allSymbols.size > 0) {
      const symbolsList = Array.from(allSymbols);
      fetch('/api/engine/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(symbolsList),
      }).catch(err => console.error("[Dashboard] Engine subscription failed:", err));
    }
  }, [chartStates, model]); // Re-run if model structure changes too

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

    const selected = (modelRef.current as any).getSelectedNode?.() || (modelRef.current.getActiveTabset() as any)?.getSelectedNode?.();
    if (selected?.getId() === instanceId) {
      // Logic for active chart notification goes here if needed
    }
  }, [initialSymbol, initialMarketType]);

  const resetLayout = useCallback(() => {
    const newModel = Model.fromJson(DEFAULT_LAYOUT);
    setModel(newModel);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newModel.toJson()));
  }, []);

  const addTab = useCallback((componentType: string, targetNodeId?: string, initialState?: Partial<ChartState & { index?: number }>) => {
    // Note: We use the model from state to ensure we always have the freshest version
    const currentModel = model; 
    console.log("[DashboardLayout] addTab execution started:", { componentType, targetNodeId, symbol: initialState?.symbol });

    if (componentType === 'chart') {
      let chartCount = 0;
      currentModel.visitNodes((node) => {
        if (node.getType() === 'tab' && (node as TabNode).getComponent() === 'chart') chartCount++;
      });
      if (chartCount >= 10) {
        console.warn("[DashboardLayout] Maximum charts reached, aborting addTab");
        alert("Maximum of 10 chart tabs allowed.");
        return;
      }
      console.log("[DashboardLayout] Chart count OK:", chartCount);
    }

    const id = `${componentType}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const symbolToAdd = initialState?.symbol || initialSymbolRef.current;
    const marketTypeToAdd = initialState?.marketType || initialMarketTypeRef.current;
    const timeframeToAdd = initialState?.timeframe || '1m';
    const indexToAdd = typeof initialState?.index === 'number' ? initialState.index : -1;

    // First update the external chart states
    setChartStates(prev => {
      const newState = {
        ...prev,
        [id]: {
          symbol: symbolToAdd,
          marketType: marketTypeToAdd,
          timeframe: timeframeToAdd,
          showSettings: false
        }
      };
      localStorage.setItem(CHART_STATES_KEY, JSON.stringify(newState));
      return newState;
    });

    const name = componentType === "chart" ? symbolToAdd.toUpperCase() : componentType.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');

    const tabJson = {
      type: "tab",
      component: componentType,
      name: name,
      id: id,
      config: {
        symbol: symbolToAdd,
        marketType: marketTypeToAdd,
        timeframe: timeframeToAdd
      }
    };

    // 4. Update the layout model using a fresh copy to trigger re-render
    try {
      const modelJson = currentModel.toJson();
      const newModel = Model.fromJson(modelJson);
      
      // Determine the best target ID (MUST BE A TABSET ID)
      let finalTarget = targetNodeId;
      
      // If no target provided and it's a chart, try to find the 'main-chart-tabset'
      if (!finalTarget && componentType === 'chart') {
        // First try the explicit ID
        if (newModel.getNodeById("main-chart-tabset")) {
          finalTarget = "main-chart-tabset";
        } else {
          // Fallback: search for a tabset that contains chart-1 or any chart
          newModel.visitNodes(n => {
            if (!finalTarget && n.getType() === 'tabset') {
              const children = (n as any).getChildren();
              if (children.some((c: any) => c.getId() === 'chart-1' || c.getComponent?.() === 'chart')) {
                finalTarget = n.getId();
              }
            }
          });
        }
      }

      // If no target provided and it's a tape/book, try to find the side panels
      if (!finalTarget && componentType !== 'chart') {
        const sideTarget = componentType === 'order_book' ? 'right-top-tabset' : 'right-bottom-tabset';
        if (newModel.getNodeById(sideTarget)) {
          finalTarget = sideTarget;
        }
      }

      // If still no target, try to find a suitable tabset based on current selection
      if (!finalTarget) {
        let selectedTabSet = null;
        newModel.visitNodes(n => {
          if (n.getType() === 'tabset') {
            const tabset = n as any;
            // Check if this tabset has a selected tab
            if (tabset.getSelected() !== -1) {
              selectedTabSet = tabset;
            }
          }
        });
        
        if (selectedTabSet) {
          finalTarget = (selectedTabSet as any).getId();
        }
      }

      // If still no target, search for any tabset
      if (!finalTarget) {
        newModel.visitNodes(n => { 
          if (!finalTarget && n.getType() === 'tabset') finalTarget = n.getId(); 
        });
      }

      // Final validation of target
      if (finalTarget) {
        const targetNode = newModel.getNodeById(finalTarget);
        if (!targetNode || targetNode.getType() !== 'tabset') {
          finalTarget = undefined;
          newModel.visitNodes(n => { if (!finalTarget && n.getType() === 'tabset') finalTarget = n.getId(); });
        }
      }

      if (!finalTarget) {
          console.error("[DashboardLayout] No tabset found for addition, exiting addTab");
          return;
      }
      console.log("[DashboardLayout] Final target tabset identified:", finalTarget);

      console.log(`[DashboardLayout] Adding ${componentType} to tabset ${finalTarget} with ID ${id}`);
      
      try {
          // STEP 1: Add the node to the model (NO SELECTION YET)
          // We use select=false (last arg) to ensure we control the timing
          newModel.doAction(Actions.addNode(tabJson, finalTarget, DockLocation.CENTER, indexToAdd, false));
          
          // Request selection in the next render cycle or after state update
          pendingSelectionRef.current = id;
          isSpawningRef.current = true;
          console.log("[DashboardLayout] Tab added to clone, pending selection for:", id);

          // STEP 2: Commit the new model state
          setModel(newModel);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newModel.toJson()));
      } catch (actionErr) {
          console.error("[DashboardLayout] addNode failed:", actionErr);
          isSpawningRef.current = false;
          pendingSelectionRef.current = null;
      }
    } catch (e) {
      console.error("[DashboardLayout] addTab logic failed:", e);
      isSpawningRef.current = false;
      pendingSelectionRef.current = null;
    }
  }, [model, chartStates, initialSymbol, initialMarketType]);

  // STEP 3: Handle the deferred selection once the model is committed and Layout sees the new node
  useEffect(() => {
    if (pendingSelectionRef.current) {
      const targetId = pendingSelectionRef.current;
      const node = model.getNodeById(targetId);
      
      if (node) {
        console.log("[DashboardLayout] New node detected in model, performing selection:", targetId);
        try {
          // Perform the selection on the ACTUAL live model from state
          model.doAction(Actions.selectTab(targetId));
          
          // Force another model update to ensure Layout re-renders the tab bar
          const finalModelJson = model.toJson();
          setModel(Model.fromJson(finalModelJson));
          
          console.log("[DashboardLayout] Selection action completed for:", targetId);
        } catch (err) {
          console.error("[DashboardLayout] Deferred selection failed:", err);
        } finally {
          pendingSelectionRef.current = null;
          // Hold the spawning lock just a bit longer for visual stability
          setTimeout(() => {
            isSpawningRef.current = false;
            console.log("[DashboardLayout] Spawning sequence finished for:", targetId);
          }, 800);
        }
      } else {
        // Node not in model yet, wait for next render
        console.log("[DashboardLayout] Waiting for node to appear in model state...", targetId);
      }
    }
  }, [model]);

  // Handle spawn requests
  const lastSpawnRef = useRef(0);
  const addTabRef = useRef(addTab);
  
  useEffect(() => { 
    addTabRef.current = addTab; 
  }, [addTab]);

  useEffect(() => {
    // If we have a valid spawn request that hasn't been processed yet
    if (spawnRequest && spawnRequest.timestamp > lastSpawnRef.current) {
      const currentTimestamp = spawnRequest.timestamp;
      lastSpawnRef.current = currentTimestamp;
      
      console.log("[DashboardLayout] Processing spawn request for:", spawnRequest.symbol);
      try {
          addTabRef.current('chart', undefined, {
            symbol: spawnRequest.symbol,
            marketType: spawnRequest.marketType
          });
          onClearSpawnRequest?.();
      } catch (err) {
          console.error("[DashboardLayout] Spawn failed:", err);
      }
    }
  }, [spawnRequest, onClearSpawnRequest]);

  const openWikiTab = useCallback((slug: string) => {
    const currentModel = model;
    let existingWikiId: string | null = null;
    currentModel.visitNodes((n) => {
      if (n.getType() === 'tab' && (n as TabNode).getComponent() === 'wiki') {
        existingWikiId = n.getId();
      }
    });

    if (existingWikiId) {
      // Focus existing tab
      currentModel.doAction(Actions.selectTab(existingWikiId));
      
      // Update config slug so if it ever unmounts, it reverts to the right one
      currentModel.doAction(Actions.updateNodeAttributes(existingWikiId, { config: { slug } }));
      
      setModel(Model.fromJson(currentModel.toJson()));
      
      // 150ms delay because flexlayout-react needs to render the react element first!
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('wiki-navigate', { detail: { slug } }));
      }, 150);
    } else {
      // Create new tab
      const id = `wiki-${Date.now()}`;
      const tabJson = {
        type: "tab",
        component: "wiki",
        name: "WIKI",
        id: id,
        config: { slug }
      };
      
      let targetNode: string | undefined = "main-chart-tabset";
      if (!currentModel.getNodeById(targetNode)) {
        targetNode = undefined;
        currentModel.visitNodes(n => { if (!targetNode && n.getType() === 'tabset') targetNode = n.getId(); });
      }
      if (targetNode) {
        currentModel.doAction(Actions.addNode(tabJson, targetNode, DockLocation.CENTER, -1, true));
        setModel(Model.fromJson(currentModel.toJson()));
      }
    }
  }, [model]);

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.slug) {
        openWikiTab(customEvent.detail.slug);
      }
    };
    window.addEventListener('open-wiki', handler);
    return () => window.removeEventListener('open-wiki', handler);
  }, [openWikiTab]);

  useEffect(() => {
    if (wikiSpawnRequest) {
      openWikiTab(wikiSpawnRequest);
      onClearWikiSpawnRequest?.();
    }
  }, [wikiSpawnRequest, openWikiTab, onClearWikiSpawnRequest]);

  const onRenderTabSet = useCallback((node: any, renderValues: any) => {
    const selectedTab = node.getSelectedNode() as TabNode | undefined;
    const activeComponent = selectedTab ? selectedTab.getComponent() : null;
    const isChart = activeComponent === 'chart';
    const instanceId = selectedTab?.getId();

    const handlePlusAction = (e: React.MouseEvent, type: string) => {
      e.preventDefault();
      e.stopPropagation();
      const selectedIndex = node.getSelected();
      console.log(`[DashboardLayout] + Button clicked for ${type} in set ${node.getId()} at index ${selectedIndex + 1}`);
      addTab(type, node.getId(), { index: selectedIndex + 1 });
    };

    if (isChart && instanceId) {
      renderValues.buttons.push(
        <div key="symbol-selector-wrap">
          <SymbolSelector
            currentSymbol={chartStates[instanceId]?.symbol || initialSymbol}
            onSymbolChange={(s) => updateChartState(instanceId, { symbol: s })}
            marketType={chartStates[instanceId]?.marketType || initialMarketType}
            onMarketTypeChange={(t) => updateChartState(instanceId, { marketType: t })}
            isCompact={true}
          />
        </div>
      );
      renderValues.buttons.push(
        <div key="tf-select" className="flex items-center bg-zinc-900 rounded px-1.5 py-0.5 border border-zinc-800/50 mr-1 ml-1">
          <select
            value={chartStates[instanceId]?.timeframe || '1m'}
            onChange={(e) => updateChartState(instanceId, { timeframe: e.target.value })}
            className="bg-transparent border-none text-[9px] font-bold text-zinc-400 focus:ring-0 cursor-pointer hover:text-zinc-200 transition-colors uppercase leading-tight"
          >
            {['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w'].map(tf => (
              <option key={tf} value={tf}>{tf}</option>
            ))}
          </select>
        </div>
      );
      renderValues.buttons.push(
        <button
          key="settings-btn"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); updateChartState(instanceId, { showSettings: !chartStates[instanceId]?.showSettings }); }}
          className={cn(
            "p-1 rounded transition-all duration-200 border mr-2",
            chartStates[instanceId]?.showSettings
              ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/30"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 border-transparent hover:border-zinc-800"
          )}
        >
          <Settings size={12} />
        </button>
      );
    }

    // Map component types to their respective Wiki slugs
    const componentSlugMap: Record<string, string> = {
      'chart': 'advanced-candlestick-footprint-chart',
      'foot_tape': 'tape-order-flow-tools-foottape-nutape',
      'nu_tape': 'tape-order-flow-tools-foottape-nutape',
      'trades': 'tape-order-flow-tools-foottape-nutape',
      'order_book': 'order-book-view-dom',
      'delta_chart': 'volume-foot-oscillator',
      'foot_oscillator': 'volume-foot-oscillator',
      'phase_oscillator': 'phase-squeezer-oscillator'
    };

    if (activeComponent && componentSlugMap[activeComponent]) {
      renderValues.buttons.push(
        <div key="contextual-help" className="flex items-center justify-center mr-2 opacity-50 hover:opacity-100 transition-opacity">
          <ContextualHelp slug={componentSlugMap[activeComponent]} />
        </div>
      );
    }

    // Add the specific "Add" buttons
    if (isChart) {
      renderValues.buttons.push(
        <button
          key="add-chart-btn"
          onMouseDown={(e) => handlePlusAction(e, 'chart')}
          className="hover:text-cyan-400 text-cyan-500 transition-colors p-1 mr-1"
          title="Add Chart"
        >
          <Plus size={18} strokeWidth={3} />
        </button>
      );
    } else {
      renderValues.buttons.push(
        <div key="add-buttons-group" className="flex items-center gap-1 mr-1">
          <button onMouseDown={(e) => handlePlusAction(e, 'chart')} className="hover:text-cyan-400 text-cyan-500 transition-colors p-1" title="Add Chart">
            <Plus size={14} strokeWidth={3} />
          </button>
          <button onMouseDown={(e) => handlePlusAction(e, 'order_book')} className="hover:text-white text-zinc-500 transition-colors p-1" title="Order Book">
            <Monitor size={12} />
          </button>
          <button onMouseDown={(e) => handlePlusAction(e, 'nu_tape')} className="hover:text-white text-zinc-500 transition-colors p-1" title="Nu Tape">
            <Zap size={12} />
          </button>
          <button onMouseDown={(e) => handlePlusAction(e, 'trades')} className="hover:text-white text-zinc-500 transition-colors p-1" title="Recent Trades">
            <Plus size={10} />
          </button>
          <button onMouseDown={(e) => handlePlusAction(e, 'foot_tape')} className="hover:text-white text-zinc-500 transition-colors p-1" title="Foot Tape">
            <LayoutGrid size={12} />
          </button>
        </div>
      );
    }
  }, [addTab, chartStates, updateChartState]);

  const factory = useCallback((node: TabNode) => {
    const component = node.getComponent();
    const instanceId = node.getId();
    const config = node.getConfig() || {};
    const state = chartStates[instanceId] || {
      symbol: config.symbol || initialSymbolRef.current,
      timeframe: config.timeframe || '1m',
      showSettings: false,
      marketType: config.marketType || initialMarketTypeRef.current
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
      case "foot_tape": return <SelfStreamingFootTape symbol={state.symbol} marketType={state.marketType} />;
      case "nu_tape": return <SelfStreamingNuTape symbol={state.symbol} marketType={state.marketType} />;
      case "trades": return <SelfStreamingTradeTape symbol={state.symbol} marketType={state.marketType} />;
      case "order_book": return <SelfStreamingOrderBook symbol={state.symbol} marketType={state.marketType} />;
      case "delta_chart": return <SelfStreamingDeltaChart symbol={state.symbol} marketType={state.marketType} />;
      case "foot_oscillator": return <SelfStreamingFootOscillator symbol={state.symbol} marketType={state.marketType} />;
      case "phase_oscillator": return <SelfStreamingPhaseOscillator symbol={state.symbol} marketType={state.marketType} />;
      case "wiki": return <WikiTab initialSlug={config.slug} />;
      default: return <div>Unknown {component}</div>;
    }
  }, [chartStates, updateChartState]);


  return (
    <div className="flex-1 relative overflow-hidden bg-zinc-950 group">
      <Layout
        model={model}
        factory={factory}
        onModelChange={onModelChange}
        onRenderTabSet={onRenderTabSet}
      />
      <button
        onClick={resetLayout}
        className="absolute bottom-4 right-4 z-50 p-2 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 rounded-full text-zinc-500 hover:text-cyan-400 transition-all opacity-0 group-hover:opacity-100 shadow-xl"
      >
        <LayoutGrid size={16} />
      </button>
      <style>{`
        .flexlayout__layout { position: absolute; left: 0; top: 0; right: 0; bottom: 0; background-color: #020202; overflow: hidden; }
        .flexlayout__tabset { background: rgba(9, 9, 11, 0.4); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 4px; }
        .flexlayout__tabset_header { background: rgba(24, 24, 27, 0.8) !important; border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important; height: 32px !important; }
        .flexlayout__tab { background-color: transparent; overflow: hidden; }
        .flexlayout__tab_button { background: transparent !important; color: #71717a !important; font-family: 'Orbitron', sans-serif !important; font-size: 9px !important; letter-spacing: 0.1em !important; padding: 0px 16px !important; border-right: 1px solid rgba(255, 255, 255, 0.05) !important; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important; display: flex !important; align-items: center !important; }
        .flexlayout__tab_button:not(.flexlayout__tab_button_rename) { text-transform: uppercase !important; }
        .flexlayout__tab_button_rename { text-transform: none !important; display: inline-block !important; background: #18181b !important; color: #fff !important; outline: 1px solid #22d3ee !important; padding: 0 4px !important; margin: 0 !important; cursor: text !important; pointer-events: auto !important; }
        .flexlayout__tab_button_rename input { background: transparent !important; color: #fff !important; border: none !important; outline: none !important; width: 100% !important; font-family: inherit !important; font-size: inherit !important; }
        .flexlayout__tab_button:hover { color: #22d3ee !important; background: rgba(34, 211, 238, 0.05) !important; }
        .flexlayout__tab_button--selected { background: rgba(34, 211, 238, 0.1) !important; color: #22d3ee !important; border-bottom: 2px solid #22d3ee !important; font-weight: bold !important; text-shadow: 0 0 10px rgba(34, 211, 238, 0.5) !important; }
        .flexlayout__splitter { background-color: #09090b !important; width: 1px !important; }
        .flexlayout__splitter:hover { background-color: #22d3ee55 !important; }
        .flexlayout__splitter_drag { background-color: #22d3ee; }
        .flexlayout__tab_button_popout, .flexlayout__tab_toolbar_button-float, .flexlayout__tabset_header_button_popout, .flexlayout__tabset_header_button_float { display: none !important; }
        .flexlayout__tabset-maximized { z-index: 1000; }
        .flexlayout__tabset_header_content { font-size: 10px; color: #52525b; }
      `}</style>
    </div>
  );
});
