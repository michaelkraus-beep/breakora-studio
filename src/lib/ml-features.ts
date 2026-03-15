import { Candle } from '../types/market';
import { SwingArea, SqueezeState, MarketPhase } from '../types/squeezer';
import { calculateTR, calculateSMA } from './indicators';

export interface MLFeatures {
    squeezeIntensity: number;
    phaseValue: number;
    phaseSlope: number;
    fvgSize: number;
    fvgDirection: number;
    fvgDistance: number;
    imbalanceStack: number;
    deltaConfluence: number;
    marketStructure: number;
    relativePosition: number;
    sessionHour: number;
    volatilityRegime: number;
    preBoxTrend: number;
    boxCompression: number;
    poiCrosses: number;
    fakeoutCount: number;
}

export function extractFeatures(
    area: SwingArea,
    candles: Candle[],
    momentum: number[],
    phaseUpper: number[],
    phaseLower: number[],
    currentIndex: number
): number[] {
    const candle = candles[currentIndex];
    const prevCandle = candles[currentIndex - 1];

    // 1. Squeeze Intensity
    let squeezeIntensity = 0;
    if (area.maxSqueezeState === SqueezeState.HIGH) squeezeIntensity = 3;
    else if (area.maxSqueezeState === SqueezeState.MID) squeezeIntensity = 2;
    else if (area.maxSqueezeState === SqueezeState.LOW) squeezeIntensity = 1;

    // 2. Phase Oscillator Value (Normalized by Upper Band)
    const phaseVal = momentum[currentIndex];
    const phaseBand = phaseUpper[currentIndex];
    const normalizedPhase = phaseBand !== 0 ? phaseVal / phaseBand : 0;

    // 3. Phase Slope
    const phaseSlope = momentum[currentIndex] - momentum[currentIndex - 1];

    // 4. FVG Features
    // Simple heuristic: check if we are in a gap
    let fvgSize = 0;
    let fvgDirection = 0;
    let fvgDistance = 0;
    
    // Check last 3 candles for gaps
    for (let i = 0; i < 3; i++) {
        const idx = currentIndex - i;
        if (idx < 2) continue;
        const c = candles[idx];
        const cPrev2 = candles[idx - 2];
        
        if (c.low > cPrev2.high) { // Bull Gap
            fvgSize = (c.low - cPrev2.high) / c.close;
            fvgDirection = 1;
            fvgDistance = (c.close - (c.low + cPrev2.high) / 2) / c.close;
            break;
        } else if (c.high < cPrev2.low) { // Bear Gap
            fvgSize = (cPrev2.low - c.high) / c.close;
            fvgDirection = -1;
            fvgDistance = ((c.high + cPrev2.low) / 2 - c.close) / c.close;
            break;
        }
    }

    // 5. Imbalance Stack (from footprint if available)
    let imbalanceStack = 0;
    if (candle.footprint) {
        // Mock logic: count consecutive imbalances
        // In real implementation, parse footprint data
        const delta = Object.values(candle.footprint).reduce((acc, l) => acc + l.delta, 0);
        imbalanceStack = Math.abs(delta) > 100 ? 1 : 0; // Simplified
    }

    // 6. Volume-Delta Confluence
    const isBullish = candle.close > candle.open;
    const delta = area.deltaAccumulated;
    const deltaConfluence = (isBullish && delta > 0) || (!isBullish && delta < 0) ? 1 : 0;

    // 7. Market Structure (HH/HL)
    // Check last 5 pivots
    let marketStructure = 0; // 1 = Bullish, -1 = Bearish
    const lookback = 20;
    const highs = candles.slice(currentIndex - lookback, currentIndex).map(c => c.high);
    const lows = candles.slice(currentIndex - lookback, currentIndex).map(c => c.low);
    const maxH = Math.max(...highs);
    const minL = Math.min(...lows);
    
    if (candle.close > maxH) marketStructure = 1;
    else if (candle.close < minL) marketStructure = -1;

    // 8. Relative Position inside Swing
    const swingRange = area.top - area.bottom;
    const relativePosition = swingRange > 0 ? (candle.close - area.bottom) / swingRange : 0.5;

    // 9. Session Time
    const date = new Date(candle.time);
    const sessionHour = date.getUTCHours();

    // 10. Volatility Regime
    // Calculate ATR of last 20
    const trs = [];
    for (let i = 0; i < 20; i++) {
        const idx = currentIndex - i;
        if (idx < 1) break;
        const c = candles[idx];
        const prev = candles[idx - 1];
        const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
        trs.push(tr);
    }
    const atr = trs.reduce((a, b) => a + b, 0) / (trs.length || 1);
    const volatilityRegime = atr / candle.close;

    // 11. Pre-Box Trend
    // Slope of momentum right before the box started
    let preBoxTrend = 0;
    const startIdx = area.startIndex;
    if (startIdx > 2) {
        preBoxTrend = momentum[startIdx] - momentum[startIdx - 2];
    }

    // 12. Box Compression (Tightness)
    // Variance of closes inside the box normalized by box height
    let boxCompression = 0;
    const boxCandles = candles.slice(area.startIndex, currentIndex);
    if (boxCandles.length > 2 && swingRange > 0) {
        const closes = boxCandles.map(c => c.close);
        const meanClose = closes.reduce((a, b) => a + b, 0) / closes.length;
        const variance = closes.reduce((a, b) => a + Math.pow(b - meanClose, 2), 0) / closes.length;
        boxCompression = Math.sqrt(variance) / swingRange;
    }

    // 13. POI Crosses & Fakeouts
    let poiCrosses = 0;
    let fakeoutCount = 0;
    const poi = area.interestLevel || (area.top + area.bottom) / 2;
    
    for (const c of boxCandles) {
        // Crosses POI
        if (c.low < poi && c.high > poi) poiCrosses++;
        
        // Fakeouts (Close inside box, but wick pierced outside)
        if (c.high > area.top && c.close <= area.top) fakeoutCount++;
        if (c.low < area.bottom && c.close >= area.bottom) fakeoutCount++;
    }

    const features = [
        squeezeIntensity,
        normalizedPhase,
        phaseSlope,
        fvgSize,
        fvgDirection,
        fvgDistance,
        imbalanceStack,
        deltaConfluence,
        marketStructure,
        relativePosition,
        sessionHour,
        volatilityRegime,
        preBoxTrend,
        boxCompression,
        poiCrosses,
        fakeoutCount
    ];

    // Sanitize features: replace NaN/Infinity with 0
    return features.map(f => {
        if (!Number.isFinite(f)) return 0;
        return f;
    });
}
