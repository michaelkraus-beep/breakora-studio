import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Candle } from '../types/market';
import { AdaptivePhaseSqueezerEngine } from '../lib/AdaptivePhaseSqueezerEngine';
import { AdaptivePhaseSqueezerConfig, SqueezeState } from '../types/squeezer';

const DEFAULT_CONFIG: AdaptivePhaseSqueezerConfig = {
  preset: 'Standard Mode',
  sqzLen: 20, bbMult: 2.0, kcMultHigh: 1.0, kcMultMid: 1.5, kcMultLow: 2.0,
  showPhases: true, phaseLen: 50, phaseMult: 1.0,
  showBoxes: true, boxTriggerMode: SqueezeState.MID, minDotSequence: 2,
  showInterestLine: true, calcMode: 'Gap Induced', boxFallback: 'Use Box Midpoint', dynamicLineColor: true,
  showZeroLag: true, zlagSource: 'Wicks',
  enableML: false, learningRate: 0.1, minConfidenceThreshold: 65,
  autoRetrainDays: 0
};

const PRESETS: Record<string, Partial<AdaptivePhaseSqueezerConfig>> = {
  'Standard Mode': {
    enableML: false, boxTriggerMode: SqueezeState.MID, calcMode: 'Gap Induced', showZeroLag: true
  },
  'Machine Learning Mode': {
    enableML: true, minConfidenceThreshold: 65, boxTriggerMode: SqueezeState.LOW, autoRetrainDays: 7
  }
};

export function useAdaptivePhaseSqueezer(candles: Candle[], symbol: string, interval: string) {
  const [config, setConfig] = useState<AdaptivePhaseSqueezerConfig>(DEFAULT_CONFIG);
  const engineRef = useRef<AdaptivePhaseSqueezerEngine | null>(null);
  const [mlStatus, setMlStatus] = useState<string>('Ready');

  // Lazy initialization
  if (!engineRef.current) {
      engineRef.current = new AdaptivePhaseSqueezerEngine(config, symbol, interval);
  }

  // Update engine when config changes
  useEffect(() => {
    if (engineRef.current) {
        engineRef.current.updateConfig(config);
    }
  }, [config, symbol, interval]);

  // Auto-retrain logic
  useEffect(() => {
      if (config.enableML && config.autoRetrainDays > 0) {
          const lastTrain = config.lastTrainingDate ? new Date(config.lastTrainingDate).getTime() : 0;
          const now = Date.now();
          const daysSince = (now - lastTrain) / (1000 * 60 * 60 * 24);
          
          if (daysSince > config.autoRetrainDays) {
              handleForceRetrain();
          }
      }
  }, [config.enableML, config.autoRetrainDays, config.lastTrainingDate]);

  const result = useMemo(() => {
    return engineRef.current ? engineRef.current.process(candles) : { oscillatorData: [], swingAreas: [], currentPhase: 0, currentConfidence: 0 };
  }, [candles, config]);

  const updateConfig = useCallback((newConfig: Partial<AdaptivePhaseSqueezerConfig>) => {
    setConfig(prev => {
      let merged = { ...prev, ...newConfig };
      // Apply preset if changed
      if (newConfig.preset && newConfig.preset !== prev.preset) {
        merged = { ...merged, ...PRESETS[newConfig.preset] };
      }
      return merged;
    });
  }, []);

  const handleForceRetrain = useCallback(async () => {
      if (!engineRef.current) return;
      
      setMlStatus('Loading DB data...');
      try {
          // Load ALL persisted training samples from the backend DB for this symbol/interval.
          // The in-memory trainingBuffer is cleared on every process() call so we cannot
          // rely on it — the DB is the canonical source of truth.
          const res = await fetch(`/api/ml/data?symbol=${engineRef.current['symbol']}&interval=${engineRef.current['interval']}`);
          if (!res.ok) throw new Error(`DB fetch failed: ${res.status}`);
          const dbData = await res.json();
          
          const features: number[][] = dbData.features ?? [];
          const labels: number[] = dbData.labels ?? [];
          
          if (features.length < 10) {
              setMlStatus(`Not enough samples in DB (${features.length}/10 required)`);
              return;
          }
          
          setMlStatus(`Training on ${features.length} samples...`);
          await engineRef.current.trainModelLocal(features, labels);
          
          const now = new Date().toISOString();
          setConfig(prev => ({ ...prev, lastTrainingDate: now }));
          setMlStatus(`Trained ${now.split('T')[0]} (${features.length} samples)`);
      } catch (e: any) {
          console.error('Retrain failed:', e);
          setMlStatus(`Retrain failed: ${e.message}`);
      }
  }, []);

  const squeezerValue = useMemo(() => ({
    config,
    setConfig: updateConfig,
    forceRetrain: handleForceRetrain,
    mlStatus,
    ...result
  }), [config, updateConfig, handleForceRetrain, mlStatus, result]);

  return squeezerValue;
}
