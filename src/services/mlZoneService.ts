import * as tf from '@tensorflow/tfjs';
import { Candle } from '../types/market';

export interface Zone {
    top: number;
    bottom: number;
    volume: number;
    strength: number;
    touches: number;
    holdRate: number;      // fraction of times zone was touched and held (not broken)
    firstDetected: number;
    startIdx: number;
    type: 'SUPPORT' | 'RESISTANCE';
    mlScore?: number;
    mergedCount?: number;
    heuristicScore?: number;
}

const MODEL_NAME = 'sr-zone-model-v2';

// ─────────────────────────────────────────────────────────────────────
// Swing pivot detection
// ─────────────────────────────────────────────────────────────────────
function findPivots(candles: Candle[], swing: number = 5): { idx: number; price: number; type: 'high' | 'low' }[] {
    const pivots: { idx: number; price: number; type: 'high' | 'low' }[] = [];
    for (let i = swing; i < candles.length - swing; i++) {
        const c = candles[i];
        if (isNaN(c.high) || isNaN(c.low)) continue;

        // Swing high: highest in [i-swing..i+swing]
        let isHigh = true;
        let isLow = true;
        for (let j = i - swing; j <= i + swing; j++) {
            if (j === i) continue;
            const o = candles[j];
            if (isNaN(o.high) || isNaN(o.low)) continue;
            if (o.high >= c.high) isHigh = false;
            if (o.low  <= c.low)  isLow  = false;
        }
        if (isHigh) pivots.push({ idx: i, price: c.high, type: 'high' });
        if (isLow)  pivots.push({ idx: i, price: c.low,  type: 'low'  });
    }
    return pivots;
}

// ─────────────────────────────────────────────────────────────────────
// Cluster pivots that are within `tolerance` of each other
// ─────────────────────────────────────────────────────────────────────
function clusterPivots(
    pivots: { idx: number; price: number; type: 'high' | 'low' }[],
    candles: Candle[],
    tolerance: number
): Zone[] {
    const zones: Zone[] = [];

    // Separate highs and lows
    const highs = pivots.filter(p => p.type === 'high').sort((a, b) => a.price - b.price);
    const lows  = pivots.filter(p => p.type === 'low' ).sort((a, b) => a.price - b.price);

    const buildClusters = (points: typeof highs, zoneType: 'RESISTANCE' | 'SUPPORT') => {
        let i = 0;
        while (i < points.length) {
            const cluster = [points[i]];
            let j = i + 1;
            while (j < points.length && (points[j].price - points[j-1].price) <= tolerance) {
                cluster.push(points[j]);
                j++;
            }
            if (cluster.length >= 1) {
                const minP = cluster[0].price;
                const maxP = cluster[cluster.length - 1].price;
                const halfWidth = Math.max((maxP - minP) / 2, tolerance / 2);
                const midP = (minP + maxP) / 2;
                const top    = midP + halfWidth;
                const bottom = midP - halfWidth;

                // Calculate zone metrics from candle history
                let vol = 0;
                let touches = 0;
                let holds = 0;
                const firstIdx = Math.min(...cluster.map(p => p.idx));
                const avgVol = candles.reduce((s, c) => s + c.volume, 0) / candles.length || 1;

                for (let k = firstIdx; k < candles.length; k++) {
                    const c = candles[k];
                    if (isNaN(c.high) || isNaN(c.low)) continue;
                    if (c.high >= bottom && c.low <= top) {
                        touches++;
                        vol += c.volume;
                        // Check if price held (didn't close beyond zone within next 5 candles)
                        let broke = false;
                        for (let m = k + 1; m < Math.min(k + 6, candles.length); m++) {
                            const fc = candles[m];
                            if (zoneType === 'RESISTANCE' && fc.close > top) { broke = true; break; }
                            if (zoneType === 'SUPPORT'    && fc.close < bottom) { broke = true; break; }
                        }
                        if (!broke) holds++;
                    }
                }

                const holdRate = touches > 0 ? holds / touches : 0;
                // Heuristic score: many touches, high hold rate, recent, tight cluster
                const recencyBonus = firstIdx > candles.length * 0.5 ? 1.2 : 1.0;
                const heuristicScore = Math.min(1, (
                    (Math.min(touches, 10) / 10) * 0.4 +
                    holdRate * 0.4 +
                    Math.min(vol / (avgVol * touches || 1), 2) / 2 * 0.2
                ) * recencyBonus);

                if (touches >= 1) {
                    zones.push({
                        top, bottom,
                        type: zoneType,
                        volume: vol,
                        strength: vol / (avgVol || 1),
                        touches,
                        holdRate,
                        firstDetected: candles[firstIdx]?.time ?? 0,
                        startIdx: firstIdx,
                        heuristicScore,
                        mlScore: heuristicScore  // use heuristic until ML is trained
                    });
                }
            }
            i = j;
        }
    };

    buildClusters(highs, 'RESISTANCE');
    buildClusters(lows,  'SUPPORT');
    return zones;
}

// ─────────────────────────────────────────────────────────────────────
// Feature extraction for ML (7 features)
// ─────────────────────────────────────────────────────────────────────
function extractFeatures(zone: Zone, candles: Candle[], currentIdx: number): number[] {
    const avgVol = candles.slice(Math.max(0, currentIdx - 200), currentIdx + 1)
        .reduce((s, c) => s + c.volume, 0) / Math.min(200, currentIdx + 1) || 1;

    const zoneWidth = zone.top - zone.bottom;
    const zoneMid   = (zone.top + zone.bottom) / 2;
    const recentCandles = candles.slice(Math.max(0, currentIdx - 100), currentIdx + 1)
        .filter(c => !isNaN(c.high) && !isNaN(c.low));
    const recentHigh = recentCandles.length > 0 ? Math.max(...recentCandles.map(c => c.high)) : zoneMid;
    const recentLow  = recentCandles.length > 0 ? Math.min(...recentCandles.map(c => c.low))  : zoneMid;
    const range = Math.max(recentHigh - recentLow, 0.0001);

    return [
        Math.min(zone.touches, 20) / 20,                           // 0: normalized touch count
        isNaN(zone.holdRate) ? 0.5 : zone.holdRate,               // 1: hold rate
        Math.min(zone.volume / (avgVol * 10), 1),                  // 2: relative volume
        Math.max(0, Math.min((zoneMid - recentLow) / range, 1)),   // 3: relative position in range
        Math.min(zoneWidth / range, 1),                            // 4: zone tightness (smaller=better)
        (zone.startIdx / Math.max(candles.length, 1)),             // 5: recency (later=newer=higher)
        isNaN(zone.heuristicScore ?? 0) ? 0 : (zone.heuristicScore ?? 0) // 6: heuristic baseline
    ];
}

// ─────────────────────────────────────────────────────────────────────
// Detect S/R zones from candle history
// ─────────────────────────────────────────────────────────────────────
export function detectZones(candles: Candle[], swingPeriod: number = 5): Zone[] {
    if (candles.length < swingPeriod * 2 + 2) return [];

    const valid = candles.filter(c => !isNaN(c.high) && !isNaN(c.low) && c.low > 0);
    if (valid.length < 20) return [];

    const priceRange = Math.max(...valid.map(c => c.high)) - Math.min(...valid.map(c => c.low));
    const tolerance  = priceRange * 0.008; // 0.8% tolerance for clustering

    const pivots = findPivots(candles, swingPeriod);
    const zones  = clusterPivots(pivots, candles, tolerance);

    // Sort by heuristic score desc, return top 30 candidates
    return zones.sort((a, b) => (b.heuristicScore ?? 0) - (a.heuristicScore ?? 0)).slice(0, 30);
}

// ─────────────────────────────────────────────────────────────────────
// ML Service
// ─────────────────────────────────────────────────────────────────────
export class MLZoneService {
    private model: tf.LayersModel | null = null;
    private isTraining = false;

    private createModel(): tf.Sequential {
        const m = tf.sequential();
        m.add(tf.layers.dense({ units: 24, activation: 'relu', inputShape: [7] }));
        m.add(tf.layers.dropout({ rate: 0.2 }));
        m.add(tf.layers.dense({ units: 12, activation: 'relu' }));
        m.add(tf.layers.dense({ units: 1,  activation: 'sigmoid' }));
        m.compile({ optimizer: 'adam', loss: 'binaryCrossentropy', metrics: ['accuracy'] });
        return m;
    }

    async loadModels(symbol: string) {
        try {
            this.model = await tf.loadLayersModel(`indexeddb://${MODEL_NAME}-${symbol}`);
            this.model.compile({ optimizer: 'adam', loss: 'binaryCrossentropy', metrics: ['accuracy'] });
            console.log(`[SRZone] Loaded trained model for ${symbol}`);
        } catch {
            console.log(`[SRZone] No saved model for ${symbol}, will use heuristics until trained.`);
            this.model = this.createModel();
        }
    }

    async saveModels(symbol: string) {
        if (this.model) {
            await this.model.save(`indexeddb://${MODEL_NAME}-${symbol}`);
            console.log(`[SRZone] Model saved for ${symbol}`);
        }
    }

    /**
     * Score zones using the ML model.
     * Falls back to heuristic score if model is fresh (random weights ≈ useless).
     * After at least 10 training samples, ML scores replace heuristics.
     */
    predictRelevance(zones: Zone[], candles: Candle[], modelIsTrained: boolean): Zone[] {
        if (!this.model || zones.length === 0) return zones;

        if (!modelIsTrained) {
            // Return heuristic scores so zones always show before training
            return zones.map(z => ({ ...z, mlScore: z.heuristicScore ?? 0 }));
        }

        try {
            const features = zones.map(z => extractFeatures(z, candles, candles.length - 1));
            const input = tf.tensor2d(features);
            const output = this.model.predict(input) as tf.Tensor;
            const scores = Array.from(output.dataSync());
            input.dispose();
            output.dispose();

            return zones.map((z, i) => ({ ...z, mlScore: scores[i] }));
        } catch (e) {
            console.warn('[SRZone] Prediction failed, using heuristic scores', e);
            return zones.map(z => ({ ...z, mlScore: z.heuristicScore ?? 0 }));
        }
    }

    /**
     * Train on historical data.
     * For each historically detected zone, look 20 candles ahead and label:
     *   1 = zone was tested and held
     *   0 = zone was tested and broken (or not tested)
     */
    async train(symbol: string, candles: Candle[], _rawZones: Zone[]): Promise<{ trained: boolean; sampleSize: number }> {
        if (this.isTraining || !this.model) return { trained: false, sampleSize: 0 };
        this.isTraining = true;

        try {
            // Detect historical zones on rolling 300-candle windows
            const inputs: number[][] = [];
            const labels: number[] = [];
            const step = 50;
            const windowSize = 300;

            for (let start = 0; start + windowSize + 20 < candles.length; start += step) {
                const window = candles.slice(start, start + windowSize);
                const historicalZones = detectZones(window, 5).slice(0, 15);

                for (const z of historicalZones) {
                    const absIdx = start + z.startIdx;
                    const checkFrom = absIdx + 5;
                    if (checkFrom + 20 >= candles.length) continue;

                    // Re-index to full candle array
                    const globalZone: Zone = { ...z, startIdx: absIdx };
                    const features = extractFeatures(globalZone, candles, checkFrom);
                    if (features.some(f => isNaN(f) || !isFinite(f))) continue;

                    // Label: did price test and hold the zone in next 20 candles?
                    let tested = false;
                    let broke  = false;
                    for (let k = checkFrom; k < checkFrom + 20; k++) {
                        const c = candles[k];
                        if (!c || isNaN(c.high) || isNaN(c.low)) continue;
                        if (c.high >= z.bottom && c.low <= z.top) {
                            tested = true;
                            // Did it close beyond the zone right away?
                            if (z.type === 'RESISTANCE' && c.close > z.top * 1.002) { broke = true; break; }
                            if (z.type === 'SUPPORT'    && c.close < z.bottom * 0.998) { broke = true; break; }
                        }
                    }

                    const label = tested && !broke ? 1 : 0;
                    inputs.push(features);
                    labels.push(label);
                }
            }

            if (inputs.length >= 10) {
                const xs = tf.tensor2d(inputs);
                const ys = tf.tensor2d(labels.map(l => [l]));
                await this.model.fit(xs, ys, { epochs: 15, batchSize: 32, shuffle: true, verbose: 0 });
                xs.dispose();
                ys.dispose();
                await this.saveModels(symbol);
                this.isTraining = false;
                return { trained: true, sampleSize: inputs.length };
            }

            this.isTraining = false;
            return { trained: false, sampleSize: inputs.length };
        } catch (e) {
            console.error('[SRZone] Training failed:', e);
            this.isTraining = false;
            return { trained: false, sampleSize: 0 };
        }
    }
}

export const mlZoneService = new MLZoneService();
