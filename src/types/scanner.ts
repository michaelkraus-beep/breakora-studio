// ---------------------------------------------------------------------------
// Scanner Types
// ---------------------------------------------------------------------------

export type MarketCapTier = 'MEGA' | 'LARGE' | 'MID' | 'SMALL' | 'MICRO';

export interface ScanResult {
  symbol: string;
  price: number;
  // Core
  price_change_5m: number;
  price_change_15m: number;
  price_change_1h: number;
  rvol: number;
  vol_surge_pct: number;
  vwap_pct: number;
  is_new_high: boolean;
  is_new_low: boolean;
  // Technical
  rsi: number;
  macd_signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  bollinger_b: number;
  bb_width: number;
  supertrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  atr_pct: number;
  ema_alignment: 'BULLISH' | 'BEARISH' | 'MIXED';
  // Order Flow
  delta_divergence: boolean;
  imbalance_ratio: number;
  stacked_imbalance: number;
  large_trade_detected: boolean;
  absorption: 'BULLISH' | 'BEARISH' | 'NONE';
  // Volatility
  squeeze_state: 'HIGH' | 'MID' | 'LOW' | 'NONE';
  ttm_squeeze_fired: 'LONG' | 'SHORT' | 'NONE';
  atr_expansion: boolean;
  // Liquidity / Market
  vol_24h: number;
  market_cap_tier: MarketCapTier;
  ob_depth: number;
  slippage: number;
  funding_rate: number;

  score: number;
  triggered_filters: string[];
  discovery?: boolean;
}

// ---------------------------------------------------------------------------
// Per-Filter Toggle Model
// ---------------------------------------------------------------------------

export interface FilterToggle<T = number> {
  enabled: boolean;
  value: T;
}

export interface RangeFilterToggle {
  enabled: boolean;
  min: number;
  max: number;
}

export type SortField = 'score' | 'rvol' | 'price_change_5m' | 'price_change_1h' | 'vol_24h' | 'market_cap_tier' | 'rsi' | 'atr_pct';
export type SortDir = 'asc' | 'desc';

export type FilterCategory = 'core' | 'technical' | 'orderflow' | 'volatility' | 'liquidity' | 'market';

export interface ScannerFilters {
  // Core
  minRvol: FilterToggle;
  minVolSurge: FilterToggle;
  minPriceChange: FilterToggle;
  minVwapDev: FilterToggle;
  // Technical
  rsiRange: RangeFilterToggle;         // oversold/overbought
  minAtrPct: FilterToggle;
  // Order Flow
  minImbalanceRatio: FilterToggle;
  minStackedLevels: FilterToggle;
  // Volatility
  onlyFiredSqueezes: FilterToggle<boolean>;
  // Liquidity
  minObDepth: FilterToggle;
  maxSlippage: FilterToggle;
  // Market
  marketCapTiers: FilterToggle<Set<MarketCapTier>>;
  minVol24h: FilterToggle;
  // Global
  sortBy: SortField;
  sortDir: SortDir;
  minScore: FilterToggle;
}

export const DEFAULT_SCANNER_FILTERS: ScannerFilters = {
  // Core — all disabled by default so all results show
  minRvol:          { enabled: false, value: 2.0 },
  minVolSurge:      { enabled: false, value: 150 },
  minPriceChange:   { enabled: false, value: 1.0 },
  minVwapDev:       { enabled: false, value: 1.5 },
  // Technical
  rsiRange:         { enabled: false, min: 30, max: 70 },
  minAtrPct:        { enabled: false, value: 0.5 },
  // Order Flow
  minImbalanceRatio: { enabled: false, value: 2.5 },
  minStackedLevels:  { enabled: false, value: 2 },
  // Volatility
  onlyFiredSqueezes: { enabled: false, value: false },
  // Liquidity
  minObDepth:       { enabled: false, value: 50000 },
  maxSlippage:      { enabled: false, value: 0.5 },
  // Market
  marketCapTiers:   { enabled: false, value: new Set<MarketCapTier>(['MEGA', 'LARGE', 'MID', 'SMALL', 'MICRO']) },
  minVol24h:        { enabled: false, value: 1_000_000 },
  // Global
  sortBy: 'score',
  sortDir: 'desc',
  minScore:         { enabled: false, value: 5 },
};

/** Filter metadata for UI rendering */
export type FilterKey = keyof Omit<ScannerFilters, 'sortBy' | 'sortDir'>;

export interface FilterMeta {
  key: FilterKey;
  label: string;
  category: FilterCategory;
  suffix?: string;
  step?: number;
  type: 'number' | 'range' | 'boolean' | 'tiers';
}

export const FILTER_DEFINITIONS: FilterMeta[] = [
  // Core
  { key: 'minRvol',          label: 'Min RVOL',        category: 'core',       suffix: '×',  step: 0.5,   type: 'number' },
  { key: 'minVolSurge',      label: 'Vol Surge',       category: 'core',       suffix: '%',  step: 50,    type: 'number' },
  { key: 'minPriceChange',   label: 'Price Chg',       category: 'core',       suffix: '%',  step: 0.5,   type: 'number' },
  { key: 'minVwapDev',       label: 'VWAP Dev',        category: 'core',       suffix: '%',  step: 0.5,   type: 'number' },
  // Technical
  { key: 'rsiRange',         label: 'RSI Range',       category: 'technical',                             type: 'range' },
  { key: 'minAtrPct',        label: 'Min ATR',         category: 'technical',  suffix: '%',  step: 0.1,   type: 'number' },
  // Order Flow
  { key: 'minImbalanceRatio', label: 'Imbalance',      category: 'orderflow',  suffix: ':1', step: 0.5,   type: 'number' },
  { key: 'minStackedLevels',  label: 'Stacked Lvl',    category: 'orderflow',                step: 1,     type: 'number' },
  // Volatility
  { key: 'onlyFiredSqueezes', label: 'Squeeze Fire',   category: 'volatility',                            type: 'boolean' },
  // Liquidity
  { key: 'minObDepth',       label: 'OB Depth',        category: 'liquidity',  suffix: '$',  step: 10_000, type: 'number' },
  { key: 'maxSlippage',      label: 'Max Slip',        category: 'liquidity',  suffix: '%',  step: 0.1,   type: 'number' },
  // Market
  { key: 'marketCapTiers',   label: 'Market Cap',      category: 'market',                                type: 'tiers' },
  { key: 'minVol24h',        label: 'Min 24h Vol',     category: 'market',     suffix: '$',  step: 500_000, type: 'number' },
  // Global
  { key: 'minScore',         label: 'Min Score',       category: 'core',                     step: 5,     type: 'number' },
];
