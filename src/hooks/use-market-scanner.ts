import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  ScanResult, ScannerFilters, FilterKey, MarketCapTier,
  DEFAULT_SCANNER_FILTERS, SortField, SortDir
} from '../types/scanner';

/** Market cap tier ordering for sorting */
const TIER_ORDER: Record<string, number> = { MEGA: 5, LARGE: 4, MID: 3, SMALL: 2, MICRO: 1 };

export function useMarketScanner() {
  const [rawResults, setRawResults] = useState<ScanResult[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScan, setLastScan] = useState<number>(Date.now());
  const [filters, setFilters] = useState<ScannerFilters>(() => ({ ...DEFAULT_SCANNER_FILTERS }));
  const [totalCount, setTotalCount] = useState(0);
  const scanRef = useRef<AbortController | null>(null);

  // -----------------------------------------------------------------------
  // Toggle a single filter on/off
  // -----------------------------------------------------------------------
  const toggleFilter = useCallback((key: FilterKey) => {
    setFilters(prev => {
      const current = prev[key];
      if (current && typeof current === 'object' && 'enabled' in current) {
        return { ...prev, [key]: { ...current, enabled: !current.enabled } };
      }
      return prev;
    });
  }, []);

  // -----------------------------------------------------------------------
  // Update filter value (number, boolean, or set)
  // -----------------------------------------------------------------------
  const updateFilterValue = useCallback(<K extends FilterKey>(key: K, value: any) => {
    setFilters(prev => {
      const current = prev[key];
      if (current && typeof current === 'object' && 'enabled' in current) {
        return { ...prev, [key]: { ...current, value } };
      }
      return prev;
    });
  }, []);

  // -----------------------------------------------------------------------
  // Update range filter (RSI)
  // -----------------------------------------------------------------------
  const updateRangeFilter = useCallback((key: FilterKey, field: 'min' | 'max', val: number) => {
    setFilters(prev => {
      const current = prev[key] as any;
      if (current && 'min' in current) {
        return { ...prev, [key]: { ...current, [field]: val } };
      }
      return prev;
    });
  }, []);

  // -----------------------------------------------------------------------
  // Set sort
  // -----------------------------------------------------------------------
  const setSort = useCallback((sortBy: SortField, sortDir?: SortDir) => {
    setFilters(prev => ({
      ...prev,
      sortBy,
      sortDir: sortDir ?? (prev.sortBy === sortBy ? (prev.sortDir === 'desc' ? 'asc' : 'desc') : 'desc')
    }));
  }, []);

  // -----------------------------------------------------------------------
  // Reset all filters to defaults
  // -----------------------------------------------------------------------
  const resetFilters = useCallback(() => {
    setFilters({ ...DEFAULT_SCANNER_FILTERS, marketCapTiers: { enabled: false, value: new Set(['MEGA', 'LARGE', 'MID', 'SMALL', 'MICRO'] as MarketCapTier[]) } });
  }, []);

  // -----------------------------------------------------------------------
  // Client-side filter: only apply ENABLED filters (AND logic among enabled)
  // -----------------------------------------------------------------------
  const applyClientFilters = useCallback((raw: ScanResult[]): ScanResult[] => {
    return raw.filter(r => {
      // Min Score
      if (filters.minScore.enabled && r.score < filters.minScore.value) return false;

      // Core
      if (filters.minRvol.enabled && r.rvol < filters.minRvol.value) return false;
      if (filters.minVolSurge.enabled && r.vol_surge_pct < filters.minVolSurge.value) return false;
      if (filters.minPriceChange.enabled && Math.abs(r.price_change_5m) < filters.minPriceChange.value) return false;
      if (filters.minVwapDev.enabled && Math.abs(r.vwap_pct) < filters.minVwapDev.value) return false;

      // Technical
      if (filters.rsiRange.enabled) {
        const inExtreme = r.rsi <= filters.rsiRange.min || r.rsi >= filters.rsiRange.max;
        if (!inExtreme) return false;
      }
      if (filters.minAtrPct.enabled && r.atr_pct < filters.minAtrPct.value) return false;

      // Order Flow
      if (filters.minImbalanceRatio.enabled && r.imbalance_ratio < filters.minImbalanceRatio.value) return false;
      if (filters.minStackedLevels.enabled && r.stacked_imbalance < filters.minStackedLevels.value) return false;

      // Volatility
      if (filters.onlyFiredSqueezes.enabled && filters.onlyFiredSqueezes.value && r.ttm_squeeze_fired === 'NONE') return false;

      // Liquidity
      if (filters.minObDepth.enabled && r.ob_depth < filters.minObDepth.value) return false;
      if (filters.maxSlippage.enabled && r.slippage > filters.maxSlippage.value) return false;

      // Market
      if (filters.marketCapTiers.enabled && !filters.marketCapTiers.value.has(r.market_cap_tier)) return false;
      if (filters.minVol24h.enabled && r.vol_24h < filters.minVol24h.value) return false;

      return true;
    });
  }, [filters]);

  // -----------------------------------------------------------------------
  // Sort results
  // -----------------------------------------------------------------------
  const sortResults = useCallback((items: ScanResult[]): ScanResult[] => {
    const { sortBy, sortDir } = filters;
    const sorted = [...items];
    const dir = sortDir === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'score': return (a.score - b.score) * dir;
        case 'rvol': return (a.rvol - b.rvol) * dir;
        case 'price_change_5m': return (a.price_change_5m - b.price_change_5m) * dir;
        case 'price_change_1h': return (a.price_change_1h - b.price_change_1h) * dir;
        case 'vol_24h': return (a.vol_24h - b.vol_24h) * dir;
        case 'rsi': return (a.rsi - b.rsi) * dir;
        case 'atr_pct': return (a.atr_pct - b.atr_pct) * dir;
        case 'market_cap_tier': return ((TIER_ORDER[a.market_cap_tier] || 0) - (TIER_ORDER[b.market_cap_tier] || 0)) * dir;
        default: return 0;
      }
    });
    return sorted;
  }, [filters]);

  // -----------------------------------------------------------------------
  // Compute filtered + sorted results
  // -----------------------------------------------------------------------
  const results = useMemo(() => {
    const filtered = applyClientFilters(rawResults);
    return sortResults(filtered);
  }, [rawResults, applyClientFilters, sortResults]);

  // -----------------------------------------------------------------------
  // Scan
  // -----------------------------------------------------------------------
  const scanMarket = useCallback(async () => {
    if (scanRef.current) scanRef.current.abort();
    const controller = new AbortController();
    scanRef.current = controller;

    setIsScanning(true);
    try {
      const res = await fetch('/api/scanner/scan?market_type=spot&lookback=120', {
        signal: controller.signal,
      });

      await new Promise(r => setTimeout(r, 500));

      if (!res.ok) throw new Error(`Scanner API returned ${res.status}`);
      const data = await res.json();
      const raw: ScanResult[] = data.results || [];
      console.log(`[Scanner] Fetched ${raw.length} results from backend`);

      setRawResults(raw);
      setTotalCount(raw.length);

      // Auto-subscribe top 10 to backend engine
      const filtered = applyClientFilters(raw);
      const topSymbols = Array.from(new Set(filtered.slice(0, 10).map(r => r.symbol)));
      if (topSymbols.length > 0) {
        fetch('/api/engine/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(topSymbols),
        }).catch(() => { });
      }

      setLastScan(Date.now());
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error('[Scanner] Scan failed:', e);
      }
    } finally {
      setIsScanning(false);
    }
  }, [applyClientFilters]);

  useEffect(() => {
    scanMarket();
    const interval = setInterval(scanMarket, 10_000);
    return () => clearInterval(interval);
  }, [scanMarket]);

  // Count how many filters are currently enabled
  const activeFilterCount = useMemo(() => {
    let count = 0;
    const filterKeys: FilterKey[] = [
      'minRvol', 'minVolSurge', 'minPriceChange', 'minVwapDev',
      'rsiRange', 'minAtrPct', 'minImbalanceRatio', 'minStackedLevels',
      'onlyFiredSqueezes', 'minObDepth', 'maxSlippage', 'marketCapTiers',
      'minVol24h', 'minScore'
    ];
    for (const key of filterKeys) {
      const f = filters[key];
      if (f && typeof f === 'object' && 'enabled' in f && f.enabled) count++;
    }
    return count;
  }, [filters]);

  return useMemo(() => ({
    results,
    rawResults,
    totalCount,
    isScanning,
    lastScan,
    filters,
    setFilters,
    toggleFilter,
    updateFilterValue,
    updateRangeFilter,
    setSort,
    resetFilters,
    scanMarket,
    activeFilterCount,
  }), [results, rawResults, totalCount, isScanning, lastScan, filters, setFilters, toggleFilter, updateFilterValue, updateRangeFilter, setSort, resetFilters, scanMarket, activeFilterCount]);
}
