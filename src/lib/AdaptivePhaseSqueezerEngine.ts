import { Candle } from '../types/market';
import { calculateSMA, calculateStdev, calculateTR, calculateHighest, calculateLowest, calculateLinReg } from './indicators';
import { AdaptivePhaseSqueezerConfig, MarketPhase, SqueezeState, SwingArea, SqueezerDataPoint, AdaptiveSqueezerResult } from '../types/squeezer';
import * as tf from '@tensorflow/tfjs';
import { extractFeatures } from './ml-features';

export class AdaptivePhaseSqueezerEngine {
  private config: AdaptivePhaseSqueezerConfig;
  private model: tf.LayersModel | null = null;
  private isModelLoading = false;
  private trainingBuffer: { features: number[], label: number }[] = [];
  private isTraining = false;
  private persistedBoxIds: Set<string> = new Set();

  private symbol: string;
  private interval: string;

  constructor(config: AdaptivePhaseSqueezerConfig, symbol: string, interval: string) {
    this.config = config;
    this.symbol = symbol || 'btcusdt';
    this.interval = interval || '1m';
    this.initModel();
  }

  public updateConfig(newConfig: Partial<AdaptivePhaseSqueezerConfig>) {
    this.config = { ...this.config, ...newConfig };
    if (this.config.enableML && !this.model && !this.isModelLoading) {
        this.initModel();
    }
  }

  private async initModel() {
      if (this.isModelLoading) return;
      this.isModelLoading = true;
      try {
          // Fetch historical data from persistent SQLite DB
          const statusRes = await fetch(`/api/ml/status?symbol=${this.symbol}&interval=${this.interval}`);
          const status = await statusRes.json();
          
          // Create a new Sequential model since we are training client-side
          const newModel = tf.sequential();
          newModel.add(tf.layers.dense({ units: 32, activation: 'relu', inputShape: [16] })); // 16 features now
          newModel.add(tf.layers.dropout({ rate: 0.2 }));
          newModel.add(tf.layers.dense({ units: 16, activation: 'relu' }));
          newModel.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
          newModel.compile({ optimizer: 'adam', loss: 'binaryCrossentropy', metrics: ['accuracy'] });
          this.model = newModel;

          if (status.modelExists && status.trainingSamples > 0) {
              console.log(`Found ${status.trainingSamples} historical ML samples for ${this.symbol} [${this.interval}] in DB. Fetching...`);
              const dataRes = await fetch(`/api/ml/data?symbol=${this.symbol}&interval=${this.interval}`);
              const dbData = await dataRes.json();
              
              if (dbData.features && dbData.features.length > 0) {
                  await this.trainModelLocal(dbData.features, dbData.labels);
              }
          } else {
              console.log('No historical ML data found in DB, starting fresh.');
          }
      } catch (e) {
          console.warn('Failed to initialize ML model', e);
      } finally {
          this.isModelLoading = false;
      }
  }

  public async trainModelLocal(features: number[][], labels: number[]) {
      if (!this.model || features.length === 0 || this.isTraining) return;
      this.isTraining = true;
      try {
          const xs = tf.tensor2d(features);
          const ys = tf.tensor2d(labels.map(l => l > 0 ? 1 : 0), [labels.length, 1]);

          await this.model.fit(xs, ys, {
              epochs: 10,
              batchSize: 32,
              shuffle: true,
              verbose: 0
          });
          
          xs.dispose();
          ys.dispose();
          console.log(`Locally trained model on ${features.length} samples.`);
      } catch (e) {
          console.error('Failed to train local model', e);
      } finally {
          this.isTraining = false;
      }
  }

  public async persistSqueezeResolution(features: number[], label: number) {
      this.trainingBuffer.push({ features, label });
      
      try {
          // Save to backend database for permanent memory
          await fetch('/api/ml/data', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                  symbol: this.symbol, 
                  interval: this.interval,
                  timestamp: Date.now(),
                  features: features, 
                  label: label 
              })
          });
          
          // Also incrementally train the live model in memory
          await this.trainModelLocal([features], [label]);
      } catch (e) {
          console.error('Failed to sync squeeze resolution to backend', e);
      }
  }

  public process(candles: Candle[]): AdaptiveSqueezerResult {
    this.trainingBuffer = []; // Clear buffer to prevent memory leak on re-renders
    
    if (candles.length < Math.max(this.config.sqzLen, this.config.phaseLen)) {
      return { oscillatorData: [], swingAreas: [], currentPhase: MarketPhase.ACCUMULATION, currentConfidence: 0 };
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const trs = calculateTR(highs, lows, closes);

    // 1. Squeeze Engine Calculations
    const bbBasis = calculateSMA(closes, this.config.sqzLen);
    const bbDev = calculateStdev(closes, this.config.sqzLen).map(v => v * this.config.bbMult);
    const bbUpper = bbBasis.map((b, i) => b + bbDev[i]);
    const bbLower = bbBasis.map((b, i) => b - bbDev[i]);

    const kcBasis = calculateSMA(closes, this.config.sqzLen);
    const kcDev = calculateSMA(trs, this.config.sqzLen);

    // 2. Momentum Calculation
    const highestHighs = calculateHighest(highs, this.config.sqzLen);
    const lowestLows = calculateLowest(lows, this.config.sqzLen);
    const momentumInput = closes.map((c, i) => {
      if (i < this.config.sqzLen) return 0;
      const avgVal = (highestHighs[i] + lowestLows[i]) / 2;
      return c - ((avgVal + bbBasis[i]) / 2);
    });
    const momentum = calculateLinReg(momentumInput, this.config.sqzLen).map(v => isNaN(v) ? 0 : v);

    // ML Auto-Tuning (Dynamic Phase Length) - Simplified for now to focus on Confidence
    let currentPhaseLen = this.config.phaseLen;
    let currentPhaseMult = this.config.phaseMult;
    
    // 3. Phase Tunnel
    const momStdev = calculateStdev(momentum, currentPhaseLen);
    const phaseUpper = momStdev.map(v => v * currentPhaseMult);
    const phaseLower = momStdev.map(v => -v * currentPhaseMult);

    const oscillatorData: SqueezerDataPoint[] = new Array(candles.length).fill(null).map((_, i) => ({
      time: candles[i].time,
      momentum: NaN,
      phaseUpper: NaN,
      phaseLower: NaN,
      squeezeState: SqueezeState.NONE,
      marketPhase: MarketPhase.ACCUMULATION,
      zeroLagLevel: null,
      interestLevel: null
    }));

    const swingAreas: SwingArea[] = [];
    let activeArea: SwingArea | null = null;
    let streak = 0;
    let zlagLevel: number | null = null;

    const inferenceQueue: { features: number[], area: SwingArea }[] = [];

    for (let i = this.config.phaseLen; i < candles.length; i++) {
      const c = candles[i];
      
      // Determine Squeeze State
      const kcUH = kcBasis[i] + kcDev[i] * this.config.kcMultHigh;
      const kcLH = kcBasis[i] - kcDev[i] * this.config.kcMultHigh;
      const kcUM = kcBasis[i] + kcDev[i] * this.config.kcMultMid;
      const kcLM = kcBasis[i] - kcDev[i] * this.config.kcMultMid;
      const kcUL = kcBasis[i] + kcDev[i] * this.config.kcMultLow;
      const kcLL = kcBasis[i] - kcDev[i] * this.config.kcMultLow;

      let state = SqueezeState.NONE;
      // HIGH Squeeze = BB is inside the NARROWEST Keltner channel
      if (bbLower[i] >= kcLL && bbUpper[i] <= kcUL) state = SqueezeState.HIGH;
      // MID Squeeze = BB is inside the MIDDLE Keltner channel
      else if (bbLower[i] >= kcLM && bbUpper[i] <= kcUM) state = SqueezeState.MID;
      // LOW Squeeze = BB is inside the WIDEST Keltner channel
      else if (bbLower[i] >= kcLH && bbUpper[i] <= kcUH) state = SqueezeState.LOW;

      // Determine Market Phase
      let phase = MarketPhase.ACCUMULATION;
      if (momentum[i] > phaseUpper[i] || momentum[i] < phaseLower[i]) {
        phase = MarketPhase.TRENDING;
        if (i > 0 && Math.abs(momentum[i]) < Math.abs(momentum[i-1]) && c.close > candles[i-1].close) {
            phase = MarketPhase.DISTRIBUTION;
        }
      }

      // Zero-Lag FVG Tracker
      if (i >= 2) {
        const zH = c.high;
        const zL = c.low;
        const prev2H = candles[i-2].high;
        const prev2L = candles[i-2].low;

        if (zL > prev2H) zlagLevel = (zL + prev2H) / 2; // Bull Gap
        else if (zH < prev2L) zlagLevel = (zH + prev2L) / 2; // Bear Gap
      }

      // Structure Box Logic
      let triggerActive = false;
      if (this.config.boxTriggerMode === SqueezeState.HIGH) {
          triggerActive = (state === SqueezeState.HIGH);
      } else if (this.config.boxTriggerMode === SqueezeState.MID) {
          triggerActive = (state === SqueezeState.MID || state === SqueezeState.HIGH);
      } else {
          triggerActive = (state !== SqueezeState.NONE);
      }

      // Pre-flight Gap Option Check
      if (triggerActive && this.config.requireGapInLastXCandles && this.config.requireGapInLastXCandles > 0) {
          let gapFound = false;
          // Look backwards `x` candles from current candle `i` to find a zero-lag FVG
          // A FVG at index `checkIdx` is true if it gaps over candle `checkIdx-2`
          for (let k = 0; k < this.config.requireGapInLastXCandles; k++) {
              const checkIdx = i - k;
              if (checkIdx >= 2) {
                  const currHigh = candles[checkIdx].high;
                  const currLow = candles[checkIdx].low;
                  const prev2High = candles[checkIdx - 2].high;
                  const prev2Low = candles[checkIdx - 2].low;
                  if (currLow > prev2High || currHigh < prev2Low) {
                      gapFound = true;
                      break;
                  }
              }
          }
          if (!gapFound) triggerActive = false;
      }

      if (triggerActive) streak++; else streak = 0;

      if (streak === this.config.minDotSequence) {
        // Start Box
        let boxH = c.high, boxL = c.low;
        for (let j = 0; j < this.config.minDotSequence; j++) {
          boxH = Math.max(boxH, candles[i-j].high);
          boxL = Math.min(boxL, candles[i-j].low);
        }
        activeArea = {
          id: `sqz_${c.time}`,
          startIndex: i - this.config.minDotSequence + 1,
          endIndex: null,
          startTime: candles[i - this.config.minDotSequence + 1].time,
          endTime: null,
          top: boxH,
          bottom: boxL,
          phase: MarketPhase.ACCUMULATION,
          maxSqueezeState: state,
          confidence: 0,
          interestLevel: this.config.calcMode === 'Box Midpoint' ? (boxH + boxL) / 2 : null,
          isFired: false,
          isFallback: !this.config.enableML || !this.model,
          volumeAccumulated: 0,
          deltaAccumulated: 0
        };
        swingAreas.push(activeArea);
      } else if (streak > this.config.minDotSequence && activeArea) {
        // Update Box
        activeArea.top = Math.max(activeArea.top, c.high);
        activeArea.bottom = Math.min(activeArea.bottom, c.low);
        activeArea.volumeAccumulated += c.volume;
        
        if (c.footprint) {
            let delta = 0;
            Object.values(c.footprint).forEach(l => delta += l.delta);
            activeArea.deltaAccumulated += delta;
        }

        if (state === SqueezeState.HIGH) activeArea.maxSqueezeState = SqueezeState.HIGH;

        if (this.config.calcMode === 'Gap Induced' && i >= 2) {
           if (c.low > candles[i-2].high) activeArea.interestLevel = (c.low + candles[i-2].high) / 2;
           else if (c.high < candles[i-2].low) activeArea.interestLevel = (c.high + candles[i-2].low) / 2;
        } else if (this.config.calcMode === 'Box Midpoint') {
           activeArea.interestLevel = (activeArea.top + activeArea.bottom) / 2;
        }

        // ML Confidence Scoring (Batch Queue)
        // Only queue for inference if it's the last candle (real-time update)
        if (this.config.enableML && this.model && i === candles.length - 1) {
            try {
                const features = extractFeatures(activeArea, candles, momentum, phaseUpper, phaseLower, i);
                inferenceQueue.push({ features, area: activeArea });
            } catch (e) {
                console.warn('Feature extraction failed', e);
            }
            activeArea.isFallback = false;
        } else if (!this.config.enableML || !this.model) {
            activeArea.confidence = 100; 
            activeArea.isFallback = true;
        }

      } else if (streak === 0 && activeArea && !activeArea.isFired) {
        // End Box / Fire
        activeArea.endIndex = i;
        activeArea.endTime = c.time;
        activeArea.isFired = true;
        activeArea.phase = MarketPhase.TRENDING;
        
        if (this.config.calcMode === 'Gap Induced' && !activeArea.interestLevel && i >= 2) {
           if (c.low > candles[i-2].high) activeArea.interestLevel = (c.low + candles[i-2].high) / 2;
           else if (c.high < candles[i-2].low) activeArea.interestLevel = (c.high + candles[i-2].low) / 2;
        }

        if (this.config.calcMode === 'Gap Induced' && !activeArea.interestLevel && this.config.boxFallback === 'Use Box Midpoint') {
            activeArea.interestLevel = (activeArea.top + activeArea.bottom) / 2;
        }

        // ML Confidence Scoring for Historical Boxes
        if (this.config.enableML && this.model) {
            try {
                const features = extractFeatures(activeArea, candles, momentum, phaseUpper, phaseLower, i);
                inferenceQueue.push({ features, area: activeArea });
            } catch (e) {
                console.warn('Feature extraction failed', e);
            }
            activeArea.isFallback = false;
        } else if (!this.config.enableML || !this.model) {
            activeArea.confidence = 100;
            activeArea.isFallback = true;
        }

        // Collect Training Data
        if (i > activeArea.startIndex + 5) {
            // Use 'i' (current index, which is the breakout/end candle) for feature extraction
            const features = extractFeatures(activeArea, candles, momentum, phaseUpper, phaseLower, i); 
            
            // Label: Did it hit target in the PREDICTED direction?
            const boxHeight = activeArea.top - activeArea.bottom;
            const targetPrice = activeArea.interestLevel || (activeArea.top + activeArea.bottom) / 2;
            const predictedDirection = activeArea.deltaAccumulated >= 0 ? 1 : -1;
            
            // Check next 20 candles for success
            let success = 0; // 0 for fail
            for(let k=1; k<=20 && i+k < candles.length; k++) {
                const futureC = candles[i+k];
                if (!futureC || isNaN(futureC.close)) continue;
                
                const move = futureC.close - targetPrice;

                // Min success move requirement combining box height multiple and dynamic percentage
                const requiredMoveDistance = Math.max(
                     boxHeight * 1.5, 
                     this.config.minSuccessPercentBreakout && this.config.minSuccessPercentBreakout > 0 
                         ? targetPrice * (this.config.minSuccessPercentBreakout / 100) 
                         : 0
                );

                // Success if move is in predicted direction and exceeds required distance
                if (predictedDirection === 1 && move > requiredMoveDistance) {
                    success = 1; // Bull success
                    break;
                } else if (predictedDirection === -1 && move < -requiredMoveDistance) {
                    success = 1; // Bear success (standardized to 1 for binary classification)
                    break;
                }

                // Stop checking if it breaks significantly in the wrong direction (Invalidation)
                if (predictedDirection === 1 && move < -boxHeight * 0.75) break; // Failed
                if (predictedDirection === -1 && move > boxHeight * 0.75) break; // Failed
            }
            
            // Do not block rendering, fire async memory persistence only once per unique box ID
            if (!this.persistedBoxIds.has(activeArea.id)) {
                this.persistedBoxIds.add(activeArea.id);
                this.persistSqueezeResolution(features, success);
            }
        }

        activeArea = null;
      }

      oscillatorData[i] = {
        time: c.time,
        momentum: momentum[i],
        phaseUpper: phaseUpper[i],
        phaseLower: phaseLower[i],
        squeezeState: state,
        marketPhase: phase,
        zeroLagLevel: zlagLevel,
        interestLevel: activeArea?.interestLevel || null
      };
    }

    // Run Batch Inference
    if (inferenceQueue.length > 0 && this.model) {
        try {
            tf.tidy(() => {
                const features = inferenceQueue.map(q => q.features);
                const input = tf.tensor2d(features);
                const predictions = this.model!.predict(input) as tf.Tensor;
                const scores = predictions.dataSync();
                
                scores.forEach((score, idx) => {
                    inferenceQueue[idx].area.confidence = Math.round(score * 100);
                });
            });
        } catch (e) {
            console.error('Batch inference failed', e);
        }
    }

    return {
      oscillatorData,
      swingAreas: this.config.enableML 
          ? swingAreas.filter(a => a.confidence >= this.config.minConfidenceThreshold)
          : swingAreas,
      currentPhase: oscillatorData[oscillatorData.length - 1]?.marketPhase || MarketPhase.ACCUMULATION,
      currentConfidence: activeArea?.confidence || 0
    };
  }
  
  public getTrainingData() {
      return this.trainingBuffer;
  }
  
  public clearTrainingData() {
      this.trainingBuffer = [];
  }
}
