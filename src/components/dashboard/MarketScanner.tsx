import React, { useState, useLayoutEffect, useRef, useMemo, useCallback, useEffect } from 'react';
import {
  Zap, RefreshCw, Clock, ChevronDown, ChevronUp,
  Radar, Activity, BarChart3, Layers, Filter, RotateCcw,
  ArrowUpDown, DollarSign
} from 'lucide-react';
import { ScanResult, FilterCategory, FILTER_DEFINITIONS, FilterMeta, FilterKey, MarketCapTier, SortField } from '../../types/scanner';
import { cn } from '../../lib/utils';
import { useMarketScanner } from '../../hooks/use-market-scanner';
import { HexTile } from './HexTile';
import { CandlestickChart } from './CandlestickChart';
import { ContextualHelp } from './ContextualHelp';

const ScannerChartPreview = React.memo(({ candles, symbol }: { candles: any[], symbol: string }) => {
  const settings = useMemo(() => ({
    visibleRangeVolumeProfile: true,
    visibleRangeVolumeProfileOpacity: 45,
    showFootprintsOnChart: false,
    absorptionEnabled: false,
    imbalanceEnabled: false,
    persistentZonesEnabled: false,
    lookbackType: 'Candles' as const,
    lookbackValue: 100
  }), []);

  return (
    <CandlestickChart
      data={candles}
      symbol={symbol}
      instanceId="scanner-preview"
      simplified={true}
      overrideSettings={settings}
    />
  );
});
import { useBinanceStream } from '../../hooks/use-binance-stream';

interface MarketScannerProps {
  onSelectSymbol?: (symbol: string) => void;
  scannerState: ReturnType<typeof useMarketScanner>;
}

const CATEGORY_META: Record<FilterCategory, { label: string; icon: React.ReactNode; color: string }> = {
  core: { label: 'Core', icon: <Activity size={11} />, color: '#22D3EE' },
  technical: { label: 'Technical', icon: <BarChart3 size={11} />, color: '#A855F7' },
  orderflow: { label: 'Order Flow', icon: <Layers size={11} />, color: '#F59E0B' },
  volatility: { label: 'Volatility', icon: <Zap size={11} />, color: '#F97316' },
  liquidity: { label: 'Liquidity', icon: <Radar size={11} />, color: '#10B981' },
  market: { label: 'Market', icon: <DollarSign size={11} />, color: '#0EA5E9' },
};

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'score', label: 'Score' },
  { value: 'rvol', label: 'RVOL' },
  { value: 'price_change_5m', label: '5m Chg' },
  { value: 'price_change_1h', label: '1h Chg' },
  { value: 'vol_24h', label: '24h Vol' },
  { value: 'market_cap_tier', label: 'Mkt Cap' },
  { value: 'rsi', label: 'RSI' },
  { value: 'atr_pct', label: 'ATR %' },
];

const MARKET_CAP_TIERS: MarketCapTier[] = ['MEGA', 'LARGE', 'MID', 'SMALL', 'MICRO'];
const TIER_COLORS: Record<MarketCapTier, { active: string; glow: string }> = {
  MEGA:  { active: '#A855F7', glow: 'rgba(168, 85, 247, 0.4)' },
  LARGE: { active: '#22D3EE', glow: 'rgba(34, 211, 238, 0.4)' },
  MID:   { active: '#0EA5E9', glow: 'rgba(14, 165, 233, 0.4)' },
  SMALL: { active: '#F59E0B', glow: 'rgba(245, 158, 11, 0.4)' },
  MICRO: { active: '#71717A', glow: 'rgba(113, 113, 122, 0.3)' },
};

// ============================================================================
// Hex Clip Path for filter chips — a flat-topped hexagon
// ============================================================================
const HEX_CLIP = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
const HEX_CLIP_WIDE = 'polygon(12% 0%, 88% 0%, 100% 50%, 88% 100%, 12% 100%, 0% 50%)';

export function MarketScanner({ onSelectSymbol, scannerState }: MarketScannerProps) {
  const {
    results, totalCount, isScanning, lastScan, filters,
    toggleFilter, updateFilterValue, updateRangeFilter, setSort, resetFilters, activeFilterCount,
  } = scannerState;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const [debouncedHoveredSymbol, setDebouncedHoveredSymbol] = useState<string | null>(null);
  const [activeZSymbols, setActiveZSymbols] = useState<Set<string>>(new Set());
  const zIndexTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});

  const handleHover = useCallback((sym: string | null) => {
    if (sym === hoveredSymbol) return;
    setHoveredSymbol(sym);
    if (sym) {
      setActiveZSymbols(prev => new Set(prev).add(sym));
      if (zIndexTimeoutsRef.current[sym]) {
        clearTimeout(zIndexTimeoutsRef.current[sym]);
        delete zIndexTimeoutsRef.current[sym];
      }
    }
  }, [hoveredSymbol]);

  useEffect(() => {}, [hoveredSymbol]);

  useEffect(() => {
    const prevHovered = hoveredSymbol;
    return () => {
      if (prevHovered) {
        const sym = prevHovered;
        zIndexTimeoutsRef.current[sym] = setTimeout(() => {
          setActiveZSymbols(prev => {
            const next = new Set(prev);
            next.delete(sym);
            return next;
          });
          delete zIndexTimeoutsRef.current[sym];
        }, 1200);
      }
    };
  }, [hoveredSymbol]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedHoveredSymbol(hoveredSymbol);
    }, 400);
    return () => clearTimeout(timer);
  }, [hoveredSymbol]);

  const previewSymbol = useMemo(() => {
    const raw = (debouncedHoveredSymbol || (results.length > 0 ? results[0].symbol : 'btcusdt')).toLowerCase();
    return raw.endsWith('usdt') ? raw : raw + 'usdt';
  }, [debouncedHoveredSymbol, results]);

  const { candles: previewCandles } = useBinanceStream(previewSymbol, 'spot', '1m');

  useEffect(() => {
    return () => { Object.values(zIndexTimeoutsRef.current).forEach(clearTimeout); };
  }, []);

  const hexWidth = 120;
  const hexHeight = 138;
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) setContainerWidth(containerRef.current.offsetWidth);
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const cols = Math.max(1, Math.floor((containerWidth - 142) / (hexWidth + 4)));
  const chartCols = Math.min(cols - 1, Math.max(1, Math.floor(containerWidth * 0.32 / hexWidth) + 1));
  const chartRows = 5;

  const lastResultsRef = useRef<ScanResult[]>([]);
  const gridResults = useMemo(() => {
    if (hoveredSymbol && lastResultsRef.current.length > 0) {
      const currentDataMap = new Map(results.map(r => [r.symbol, r]));
      return lastResultsRef.current.map(oldR => {
        const current = currentDataMap.get(oldR.symbol);
        return (current && typeof current === 'object') ? { ...current } as ScanResult : oldR;
      });
    }
    lastResultsRef.current = results;
    return results;
  }, [results, hoveredSymbol]);

  const gridData = useMemo(() => {
    const isSlotBlocked = (r: number, c: number) => {
      const extra = (r % 2 === 0 && r < 6) ? 0 : 1;
      return r < (chartRows || 5) && c >= (cols - (chartCols || 0) - extra);
    };
    const rows: (any | null)[][] = [];
    if (!gridResults || !Array.isArray(gridResults)) return { rows: [], cols, chartCols, chartRows };
    let resultIdx = 0;
    let currentRowIdx = 0;
    while (resultIdx < gridResults.length && currentRowIdx < 100) {
      const rowSlots = [];
      for (let c = 0; c < cols; c++) {
        if (isSlotBlocked(currentRowIdx, c)) rowSlots.push(null);
        else if (resultIdx < gridResults.length) rowSlots.push(gridResults[resultIdx++]);
      }
      rows.push(rowSlots);
      currentRowIdx++;
    }
    return { rows, cols, chartCols, chartRows };
  }, [gridResults, cols, chartCols, chartRows]);

  const { rows: gridRows } = gridData;

  const toggleMarketCapTier = useCallback((tier: MarketCapTier) => {
    const current = filters.marketCapTiers.value;
    const next = new Set(current);
    if (next.has(tier)) next.delete(tier); else next.add(tier);
    updateFilterValue('marketCapTiers', next);
    if (!filters.marketCapTiers.enabled) toggleFilter('marketCapTiers');
  }, [filters.marketCapTiers, updateFilterValue, toggleFilter]);

  return (
    <div className="flex flex-col h-full bg-[#030305] overflow-hidden">
      {/* === HEADER === */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/60 bg-[#060608] shrink-0 z-50">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Zap className="text-cyan-400" size={16} />
            {isScanning && <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-cyan-400 rounded-full animate-ping" />}
          </div>
          <h2 className="text-sm font-bold text-zinc-200 font-display tracking-tight uppercase">Market Scanner</h2>
          <ContextualHelp slug="market-scanner" className="ml-1" />
          <span className="text-[10px] font-mono text-zinc-500 bg-zinc-900/80 px-2 py-0.5 border border-zinc-800/60" style={{ clipPath: HEX_CLIP_WIDE }}>
            {results.length}{activeFilterCount > 0 && <span className="text-zinc-600"> / {totalCount}</span>}
          </span>
          {activeFilterCount > 0 && (
            <span className="text-[9px] font-mono text-cyan-400 bg-cyan-400/5 px-2 py-0.5 border border-cyan-400/20" style={{ clipPath: HEX_CLIP_WIDE }}>
              {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-[10px] font-mono">
          <div className="flex items-center gap-2">
            <span className="text-zinc-600 uppercase tracking-wider">Status</span>
            {isScanning ? (
              <span className="text-cyan-400 flex items-center gap-1.5"><RefreshCw size={10} className="animate-spin" /> SCANNING</span>
            ) : (
              <span className="text-emerald-500 flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-emerald-500 animate-pulse" style={{ clipPath: HEX_CLIP }} /> ACTIVE</span>
            )}
          </div>
          <div className="flex items-center gap-2 pl-3 border-l border-zinc-800/60">
            <Clock size={10} className="text-zinc-600" />
            <span className="text-zinc-400 tabular-nums">{new Date(lastScan).toLocaleTimeString([], { hour12: false })}</span>
          </div>
          {/* Sort */}
          <div className="flex items-center gap-1.5 pl-3 border-l border-zinc-800/60">
            <ArrowUpDown size={10} className="text-zinc-500" />
            <select value={filters.sortBy} onChange={e => setSort(e.target.value as SortField)}
              className="bg-zinc-950 border border-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300 outline-none cursor-pointer hover:border-zinc-700">
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button onClick={() => setSort(filters.sortBy, filters.sortDir === 'desc' ? 'asc' : 'desc')}
              className="text-zinc-500 hover:text-zinc-300 transition-colors" title={filters.sortDir === 'desc' ? 'Desc' : 'Asc'}>
              {filters.sortDir === 'desc' ? '↓' : '↑'}
            </button>
          </div>
          {/* Filters toggle */}
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider transition-all"
            style={{
              clipPath: HEX_CLIP_WIDE,
              background: filtersOpen ? 'rgba(34, 211, 238, 0.12)' : activeFilterCount > 0 ? 'rgba(34, 211, 238, 0.06)' : 'rgba(39, 39, 42, 0.5)',
              color: filtersOpen || activeFilterCount > 0 ? '#22D3EE' : '#71717A',
              boxShadow: filtersOpen ? '0 0 15px rgba(34, 211, 238, 0.15)' : 'none',
            }}
          >
            {filtersOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            FILTERS
          </button>
        </div>
      </div>

      {/* === HEX FILTER PANEL === */}
      <div className={cn(
        "overflow-hidden transition-all duration-400 ease-in-out shrink-0 z-40",
        filtersOpen ? "max-h-[380px] opacity-100" : "max-h-0 opacity-0"
      )}>
        <div className="relative px-4 py-4">
          {/* Honeycomb background pattern */}
          <div className="absolute inset-0 opacity-[0.03]" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='56' height='100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M28 66L0 50L0 16L28 0L56 16L56 50L28 66L28 100' fill='none' stroke='%2322D3EE' stroke-width='1'/%3E%3Cpath d='M28 0L28 34L0 50L0 84L28 100L56 84L56 50L28 34' fill='none' stroke='%2322D3EE' stroke-width='1'/%3E%3C/svg%3E")`,
            backgroundSize: '56px 100px'
          }} />

          {/* Filter rows by category */}
          <div className="relative flex flex-col gap-3">
            {(Object.keys(CATEGORY_META) as FilterCategory[]).map(cat => {
              const meta = CATEGORY_META[cat];
              const catFilters = FILTER_DEFINITIONS.filter(f => f.category === cat);
              if (catFilters.length === 0) return null;

              return (
                <div key={cat} className="flex items-center gap-3">
                  {/* Category hex badge */}
                  <div className="shrink-0 flex items-center gap-1.5 w-[90px]">
                    <div className="w-5 h-5 flex items-center justify-center" style={{ clipPath: HEX_CLIP, background: `${meta.color}20` }}>
                      <span style={{ color: meta.color }}>{meta.icon}</span>
                    </div>
                    <span className="text-[8px] font-bold uppercase tracking-[0.12em]" style={{ color: meta.color + 'AA' }}>
                      {meta.label}
                    </span>
                  </div>
                  {/* Filter hex chips */}
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {catFilters.map(fDef => (
                      <HexFilterChip
                        key={fDef.key}
                        def={fDef}
                        filters={filters}
                        toggleFilter={toggleFilter}
                        updateFilterValue={updateFilterValue}
                        updateRangeFilter={updateRangeFilter}
                        toggleMarketCapTier={toggleMarketCapTier}
                        categoryColor={meta.color}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Reset hex button */}
          {activeFilterCount > 0 && (
            <div className="flex justify-end mt-3">
              <button
                onClick={resetFilters}
                className="flex items-center gap-1.5 px-4 py-2 text-[9px] font-mono font-bold uppercase tracking-widest transition-all hover:scale-105"
                style={{
                  clipPath: HEX_CLIP_WIDE,
                  background: 'rgba(239, 68, 68, 0.08)',
                  color: '#F87171',
                  boxShadow: '0 0 12px rgba(239, 68, 68, 0.1)',
                }}
              >
                <RotateCcw size={10} />
                RESET HIVE
              </button>
            </div>
          )}
        </div>
      </div>

      {/* === HONEYCOMB HEX GRID === */}
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pb-[50vh]" ref={containerRef}>
        {results.length > 0 ? (
          <div className="honeycomb-rows-container py-24 px-32 flex flex-col items-center relative min-w-max">
            <div className="absolute top-24 right-16 z-[50] overflow-hidden" style={{
              width: `${Math.max(10, (chartCols * (hexWidth + 4) - 20) * 0.95)}px`,
              height: `${Math.max(10, (chartRows * (hexHeight - 32) - 0) * 0.95)}px`,
            }}>
              <ScannerChartPreview candles={previewCandles} symbol={previewSymbol} />
              <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-white/5" />
            </div>

            {gridRows.map((rowSlots, rowIndex) => {
              const isEvenRow = rowIndex % 2 === 0;
              const isTopRow = rowSlots.some(slot => slot && activeZSymbols.has(slot.symbol));
              return (
                <div key={`row-${rowIndex}`} className="honeycomb-row flex items-center justify-center pointer-events-none"
                  style={{
                    marginTop: rowIndex === 0 ? '0' : '-32px',
                    transform: isEvenRow ? 'none' : 'translateX(62px)',
                    height: `${hexHeight}px`, zIndex: isTopRow ? 2000 : 1, position: 'relative'
                  }}>
                  {rowSlots.map((r, i) => {
                    if (r === null) return <div key={`empty-${rowIndex}-${i}`} style={{ width: `${hexWidth}px`, margin: '0 2px' }} />;
                    const isHoveredSlot = r.symbol === hoveredSymbol;
                    const isTopSlot = activeZSymbols.has(r.symbol);
                    return (
                      <div key={r.symbol} className="honeycomb-slot relative pointer-events-auto"
                        style={{ width: `${hexWidth}px`, height: `${hexHeight}px`, margin: '0 2px', zIndex: isTopSlot ? 2100 : 1 }}>
                        <HexTile result={r}
                          onClick={() => { const sym = r.symbol.endsWith('usdt') ? r.symbol : r.symbol + 'usdt'; onSelectSymbol?.(sym); }}
                          onHover={handleHover} delay={(rowIndex * cols + i) * 30} isActive={isHoveredSlot} />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500">
            <div className="p-6 bg-zinc-900/50 border border-zinc-800/50 mb-6" style={{ clipPath: HEX_CLIP }}>
              <Radar size={36} className="animate-pulse text-zinc-700" />
            </div>
            <p className="text-xs font-mono text-zinc-500">{isScanning ? 'Scanning markets...' : 'No assets found'}</p>
          </div>
        )}
      </div>

      <style>{`
        .honeycomb-row { display: flex; align-items: center; justify-content: center; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}

// ============================================================================
// HEX FILTER CHIP — The main visual element (hexagonal shape!)
// ============================================================================

function HexFilterChip({
  def, filters, toggleFilter, updateFilterValue, updateRangeFilter, toggleMarketCapTier, categoryColor
}: {
  def: FilterMeta;
  filters: any;
  toggleFilter: (key: FilterKey) => void;
  updateFilterValue: (key: FilterKey, value: any) => void;
  updateRangeFilter: (key: FilterKey, field: 'min' | 'max', val: number) => void;
  toggleMarketCapTier: (tier: MarketCapTier) => void;
  categoryColor: string;
}) {
  const filterState = filters[def.key];
  const isEnabled = filterState?.enabled ?? false;

  const activeBg = `${categoryColor}18`;
  const activeGlow = `0 0 16px ${categoryColor}25`;
  const activeBorder = `${categoryColor}50`;

  // Market cap tiers — show as a row of mini hex tiles
  if (def.type === 'tiers') {
    const tiers: Set<MarketCapTier> = filterState?.value ?? new Set(MARKET_CAP_TIERS);
    return (
      <div className="flex items-center gap-1">
        {/* Toggle button */}
        <button onClick={() => toggleFilter(def.key)}
          className="flex items-center gap-1 px-3 py-1.5 text-[8px] font-mono font-bold uppercase tracking-wider transition-all"
          style={{
            clipPath: HEX_CLIP_WIDE,
            background: isEnabled ? activeBg : 'rgba(24, 24, 27, 0.6)',
            color: isEnabled ? categoryColor : '#52525B',
            boxShadow: isEnabled ? activeGlow : 'none',
          }}
        >
          {def.label}
        </button>
        {MARKET_CAP_TIERS.map(tier => {
          const tc = TIER_COLORS[tier];
          const selected = isEnabled && tiers.has(tier);
          return (
            <button key={tier} onClick={() => toggleMarketCapTier(tier)}
              className="px-2 py-1 text-[7px] font-mono font-black uppercase tracking-wider transition-all"
              style={{
                clipPath: HEX_CLIP_WIDE,
                background: selected ? `${tc.active}20` : 'rgba(24, 24, 27, 0.4)',
                color: selected ? tc.active : '#3F3F46',
                boxShadow: selected ? `0 0 10px ${tc.glow}` : 'none',
              }}
            >
              {tier}
            </button>
          );
        })}
      </div>
    );
  }

  // RSI range filter
  if (def.type === 'range') {
    return (
      <div className="flex items-center gap-0.5">
        <button onClick={() => toggleFilter(def.key)}
          className="flex items-center gap-1 px-3 py-1.5 text-[8px] font-mono font-bold uppercase tracking-wider transition-all"
          style={{
            clipPath: HEX_CLIP_WIDE,
            background: isEnabled ? activeBg : 'rgba(24, 24, 27, 0.6)',
            color: isEnabled ? categoryColor : '#52525B',
            boxShadow: isEnabled ? activeGlow : 'none',
          }}
        >
          {def.label}
        </button>
        <div className="flex items-center gap-0.5 px-2 py-1" style={{
          clipPath: HEX_CLIP_WIDE,
          background: isEnabled ? 'rgba(24, 24, 27, 0.8)' : 'rgba(24, 24, 27, 0.4)',
        }}>
          <input type="number" value={filterState?.min ?? 30}
            onChange={e => updateRangeFilter(def.key, 'min', Number(e.target.value))}
            className="w-8 text-center bg-transparent text-[9px] font-mono outline-none tabular-nums"
            style={{ color: isEnabled ? '#E4E4E7' : '#52525B' }} />
          <span className="text-[7px] text-zinc-600 px-0.5">—</span>
          <input type="number" value={filterState?.max ?? 70}
            onChange={e => updateRangeFilter(def.key, 'max', Number(e.target.value))}
            className="w-8 text-center bg-transparent text-[9px] font-mono outline-none tabular-nums"
            style={{ color: isEnabled ? '#E4E4E7' : '#52525B' }} />
        </div>
      </div>
    );
  }

  // Boolean toggle
  if (def.type === 'boolean') {
    return (
      <button onClick={() => {
        if (!isEnabled) { toggleFilter(def.key); updateFilterValue(def.key, true); }
        else toggleFilter(def.key);
      }}
        className="flex items-center gap-1 px-3 py-1.5 text-[8px] font-mono font-bold uppercase tracking-wider transition-all"
        style={{
          clipPath: HEX_CLIP_WIDE,
          background: isEnabled ? activeBg : 'rgba(24, 24, 27, 0.6)',
          color: isEnabled ? categoryColor : '#52525B',
          boxShadow: isEnabled ? activeGlow : 'none',
        }}
      >
        <Zap size={9} />
        {def.label}
      </button>
    );
  }

  // Number filter — hex chip with embedded input
  return (
    <div className="flex items-center gap-0" style={{ filter: isEnabled ? `drop-shadow(0 0 6px ${categoryColor}30)` : 'none' }}>
      <button onClick={() => toggleFilter(def.key)}
        className="flex items-center gap-1 pl-3 pr-1 py-1.5 text-[8px] font-mono font-bold uppercase tracking-wider transition-all"
        style={{
          clipPath: 'polygon(12% 0%, 100% 0%, 100% 100%, 12% 100%, 0% 50%)',
          background: isEnabled ? activeBg : 'rgba(24, 24, 27, 0.6)',
          color: isEnabled ? categoryColor : '#52525B',
        }}
      >
        {def.label}
      </button>
      <div className="flex items-center px-2 pr-3 py-1.5" style={{
        clipPath: 'polygon(0% 0%, 88% 0%, 100% 50%, 88% 100%, 0% 100%)',
        background: isEnabled ? 'rgba(24, 24, 27, 0.9)' : 'rgba(24, 24, 27, 0.4)',
        marginLeft: '-1px',
      }}>
        <input type="number" value={filterState?.value ?? 0} step={def.step}
          onChange={e => updateFilterValue(def.key, Number(e.target.value))}
          className="w-12 bg-transparent text-[9px] font-mono outline-none tabular-nums text-right"
          style={{ color: isEnabled ? '#E4E4E7' : '#52525B' }} />
        {def.suffix && <span className="text-[8px] ml-0.5" style={{ color: isEnabled ? categoryColor + '80' : '#3F3F46' }}>{def.suffix}</span>}
      </div>
    </div>
  );
}
