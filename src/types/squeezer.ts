export enum MarketPhase {
  ACCUMULATION = 'ACCUMULATION', // Phase 1: Recharge / Noise inside tunnel
  TRENDING = 'TRENDING',         // Phase 2: Expansion / Breakout outside tunnel
  DISTRIBUTION = 'DISTRIBUTION'  // Phase 3: Exhaustion / Divergence
}

export enum SqueezeState {
  HIGH = 'HIGH',     // Orange (BB inside 1.0 KC)
  MID = 'MID',       // Silver (BB inside 1.5 KC)
  LOW = 'LOW',       // Gray (BB inside 2.0 KC)
  NONE = 'NONE'      // Blue (Fired - BB outside 2.0 KC)
}

export interface AdaptivePhaseSqueezerConfig {
  // Presets
  preset: 'Standard Mode' | 'Machine Learning Mode';
  
  // Squeeze Engine (Volatility)
  sqzLen: number;
  bbMult: number;
  kcMultHigh: number;
  kcMultMid: number;
  kcMultLow: number;

  // Phase Oscillator
  showPhases: boolean;
  phaseLen: number;
  phaseMult: number;

  // Structure Boxes (The Cage)
  showBoxes: boolean;
  boxTriggerMode: SqueezeState.HIGH | SqueezeState.MID | SqueezeState.LOW;
  minDotSequence: number;
  requireGapInLastXCandles?: number; // 0 for disabled
  minSuccessPercentBreakout?: number; // 0 for disabled

  // Interest Lines (Equilibrium)
  showInterestLine: boolean;
  calcMode: 'Gap Induced' | 'Box Midpoint';
  boxFallback: 'Ignore Box' | 'Use Box Midpoint';
  dynamicLineColor: boolean;

  // Zero-Lag Trendline
  showZeroLag: boolean;
  zlagSource: 'Wicks';

  // Adaptive Learning (ML)
  enableML: boolean;
  learningRate: number; // EWMA alpha for success tracking
  minConfidenceThreshold: number; // 0-100
  autoRetrainDays: number; // 0 = off, 1-30 days
  lastTrainingDate?: string;
  mlStatus?: string;
}

export interface SwingArea {
  id: string;
  startIndex: number;
  endIndex: number | null; // null if currently active
  startTime: number;
  endTime: number | null;
  top: number;
  bottom: number;
  phase: MarketPhase;
  maxSqueezeState: SqueezeState;
  confidence: number; // 0-100%
  isFallback?: boolean;
  interestLevel: number | null;
  isFired: boolean;
  volumeAccumulated: number;
  deltaAccumulated: number;
}

export interface SqueezerDataPoint {
  time: number;
  momentum: number;
  phaseUpper: number;
  phaseLower: number;
  squeezeState: SqueezeState;
  marketPhase: MarketPhase;
  zeroLagLevel: number | null;
  interestLevel: number | null;
}

export interface AdaptiveSqueezerResult {
  oscillatorData: SqueezerDataPoint[];
  swingAreas: SwingArea[];
  currentPhase: MarketPhase;
  currentConfidence: number;
}
