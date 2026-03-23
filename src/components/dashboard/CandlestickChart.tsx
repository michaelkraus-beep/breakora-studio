import React, { Component, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Candle } from '../../types/market';
import { Maximize2, Minimize2, Grid, Settings, Info, Zap, Plus, Minus, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, RotateCcw, Ruler, PenTool, Trash2, Palette, MoreHorizontal, MousePointer2, BarChartHorizontal, Check, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAdaptivePhaseSqueezer } from '../../hooks/useAdaptivePhaseSqueezer';
import { mlZoneService, detectZones, Zone as MLZone } from '../../services/mlZoneService';
import { SqueezeState } from '../../types/squeezer';
import { PhaseSqueezerOscillatorPane } from './PhaseSqueezerOscillatorPane';
import { VolumeFootOscillatorPane } from './VolumeFootOscillatorPane';

class ErrorBoundary extends React.Component<any, {hasError: boolean}> {
  state = { hasError: false };
  props: any;

  constructor(props: any) {
    super(props);
    this.props = props;
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Oscillator Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <div className="h-[100px] w-full flex items-center justify-center text-red-500 text-xs bg-red-950/20">Oscillator Error</div>;
    }

    return this.props.children;
  }
}

interface CandlestickChartProps {
  data: Candle[];
  width?: number;
  height?: number;
  symbol?: string;
  onFetchMoreHistory?: (startTime?: number) => Promise<void>;
  isLoadingHistory?: boolean;
  tickSize?: number;
  instanceId?: string;
  showSettings?: boolean;
  onToggleSettings?: () => void;
  overrideSettings?: Partial<any>; 
  simplified?: boolean;
}

type DrawingTool = 'none' | 'measure_rect' | 'draw_line' | 'horizontal_volume_bars';
type DrawingType = 'rect' | 'line' | 'vol_bar_rect';
interface DrawingPoint { time: number; price: number; }
interface Drawing {
    id: string;
    type: DrawingType;
    points: DrawingPoint[];
    style: {
        color: string;
        lineWidth: number;
        lineType: 'solid' | 'dashed';
    };
    volBarSettings?: {
        numBars: number; // Vertical resolution
        direction: 'ltr' | 'rtl'; // Left-to-right or Right-to-left
        showVA?: boolean;
        showVAHighBeam?: boolean;
        showVALowBeam?: boolean;
        showPOCBeam?: boolean;
        showLVNBeam?: boolean;
        maxLVNs?: number;
    };
}

const ZoneToggleIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M6 12l6-4.5 6 4.5-6 4.5z" />
    <rect x="11" y="11" width="2" height="2" fill="currentColor" stroke="none" />
  </svg>
);

function distanceToSegment(p: {x: number, y: number}, v: {x: number, y: number}, w: {x: number, y: number}) {
  const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}

export function CandlestickChart({ 
  data, 
  width = 800, 
  height = 400, 
  symbol = 'Unknown',
  onFetchMoreHistory,
  isLoadingHistory,
  tickSize = 0.01,
  instanceId = 'default',
  showSettings = false,
  onToggleSettings,
  overrideSettings,
  simplified = false
}: CandlestickChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [footprintStyle, setFootprintStyle] = useState<'overlay' | 'side' | 'footprint-only'>('overlay');
  const [showZoneInfo, setShowZoneInfo] = useState(false);
  const [showFootprintInfo, setShowFootprintInfo] = useState(false);
  const [hoveredZone, setHoveredZone] = useState<any>(null);
  const [hoveredFootprint, setHoveredFootprint] = useState<any>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [currentTime, setCurrentTime] = useState(Date.now());
  // Drawing Tools State
  const [activeTool, setActiveTool] = useState<DrawingTool>('none');
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [drawingState, setDrawingState] = useState<'idle' | 'drawing' | 'dragging'>('idle');
  const [currentDrawingPoints, setCurrentDrawingPoints] = useState<DrawingPoint[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<{ type: 'point' | 'body' | 'resize', index?: number, xIndex?: number | null, yIndex?: number | null } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, drawingId: string } | null>(null);
  const [lineSettings, setLineSettings] = useState({ color: '#3b82f6', lineWidth: 2, lineType: 'solid' as 'solid' | 'dashed' });

  // Load drawings
  useEffect(() => {
      try {
          const saved = localStorage.getItem(`chart_drawings_${symbol}`);
          if (saved) {
              setDrawings(JSON.parse(saved));
          } else {
              setDrawings([]);
          }
      } catch (e) { console.error("Failed to load drawings", e); }
  }, [symbol]);

  // Save drawings
  useEffect(() => {
      if (symbol) {
          localStorage.setItem(`chart_drawings_${symbol}`, JSON.stringify(drawings));
      }
  }, [drawings, symbol]);

  // Zoom and Pan State
  const [visibleCount, setVisibleCount] = useState(100);
  const [scrollOffset, setScrollOffset] = useState(0); // Number of candles scrolled back from the end
  const [isDragging, setIsDragging] = useState(false);
  const [lastMouseX, setLastMouseX] = useState(0);
  
  // Vertical Zoom and Pan State
  const [priceZoom, setPriceZoom] = useState(1);
  const [pricePan, setPricePan] = useState(0);
  const [isDraggingPrice, setIsDraggingPrice] = useState(false);
  const [lastMouseY, setLastMouseY] = useState(0);

  // Adaptive Phase Squeezer
  // Calculate an approximate interval if one isn't passed down natively (Data shape typically has resolution)
  const timeInterval = data.length > 1 ? data[1].time - data[0].time : 60000;
  const intervalStr = timeInterval >= 86400000 ? '1d' : timeInterval >= 3600000 ? `${timeInterval/3600000}h` : `${timeInterval/60000}m`;
  
  const squeezer = useAdaptivePhaseSqueezer(data, symbol, intervalStr);
  const [showOscillator, setShowOscillator] = useState(true);
  const [showOscillatorMenu, setShowOscillatorMenu] = useState(false);

  // Timer for countdown
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // State Ref for Event Handlers (avoids stale closures without re-binding listeners)
  const stateRef = useRef({ 
      visibleCount, 
      scrollOffset, 
      priceZoom, 
      pricePan, 
      dataLength: data.length,
      dimensions: { width: 800, height: 400 }
  });

  useEffect(() => {
      stateRef.current = { 
          visibleCount, 
          scrollOffset, 
          priceZoom, 
          pricePan, 
          dataLength: data.length,
          dimensions: stateRef.current.dimensions
      };
  }, [visibleCount, scrollOffset, priceZoom, pricePan, data.length]);

  // Ensure scrollOffset stays within bounds when data changes
  useEffect(() => {
      // console.log(`Chart data updated: ${data.length} candles`);
      setScrollOffset(prev => {
          const maxScroll = Math.max(0, data.length - visibleCount);
          return Math.min(prev, maxScroll);
      });
  }, [data.length, visibleCount]);

  // Reset zoom and pan on symbol change
  useEffect(() => {
    setPriceZoom(1);
    setPricePan(0);
    setScrollOffset(0);
    // If simplified (scanner mode), maybe use a different default visible count?
    if (simplified) {
        setVisibleCount(60); 
    }
  }, [symbol, simplified]);

  // Settings State
  const [settings, setSettings] = useState(() => {
    const defaultSettings = {
      // Analysis Period
      lookbackType: 'Candles' as 'Candles' | 'Minutes' | 'Hours' | 'Since Open',
      lookbackValue: 233, // Default for Candles
      sinceOpenRegion: 'US_OPEN' as 'US_OPEN' | 'EU_OPEN' | 'ASIA_OPEN',
      
      // Absorption Zones
      absorptionEnabled: true,
      absorptionVolMult: 3.0,
      absorptionCount: 5,
      
      // Imbalance Zones
      imbalanceEnabled: true,
      imbalanceMinSize: 0.5, // Multiplier of Avg Body
      imbalanceCount: 5,
      positionImbalanceMode: 'both' as 'none' | 'markersOnly' | 'overlayOnly' | 'both',

      // Persistent Zones
      persistentZonesEnabled: false,
      zoneDrawFromDetection: true,   // draw zones from their detection point forward (false = full width)
      persistentVolMult: 4.0,
      persistentMinTouches: 1,
      
      // ML Settings
      mlMode: false,
      mlThreshold: 0.68,
      autoMerge: true,
      autoRetrainDays: 0, // 0 = Off
      lastRetrainDate: 0,

      // Footprint Aggregation
      chartFootprintTicksPerRow: 64,
      tapeFootprintTicksPerRow: 2,
      showFootprintsOnChart: false,
      autoAggregation: true,

      // Oscillator Selection
      selectedOscillator: 'phase' as 'phase' | 'supplydemand',

      // Volume Foot Oscillator Settings
      footOscMode: 'strongestStack' as 'strongestStack' | 'totalDelta',
      showNetDeltaLine: true,
      minStackRatio: 3.0,
      normalizeMode: false,
      barOpacity: 65,
      showFootOscTooltips: true,

      // Horizontal Volume Bars
      volBarsNumBars: 0, // 0 = Auto (1 bar per candle)
      volBarsDirection: 'ltr' as 'ltr' | 'rtl',
      visibleRangeVolumeProfile: false,
      visibleRangeVolumeProfileOpacity: 65,
      visibleRangeVPNumBins: 100,
      visibleRangeVPShowVA: false,
      visibleRangeVPShowVAHigh: false,
      visibleRangeVPShowVALow: false,
      visibleRangeVPShowPOC: false,
      visibleRangeVPShowLVN: false,
      visibleRangeVPMaxLVNs: 3,
      visibleRangeVPMinLVNDepth: 0.1,
    };
    
    const settingsKey = instanceId === 'default' ? 'chartSettings' : `chartSettings_${instanceId}`;
    try {
      const saved = localStorage.getItem(settingsKey);
      if (saved) {
        return { ...defaultSettings, ...JSON.parse(saved) };
      }
    } catch (e) {}
    
    return defaultSettings;
  });

  // Effective settings merged with overrides
  const effectiveSettings = useMemo(() => ({ ...settings, ...overrideSettings }), [settings, overrideSettings]);

  const updateSettings = (newSettings: Partial<typeof settings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      const settingsKey = instanceId === 'default' ? 'chartSettings' : `chartSettings_${instanceId}`;
      localStorage.setItem(settingsKey, JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent('chartSettingsChanged', { detail: { settings: updated, instanceId } }));
      return updated;
    });
  };

  const [absorptionZones, setAbsorptionZones] = useState<{top: number, bottom: number, volume: number, strength: number, startIdx: number}[]>([]);
  const [imbalanceZones, setImbalanceZones] = useState<{top: number, bottom: number, type: 'SUPPLY' | 'DEMAND', volume: number, strength: number}[]>([]);
  const [persistentZones, setPersistentZones] = useState<MLZone[]>([]);
  const rawZonesRef = useRef<MLZone[]>([]);
  const [mlModelTrained, setMlModelTrained] = useState(false);
  const [mlStatus, setMlStatus] = useState<string>("Model not loaded");
  const [marketStats, setMarketStats] = useState({ avgVol: 0, avgBody: 0 });
  
  const scaleRef = useRef({ 
      minPrice: 0, maxPrice: 0, priceRange: 0, height: 0, padding: 0, globalMinTick: 0.01, pricePan: 0,
      startIdx: 0, slotWidth: 0, chartWidth: 0, chartHeight: 0
  });

  // Calculation Logic for Zones
  useEffect(() => {
    if (data.length === 0) return;

    // ... (existing startIdx logic) ...
    // 1. Determine Analysis Start Index
    let startIdx = 0;
    const now = new Date();
    const latestCandleTime = data[data.length - 1]?.time || now.getTime();

    if (settings.lookbackType === 'Candles') {
        startIdx = Math.max(0, data.length - settings.lookbackValue);
    } else if (settings.lookbackType === 'Minutes') {
        const cutoff = latestCandleTime - (settings.lookbackValue * 60 * 1000);
        startIdx = data.findIndex(c => c.time >= cutoff);
        if (startIdx === -1) startIdx = 0;
    } else if (settings.lookbackType === 'Hours') {
        const cutoff = latestCandleTime - (settings.lookbackValue * 60 * 60 * 1000);
        startIdx = data.findIndex(c => c.time >= cutoff);
        if (startIdx === -1) startIdx = 0;
    } else if (settings.lookbackType === 'Since Open') {
        const currentYear = new Date(latestCandleTime).getUTCFullYear();
        const currentMonth = new Date(latestCandleTime).getUTCMonth();
        const currentDate = new Date(latestCandleTime).getUTCDate();
        
        let hour = 0;
        let minute = 0;
        
        if (settings.sinceOpenRegion === 'US_OPEN') { hour = 13; minute = 30; }
        else if (settings.sinceOpenRegion === 'EU_OPEN') { hour = 7; minute = 0; }
        else if (settings.sinceOpenRegion === 'ASIA_OPEN') { hour = 0; minute = 0; }
        
        let openTime = Date.UTC(currentYear, currentMonth, currentDate, hour, minute);
        if (openTime > latestCandleTime) {
            openTime -= 24 * 60 * 60 * 1000;
        }
        
        startIdx = data.findIndex(c => c.time >= openTime);
        if (startIdx === -1) startIdx = 0;
    }

    const analysisData = data.slice(startIdx);
    
    if (analysisData.length < 10) {
        setAbsorptionZones([]);
        setImbalanceZones([]);
        setMarketStats({ avgVol: 0, avgBody: 0 });
        return;
    }

    const avgVol = analysisData.reduce((sum, d) => sum + d.volume, 0) / analysisData.length;
    const avgBody = analysisData.reduce((sum, d) => sum + Math.abs(d.close - d.open), 0) / analysisData.length;
    
    setMarketStats({ avgVol, avgBody });

    // --- Absorption Logic ---
    if (settings.absorptionEnabled) {
        const minP = Math.min(...analysisData.map(d => d.low));
        const maxP = Math.max(...analysisData.map(d => d.high));
        const range = maxP - minP;
        const binSize = range / 50 || 1; 

        const bins: { [key: number]: number } = {};
        
        analysisData.forEach(d => {
            const body = Math.abs(d.close - d.open);
            // Condition: Volume > Threshold AND Body < Avg (High effort, low movement)
            if (d.volume > avgVol * settings.absorptionVolMult && body < avgBody * 1.0) {
                const mid = (d.high + d.low) / 2;
                const binKey = Math.floor(mid / binSize) * binSize;
                bins[binKey] = (bins[binKey] || 0) + d.volume;
            }
        });
        
        const topZones = Object.entries(bins)
            .map(([price, vol]) => ({ price: parseFloat(price), vol }))
            .sort((a, b) => b.vol - a.vol)
            .slice(0, settings.absorptionCount)
            .map(b => {
                // Find the candle index with peak volume in this bin for "draw from detection"
                let bestIdx = startIdx;
                let bestVol = -1;
                analysisData.forEach((d, idx) => {
                    const body = Math.abs(d.close - d.open);
                    if (d.volume > avgVol * settings.absorptionVolMult && body < avgBody * 1.0) {
                        const mid = (d.high + d.low) / 2;
                        const binKey = Math.floor(mid / binSize) * binSize;
                        if (Math.abs(binKey - b.price) < 0.001 && d.volume > bestVol) {
                            bestVol = d.volume;
                            bestIdx = startIdx + idx;
                        }
                    }
                });
                return {
                    top: b.price + binSize,
                    bottom: b.price,
                    volume: b.vol,
                    strength: b.vol / avgVol,
                    startIdx: bestIdx
                };
            });
            
        setAbsorptionZones(topZones);
    } else {
        setAbsorptionZones([]);
    }

    // --- Imbalance Logic ---
    if (settings.imbalanceEnabled) {
        const fvgs: {top: number, bottom: number, type: 'SUPPLY' | 'DEMAND', startIdx: number, size: number, volume: number, strength: number}[] = [];
        
        // We need context before startIdx for FVG calculation (i-2)
        // So we iterate through analysisData but map indices back to main data
        for (let i = Math.max(2, startIdx); i < data.length - 1; i++) {
            const curr = data[i];
            const prev = data[i-1]; // Displacement candle
            const prev2 = data[i-2];
            
            // Bullish FVG (Demand)
            if (prev2.high < curr.low) {
                const gapSize = curr.low - prev2.high;
                if (gapSize > avgBody * settings.imbalanceMinSize) {
                    fvgs.push({
                        top: curr.low,
                        bottom: prev2.high,
                        type: 'DEMAND',
                        startIdx: i,
                        size: gapSize,
                        volume: prev.volume, // Volume of the displacement candle
                        strength: gapSize / avgBody
                    });
                }
            }
            
            // Bearish FVG (Supply)
            if (prev2.low > curr.high) {
                const gapSize = prev2.low - curr.high;
                if (gapSize > avgBody * settings.imbalanceMinSize) {
                    fvgs.push({
                        top: prev2.low,
                        bottom: curr.high,
                        type: 'SUPPLY',
                        startIdx: i,
                        size: gapSize,
                        volume: prev.volume, // Volume of the displacement candle
                        strength: gapSize / avgBody
                    });
                }
            }
        }
        
        // Check mitigation
        let activeFvgs = fvgs.filter(fvg => {
            for (let j = fvg.startIdx + 1; j < data.length; j++) {
                const c = data[j];
                if (fvg.type === 'DEMAND') {
                    if (c.low < fvg.bottom) return false; 
                } else {
                    if (c.high > fvg.top) return false;
                }
            }
            return true;
        });
        
        activeFvgs = activeFvgs.sort((a, b) => b.size - a.size).slice(0, settings.imbalanceCount);
        setImbalanceZones(activeFvgs);
    } else {
        setImbalanceZones([]);
    }

    // --- Persistent Support/Resistance Logic ---
    if (settings.persistentZonesEnabled) {
        // Use pivot-based swing detection — robust across all timeframes
        // `analysisData` is already filtered to the lookback window. We use a swing
        // period proportional to the number of candles so it adapts automatically.
        const swingPeriod = Math.max(3, Math.round(analysisData.length / 50));
        const pZones = detectZones(analysisData, swingPeriod);

        // Re-map startIdx to be relative to the full data array (analysisData starts at startIdx)
        const globalZones = pZones.map(z => ({
            ...z,
            startIdx: z.startIdx + startIdx,
            firstDetected: data[Math.min(z.startIdx + startIdx, data.length - 1)]?.time ?? z.firstDetected
        }));

        rawZonesRef.current = globalZones;

        if (settings.mlMode) {
            const processML = async () => {
                // Score using ML model (falls back to heuristic if not yet trained)
                const scored = mlZoneService.predictRelevance(globalZones, data, mlModelTrained);
                // Filter by threshold, keep at most 12 best zones
                const threshold = (settings as any).mlThreshold ?? 0.35;
                const filtered = scored
                    .filter(z => (z.mlScore ?? 0) >= threshold)
                    .sort((a, b) => (b.mlScore ?? 0) - (a.mlScore ?? 0))
                    .slice(0, 12);
                setPersistentZones(filtered);
            };
            processML();
        } else {
            // Non-ML mode: show top 12 by heuristic score (always works without training)
            setPersistentZones(
                globalZones
                    .sort((a, b) => (b.heuristicScore ?? 0) - (a.heuristicScore ?? 0))
                    .slice(0, 12)
            );
        }
    } else {
        setPersistentZones([]);
    }

  }, [data, effectiveSettings]);

  // Load ML Models
  useEffect(() => {
    if (symbol) {
        mlZoneService.loadModels(symbol).then(() => {
            setMlStatus('Model loaded');
            // If model was loaded from indexedDB, it has been trained before
            setMlModelTrained(true);
        }).catch(() => {
            setMlStatus('No saved model — using heuristics');
            setMlModelTrained(false);
        });
    }
  }, [symbol]);

  // Auto-Retrain Logic
  useEffect(() => {
    if (settings.autoRetrainDays > 0 && data.length > 0) {
        const now = Date.now();
        const lastRetrain = settings.lastRetrainDate || 0;
        const daysSince = (now - lastRetrain) / (1000 * 60 * 60 * 24);
        
        if (daysSince >= settings.autoRetrainDays) {
            setMlStatus('Auto-retraining...');
            mlZoneService.train(symbol || 'UNKNOWN', data, rawZonesRef.current).then((res) => {
                if (res?.trained) {
                    setMlModelTrained(true);
                    setMlStatus(`Auto-retrained on ${res.sampleSize} samples`);
                    updateSettings({ lastRetrainDate: now });
                } else {
                    setMlStatus(`Need more data (${res?.sampleSize ?? 0} samples)`);
                }
            });
        }
    }
  }, [settings.autoRetrainDays, settings.lastRetrainDate, data.length, symbol]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      
      // Only update state if dimensions actually changed significantly
      setDimensions(prev => {
          if (Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1) {
              return prev;
          }
          const newDims = { width, height };
          stateRef.current.dimensions = newDims;
          return newDims;
      });
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Native Wheel Listener for Trackpad Pinch-to-Zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const isOverPriceAxis = mouseX > rect.width - 60;
      
      const { visibleCount, scrollOffset, priceZoom, pricePan, dataLength, dimensions } = stateRef.current;
      const chartWidth = dimensions.width - 60;
      const chartHeight = dimensions.height - 20; // Approx chart height minus axis
      
      // 1. Horizontal Panning (Two-finger swipe X)
      // Check if deltaX is dominant and no Ctrl key (pinch)
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) {
          const moveAmount = Math.sign(e.deltaX) * Math.max(1, Math.round(visibleCount * 0.01)); 
          
          setScrollOffset(prev => {
              const next = prev - moveAmount; 
              const maxScroll = Math.max(0, dataLength - visibleCount);
              return Math.min(Math.max(next, 0), maxScroll);
          });
          return;
      }

      // 2. Vertical Price Zoom (Ctrl + Wheel OR Pinch OR Over Price Axis)
      if (e.ctrlKey || isOverPriceAxis) {
          // Calculate zoom direction
          // deltaY > 0 means scrolling down (zoom out), deltaY < 0 means scrolling up (zoom in)
          const zoomFactor = 1.1;
          const direction = e.deltaY > 0 ? 1/zoomFactor : zoomFactor;
          
          const newZoom = Math.min(Math.max(priceZoom * direction, 0.1), 50);
          
          // Fixed Point Zoom for Price
          // We want the price under the cursor to remain at the same Y position
          // Price at Cursor = CenterPrice + (0.5 - Y/H) * Range
          // CenterPrice = (Max + Min)/2 + Pan
          
          // Let's use the scaleRef for the current rendered state to get the exact price under cursor
          const { minPrice, maxPrice, priceRange, pricePan: scalePan } = scaleRef.current as any;
          
          // If we don't have valid scale data, just zoom
          if (!priceRange) {
              setPriceZoom(newZoom);
              return;
          }
          
          // Current price under mouse
          const priceAtCursor = minPrice + (priceRange * (1 - mouseY / chartHeight));
          
          // We want to find newPan such that:
          // priceAtCursor = newMin + (newRange * (1 - mouseY / chartHeight))
          // where newRange = baseRange / newZoom
          // and newMin = (baseCenter + newPan) - newRange/2
          
          // It's easier to work with the Center Price shift
          // Old: Center = (Max+Min)/2
          // New: NewCenter
          // priceAtCursor - NewCenter = (0.5 - Y/H) * NewRange
          // NewCenter = priceAtCursor - (0.5 - Y/H) * NewRange
          
          // Calculate Base Range (unzoomed range)
          const currentBaseRange = priceRange * priceZoom;
          const newRange = currentBaseRange / newZoom;
          
          const newCenter = priceAtCursor - (newRange * (0.5 - mouseY / chartHeight));
          
          // We need to find the Pan relative to the "natural" center of the visible candles
          // But we don't have the natural center easily available here without iterating candles.
          // However, we know: CurrentCenter = NaturalCenter + CurrentPan
          // So NaturalCenter = CurrentCenter - CurrentPan
          
          const currentCenter = (maxPrice + minPrice) / 2;
          // Use the pan value that matches the current rendered scale to find the natural center
          const effectivePan = scalePan ?? pricePan;
          const naturalCenter = currentCenter - effectivePan;
          
          const newPan = newCenter - naturalCenter;
          
          setPriceZoom(newZoom);
          setPricePan(newPan);
          return;
      }

      // 3. Horizontal Time Zoom (Vertical Scroll)
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          const zoomFactor = 1.1;
          const direction = e.deltaY > 0 ? 1 : -1; // deltaY > 0 (scroll down) -> Zoom Out (increase count)
          
          const newVisibleCount = Math.round(visibleCount * (direction > 0 ? zoomFactor : 1/zoomFactor));
          const clampedVisibleCount = Math.min(Math.max(newVisibleCount, 5), 500);
          
          if (clampedVisibleCount === visibleCount) return;

          // Fixed Point Zoom for Time
          // We want the candle under the cursor to remain at the same X position
          // Cursor Ratio = mouseX / chartWidth
          // Old Start Index (from right) = scrollOffset
          // Old End Index (from right) = scrollOffset + visibleCount
          // Index at Cursor (from right) = scrollOffset + visibleCount * (1 - CursorRatio)
          
          const cursorRatio = mouseX / chartWidth;
          const cursorIndexFromRight = scrollOffset + visibleCount * (1 - cursorRatio);
          
          // New equation:
          // newScrollOffset + newVisibleCount * (1 - CursorRatio) = cursorIndexFromRight
          // newScrollOffset = cursorIndexFromRight - newVisibleCount * (1 - CursorRatio)
          
          const newScrollOffset = Math.round(cursorIndexFromRight - clampedVisibleCount * (1 - cursorRatio));
          
          // Clamp scroll offset
          const maxScroll = Math.max(0, dataLength - clampedVisibleCount);
          const clampedScrollOffset = Math.min(Math.max(newScrollOffset, 0), maxScroll);
          
          setVisibleCount(clampedVisibleCount);
          setScrollOffset(clampedScrollOffset);
      }
    };

    container.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleNativeWheel);
  }, []);

  const [dimensions, setDimensions] = useState({ width: 800, height: 400 });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle High DPI
    const dpr = window.devicePixelRatio || 1;
    const w = dimensions.width;
    const h = dimensions.height;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      if (data.length === 0) {
        ctx.fillStyle = '#52525b';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Loading chart data...', w / 2, h / 2);
        return;
      }

      const validData = data.filter(c => 
          !isNaN(c.low) && !isNaN(c.high) && c.low > 0 && c.high > 0
      );

      // Calculate visible range
      const effectiveVisibleCount = visibleCount;
      const endIdx = validData.length - scrollOffset;
      const startIdx = Math.max(0, endIdx - effectiveVisibleCount);
      const visibleCandles = validData.slice(startIdx, endIdx);
      
      if (visibleCandles.length === 0) return;

      let minPrice = Math.min(...visibleCandles.map(c => c.low));
      let maxPrice = Math.max(...visibleCandles.map(c => c.high));
      
      // Safety Guard: Fallback if price calculation fails
      if (!isFinite(minPrice) || !isFinite(maxPrice) || isNaN(minPrice) || isNaN(maxPrice)) {
          minPrice = 0;
          maxPrice = 100;
      }
      
      let priceRange = maxPrice - minPrice;
      
      // Prevent extremely tall candles when there is very little price action or few candles
      const minReasonableRange = maxPrice * 0.001; // 0.1% of price
      if (priceRange < minReasonableRange) {
          const center = (maxPrice + minPrice) / 2;
          minPrice = center - minReasonableRange / 2;
          maxPrice = center + minReasonableRange / 2;
          priceRange = minReasonableRange;
      }
      
      // Apply vertical zoom and pan
      const centerPrice = (maxPrice + minPrice) / 2 + pricePan;
      priceRange = priceRange / priceZoom;
      minPrice = centerPrice - priceRange / 2;
      maxPrice = centerPrice + priceRange / 2;
      
      const padding = priceRange * 0.1;
      const xAxisHeight = 20;
      const chartHeight = h - xAxisHeight;
      
      // Calculate global tick size for consistent footprint row heights
      // Safety check: clamp tick size to avoid massive blocks if tickSize is wrong (e.g. 0.01 for SHIB)
      const globalMinTick = Math.min(tickSize, priceRange / 20);
      
      const labelWidth = 60;
      const rightBuffer = labelWidth;
      const chartWidth = w - rightBuffer;
      const availableWidth = Math.max(chartWidth - 10, 10);
      const slotWidth = availableWidth / effectiveVisibleCount;

      scaleRef.current = { 
          minPrice, maxPrice, priceRange, height: chartHeight, padding, globalMinTick, pricePan,
          startIdx, slotWidth, chartWidth, chartHeight
      };
      
      const globalTickHeightInPixels = (globalMinTick / (priceRange + 2 * padding)) * chartHeight;
      const globalRowH = Math.max(globalTickHeightInPixels, 1);
      
      const priceToY = (price: number) => {
        return chartHeight - ((price - (minPrice - padding)) / (priceRange + 2 * padding)) * chartHeight;
      };
      
      const timeToX = (time: number) => {
          let idx = -1;
          if (data.length > 0) {
             if (time < data[0].time) idx = -1; 
             else if (time > data[data.length-1].time) idx = data.length; 
             else {
                 let l = 0, r = data.length - 1;
                 while (l <= r) {
                     const m = Math.floor((l + r) / 2);
                     if (data[m].time === time) { idx = m; break; }
                     else if (data[m].time < time) l = m + 1;
                     else r = m - 1;
                 }
                 if (idx === -1) idx = l; 
             }
          }
          if (idx === -1) return -100; 
          return (idx - startIdx) * slotWidth + slotWidth / 2;
      };

      // Helper to draw drawings
      const renderDrawing = (d: Drawing, isSelected: boolean) => {
          if (d.points.length < 1) return;
          
          const p1 = d.points[0];
          const x1 = timeToX(p1.time);
          const y1 = priceToY(p1.price);
          
          if (d.type === 'line') {
              if (d.points.length < 2) {
                  ctx.beginPath();
                  ctx.arc(x1, y1, 4, 0, Math.PI * 2);
                  ctx.fillStyle = d.style.color;
                  ctx.fill();
                  return;
              }
              const p2 = d.points[1];
              const x2 = timeToX(p2.time);
              const y2 = priceToY(p2.price);
              
              ctx.save();
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
              ctx.strokeStyle = d.style.color;
              ctx.lineWidth = d.style.lineWidth + (isSelected ? 1 : 0);
              if (d.style.lineType === 'dashed') ctx.setLineDash([5, 5]);
              else ctx.setLineDash([]);
              
              if (isSelected) {
                  ctx.shadowColor = d.style.color;
                  ctx.shadowBlur = 10;
              }
              
              ctx.stroke();
              ctx.restore();
              
              if (isSelected) {
                  ctx.fillStyle = '#fff';
                  ctx.strokeStyle = '#3b82f6';
                  ctx.lineWidth = 2;
                  [ [x1, y1], [x2, y2] ].forEach(([x, y]) => {
                      ctx.beginPath();
                      ctx.arc(x, y, 5, 0, Math.PI * 2);
                      ctx.fill();
                      ctx.stroke();
                  });
              }
          } else if (d.type === 'rect' || d.type === 'vol_bar_rect') {
              if (d.points.length < 2) return;
              const p2 = d.points[1];
              const x2 = timeToX(p2.time);
              const y2 = priceToY(p2.price);
              
              const rx = Math.min(x1, x2);
              const ry = Math.min(y1, y2);
              const rw = Math.abs(x2 - x1);
              const rh = Math.abs(y2 - y1);
              
              if (d.type === 'vol_bar_rect') {
                  // Dotted border at 50% opacity
                  ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
                  ctx.lineWidth = 1;
                  ctx.setLineDash([4, 4]);
                  ctx.strokeRect(rx, ry, rw, rh);
                  ctx.setLineDash([]);

                  // Volume Bars Logic
                  const startTime = Math.min(p1.time, p2.time);
                  const endTime = Math.max(p1.time, p2.time);
                  
                  // Find candles in range
                  const candlesInRange = data.filter(c => c.time >= startTime && c.time <= endTime);
                  
                  if (candlesInRange.length > 0) {
                      const direction = d.volBarSettings?.direction || 'ltr';
                      const showVA = d.volBarSettings?.showVA;
                      const showVAHighBeam = d.volBarSettings?.showVAHighBeam;
                      const showVALowBeam = d.volBarSettings?.showVALowBeam;
                      const showPOCBeam = d.volBarSettings?.showPOCBeam;
                      const showLVNBeam = d.volBarSettings?.showLVNBeam;

                      const topPrice = Math.max(p1.price, p2.price);
                      const bottomPrice = Math.min(p1.price, p2.price);
                      const priceRange = topPrice - bottomPrice;
                      
                      // Determine bin size (e.g., 100 bins or based on tickSize)
                      // Use a fixed number of bins for visual clarity, or tickSize if zoomed in
                      const numBins = d.volBarSettings?.numBars || 50;
                      const binSize = priceRange / numBins;
                      
                      // Initialize bins
                      const bins = new Array(numBins).fill(0).map(() => ({ buyVol: 0, sellVol: 0, totalVol: 0 }));
                      
                      candlesInRange.forEach(c => {
                          if (c.footprint) {
                              Object.values(c.footprint).forEach(l => {
                                  if (l.price >= bottomPrice && l.price <= topPrice) {
                                      const binIdx = Math.min(numBins - 1, Math.floor((l.price - bottomPrice) / binSize));
                                      bins[binIdx].buyVol += l.buyVolume;
                                      bins[binIdx].sellVol += l.sellVolume;
                                      bins[binIdx].totalVol += l.buyVolume + l.sellVolume;
                                  }
                              });
                          } else {
                              // Distribute volume uniformly across candle range
                              const cHigh = Math.min(c.high, topPrice);
                              const cLow = Math.max(c.low, bottomPrice);
                              
                              if (cHigh > cLow) {
                                  const startBin = Math.max(0, Math.floor((cLow - bottomPrice) / binSize));
                                  const endBin = Math.min(numBins - 1, Math.floor((cHigh - bottomPrice) / binSize));
                                  const binsCovered = endBin - startBin + 1;
                                  const volPerBin = c.volume / binsCovered;
                                  
                                  // Estimate buy/sell split based on candle color
                                  const isBullish = c.close >= c.open;
                                  const buyRatio = isBullish ? 0.7 : 0.3;
                                  
                                  for (let i = startBin; i <= endBin; i++) {
                                      bins[i].totalVol += volPerBin;
                                      bins[i].buyVol += volPerBin * buyRatio;
                                      bins[i].sellVol += volPerBin * (1 - buyRatio);
                                  }
                              }
                          }
                      });

                      const maxVol = Math.max(...bins.map(b => b.totalVol));
                      const totalVolumeInRect = bins.reduce((acc, b) => acc + b.totalVol, 0);
                      const barHeight = rh / numBins;

                      // Calculate POC, LVN, VA
                      let pocBinIndex = 0;
                      let maxBinVol = -1;
                      
                      // POC Calculation
                      bins.forEach((b, i) => {
                          if (b.totalVol > maxBinVol) {
                              maxBinVol = b.totalVol;
                              pocBinIndex = i;
                          }
                      });

                      // Multi-Level LVN Detection (Ranked by Valley Depth)
                      const allLvns: { index: number, depth: number }[] = [];
                      const maxLVNs = d.volBarSettings?.maxLVNs || 1;

                      if (bins.length >= 3) {
                          for (let i = 1; i < bins.length - 1; i++) {
                              const curr = bins[i].totalVol;
                              const prev = bins[i - 1].totalVol;
                              const next = bins[i + 1].totalVol;

                              // Local minimum (valley)
                              if (curr < prev && curr < next) {
                                  // Depth Score: How much lower is this bin than its neighbors?
                                  // We use the ratio to neighbors. Higher ratio = deeper valley.
                                  const neighborAvg = (prev + next) / 2;
                                  const valleyDepth = curr === 0 ? neighborAvg : neighborAvg / curr;
                                  
                                  allLvns.push({ index: i, depth: valleyDepth });
                              }
                          }
                      }

                      // Rank by depth and take the top N, with center-bias tie-breaker (matches legacy "perfect" logic)
                      const centerIdx = numBins / 2;
                      const rankedLvns = allLvns
                          .sort((a, b) => {
                              if (Math.abs(b.depth - a.depth) > 0.001) return b.depth - a.depth;
                              return Math.abs(a.index - centerIdx) - Math.abs(b.index - centerIdx);
                          })
                          .slice(0, maxLVNs);

                      // Value Area Calculation (70%)
                      const targetVA = totalVolumeInRect * 0.7;
                      let currentVA = bins[pocBinIndex].totalVol;
                      let vaHighIndex = pocBinIndex;
                      let vaLowIndex = pocBinIndex;

                      while (currentVA < targetVA) {
                          const nextHigh = vaHighIndex < numBins - 1 ? bins[vaHighIndex + 1].totalVol : 0;
                          const nextLow = vaLowIndex > 0 ? bins[vaLowIndex - 1].totalVol : 0;

                          if (nextHigh > nextLow) {
                              vaHighIndex++;
                              currentVA += nextHigh;
                          } else if (nextLow > 0) {
                              vaLowIndex--;
                              currentVA += nextLow;
                          } else if (nextHigh > 0) {
                              vaHighIndex++;
                              currentVA += nextHigh;
                          } else {
                              break;
                          }
                          
                          if (vaHighIndex >= numBins - 1 && vaLowIndex <= 0) break;
                      }

                      // Draw VA Highlight
                      if (showVA) {
                          const topY = ry + rh - (vaHighIndex + 1) * barHeight;
                          const bottomY = ry + rh - (vaLowIndex) * barHeight;
                          const h = bottomY - topY;
                          
                          ctx.fillStyle = 'rgba(45, 212, 191, 0.15)'; // Turquoise 15%
                          ctx.fillRect(rx, topY, rw, h);
                      }

                      // Draw Bars
                      bins.forEach((b, i) => {
                          if (b.totalVol === 0) return;

                          // Y Position (Price-based, so bottom bins are at bottom pixel)
                          // i=0 is bottomPrice (bottom of rect), i=numBins-1 is topPrice (top of rect)
                          // Canvas Y: ry + rh is bottom. ry is top.
                          // y for bin i: ry + rh - (i + 1) * barHeight
                          const y = ry + rh - (i + 1) * barHeight;

                          // Bar Width (90% of max width)
                          const barWidth = (b.totalVol / maxVol) * rw * 0.9;
                          const sellWidth = (b.sellVol / b.totalVol) * barWidth;
                          const buyWidth = (b.buyVol / b.totalVol) * barWidth;

                          if (direction === 'rtl') {
                              // RTL: Base is Right (rx + rw)
                              // Sell goes from Right to Left
                              ctx.fillStyle = '#eab308'; // Yellow (Sell)
                              ctx.fillRect(rx + rw - sellWidth, y, sellWidth, barHeight);
                              
                              // Buy continues from Sell to Left
                              ctx.fillStyle = '#3b82f6'; // Blue (Buy)
                              ctx.fillRect(rx + rw - sellWidth - buyWidth, y, buyWidth, barHeight);
                          } else {
                              // LTR: Base is Left (rx)
                              // Sell goes from Left to Right
                              ctx.fillStyle = '#eab308'; // Yellow (Sell)
                              ctx.fillRect(rx, y, sellWidth, barHeight);
                              
                              // Buy continues from Sell to Right
                              ctx.fillStyle = '#3b82f6'; // Blue (Buy)
                              ctx.fillRect(rx + sellWidth, y, buyWidth, barHeight);
                          }
                      });

                      // Helper to draw beam
                      const drawBeam = (y: number, color: string, dashed: boolean = false, glow: boolean = false) => {
                          const startX = direction === 'ltr' ? rx : rx + rw;
                          const endX = direction === 'ltr' ? dimensions.width : 0; // Chart edge
                          
                          ctx.beginPath();
                          ctx.moveTo(startX, y);
                          ctx.lineTo(endX, y);
                          ctx.strokeStyle = color;
                          ctx.lineWidth = 1;
                          if (dashed) ctx.setLineDash([4, 4]);
                          else ctx.setLineDash([]);
                          
                          if (glow) {
                              ctx.shadowColor = color;
                              ctx.shadowBlur = 4;
                          }
                          ctx.stroke();
                          ctx.shadowBlur = 0;
                          ctx.setLineDash([]);
                      };

                      if (showVAHighBeam) {
                          const y = ry + rh - (vaHighIndex + 1) * barHeight; // Top of highest bin
                          drawBeam(y, '#40C4FF');
                      }
                      if (showVALowBeam) {
                          const y = ry + rh - vaLowIndex * barHeight; // Bottom of lowest bin
                          drawBeam(y, '#AB47BC');
                      }
                      if (showPOCBeam) {
                          const y = ry + rh - (pocBinIndex + 0.5) * barHeight; // Center of POC bin
                          drawBeam(y, '#FFFFFF', false, true);
                      }
                      if (showLVNBeam && rankedLvns.length > 0) {
                          rankedLvns.forEach((lvn, rank) => {
                              const y = ry + rh - (lvn.index + 0.5) * barHeight;
                              // Fade out based on rank
                              const alpha = 1.0 - (rank / maxLVNs) * 0.7;
                              const color = `rgba(161, 161, 170, ${alpha})`;
                              drawBeam(y, color, true);
                          });
                      }
                  }
              } else {
                  // Standard Measure Rect
                  ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
                  ctx.strokeStyle = '#3b82f6';
                  ctx.lineWidth = 1;
                  ctx.setLineDash([]);
                  
                  ctx.fillRect(rx, ry, rw, rh);
                  ctx.strokeRect(rx, ry, rw, rh);
                  
                  const topPrice = Math.max(p1.price, p2.price);
                  const bottomPrice = Math.min(p1.price, p2.price);
                  const change = ((topPrice - bottomPrice) / bottomPrice) * 100;
                  
                  ctx.fillStyle = '#fff';
                  ctx.font = '10px monospace';
                  ctx.textAlign = 'left';
                  ctx.textBaseline = 'bottom';
                  ctx.fillText(`${topPrice.toFixed(2)}`, rx + 5, ry - 2);
                  
                  ctx.textBaseline = 'top';
                  ctx.fillText(`${bottomPrice.toFixed(2)}`, rx + 5, ry + rh + 2);
                  
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.font = 'bold 11px monospace';
                  
                  const text = `${change.toFixed(2)}%`;
                  const textMetrics = ctx.measureText(text);
                  const textWidth = textMetrics.width;
                  const textHeight = 14;
                  const textX = rx + rw/2;
                  const textY = ry + rh/2;

                  // Draw black background for text
                  ctx.fillStyle = '#000000';
                  ctx.fillRect(textX - textWidth/2 - 3, textY - textHeight/2, textWidth + 6, textHeight);

                  ctx.fillStyle = '#3b82f6';
                  ctx.fillText(text, textX, textY);
                  
                  // Width Label
                  const idx1 = data.findIndex(c => c.time === p1.time);
                  const idx2 = data.findIndex(c => c.time === p2.time);
                  if (idx1 !== -1 && idx2 !== -1) {
                      const widthInCandles = Math.abs(idx2 - idx1) + 1;
                      const widthText = `Width: ${widthInCandles} candles`;
                      
                      ctx.font = '10px monospace';
                      const widthMetrics = ctx.measureText(widthText);
                      const widthW = widthMetrics.width;
                      
                      // Draw background for width label
                      ctx.fillStyle = '#000000';
                      ctx.fillRect(textX - widthW/2 - 3, textY + textHeight/2 + 2, widthW + 6, textHeight);
                      
                      ctx.fillStyle = '#3b82f6';
                      ctx.fillText(widthText, textX, textY + textHeight + 2);
                  }
              }
              
              if (isSelected) {
                   ctx.fillStyle = '#fff';
                   ctx.strokeStyle = '#3b82f6';
                   [ [rx, ry], [rx+rw, ry], [rx, ry+rh], [rx+rw, ry+rh] ].forEach(([x, y]) => {
                       ctx.beginPath();
                       ctx.arc(x, y, 4, 0, Math.PI * 2);
                       ctx.fill();
                       ctx.stroke();
                   });
              }
          }
      };



      // Price Scale Background
      ctx.fillStyle = '#18181b';
      ctx.fillRect(chartWidth, 0, rightBuffer, h);
      
      // Timeline Background
      ctx.fillRect(0, chartHeight, w, xAxisHeight);

      // Y-Axis Labels
      const tickCount = 6;
      const step = priceRange / tickCount;
      for (let i = 0; i <= tickCount; i++) {
        const price = minPrice + (step * i);
        const y = priceToY(price);
        
        // Major Tick
        ctx.strokeStyle = '#3f3f46';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(chartWidth, y);
        ctx.lineTo(chartWidth + 6, y);
        ctx.stroke();

        // Minor Ticks (4 between majors)
        if (i < tickCount) {
            const minorStep = step / 5;
            for (let j = 1; j < 5; j++) {
                const minorPrice = price + (minorStep * j);
                const minorY = priceToY(minorPrice);
                ctx.beginPath();
                ctx.moveTo(chartWidth, minorY);
                ctx.lineTo(chartWidth + 3, minorY);
                ctx.stroke();
            }
        }
        
        ctx.fillStyle = '#a1a1aa';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(price.toFixed(2), chartWidth + 8, y);
      }

      // X-Axis Labels (Timeline)
      const xTickCount = 5;
      for (let i = 0; i <= xTickCount; i++) {
        const x = chartWidth * (i / xTickCount);

        // Major Tick
        ctx.strokeStyle = '#3f3f46';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, chartHeight);
        ctx.lineTo(x, chartHeight + 6);
        ctx.stroke();

        // Minor Ticks
        if (i < xTickCount) {
            const minorStep = (chartWidth / xTickCount) / 5;
            for (let j = 1; j < 5; j++) {
                const minorX = x + (minorStep * j);
                ctx.beginPath();
                ctx.moveTo(minorX, chartHeight);
                ctx.lineTo(minorX, chartHeight + 3);
                ctx.stroke();
            }
        }

        // Find candle at this X position to get time
        const candleIdx = Math.floor((i / xTickCount) * visibleCandles.length);
        const candle = visibleCandles[candleIdx];
        if (candle) {
            const date = new Date(candle.time);
            const isNewDay = i > 0 && new Date(visibleCandles[Math.floor(((i-1)/xTickCount)*visibleCandles.length)]?.time).getUTCDate() !== date.getUTCDate();
            
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
            
            ctx.fillStyle = '#a1a1aa';
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(isNewDay ? `${dateStr} ${timeStr}` : timeStr, x, chartHeight + 16);
        }
      }
      
      // Draw Current Price Label with Countdown Flag
      if (visibleCandles.length > 0) {
          const lastCandle = data[data.length - 1];
          const y = priceToY(lastCandle.close);
          
          // Price Label Box
          ctx.fillStyle = lastCandle.close >= lastCandle.open ? '#22c55e' : '#ef4444';
          ctx.fillRect(chartWidth, y - 10, rightBuffer, 20);
          
          // Price Text
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(lastCandle.close.toFixed(2), chartWidth + 8, y);
          
          // Countdown Flag
          // Infer interval from last two candles, default to 1m (60000ms)
          const interval = data.length > 1 ? data[data.length - 1].time - data[data.length - 2].time : 60000;
          const nextClose = lastCandle.time + interval;
          const timeLeft = Math.max(0, nextClose - currentTime);
          
          // Format MM:SS
          const minutes = Math.floor(timeLeft / 60000);
          const seconds = Math.floor((timeLeft % 60000) / 1000);
          const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
          
          // Draw Flag below price label
          const flagY = y + 10; // Just below the price box
          const flagHeight = 14;
          
          // Flag Background (slightly darker than price label)
          ctx.fillStyle = '#18181b'; // Dark background
          ctx.fillRect(chartWidth, flagY, rightBuffer, flagHeight);
          
          // Border to connect it visually
          ctx.strokeStyle = '#3f3f46';
          ctx.lineWidth = 1;
          ctx.strokeRect(chartWidth, flagY, rightBuffer, flagHeight);

          // Countdown Text
          ctx.fillStyle = '#fbbf24'; // Amber/Yellow for visibility
          ctx.font = '10px monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(timeStr, chartWidth + 8, flagY + flagHeight/2);
      }

      // Clip chart area to prevent drawing over axes
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, chartWidth, chartHeight);
      ctx.clip();

      // Helper: given a data index, return the canvas X where that candle starts.
      // If zoneDrawFromDetection=false (full-width mode), returns 0.
      // NOTE: xOffset is declared later in the candle section, so we compute it inline here.
      const zoneStartX = (zIdx: number): number => {
          if (!(settings as any).zoneDrawFromDetection) return 0;
          const localXOffset = (effectiveVisibleCount - visibleCandles.length) * slotWidth;
          const candleX = localXOffset + (zIdx - startIdx) * slotWidth;
          return Math.max(0, Math.min(candleX, chartWidth));
      };

      // Draw Zones
      if (effectiveSettings.absorptionEnabled) {
          absorptionZones.forEach((zone) => {
              if (zone.bottom > maxPrice + padding || zone.top < minPrice - padding) return;
              const yTop = priceToY(zone.top);
              const yBottom = priceToY(zone.bottom);
              const zh = Math.max(Math.abs(yBottom - yTop), 1);
              const sx = zoneStartX(zone.startIdx);
              const zw = chartWidth - sx;
              if (zw <= 0) return; // fully scrolled off screen
              ctx.fillStyle = 'rgba(161, 161, 170, 0.1)';
              ctx.fillRect(sx, yTop, zw, zh);
              ctx.strokeStyle = 'rgba(161, 161, 170, 0.4)';
              ctx.lineWidth = 1;
              ctx.setLineDash([]);
              ctx.beginPath();
              ctx.moveTo(sx, yTop);    ctx.lineTo(chartWidth, yTop);
              ctx.moveTo(sx, yBottom); ctx.lineTo(chartWidth, yBottom);
              ctx.stroke();
          });
      }

      if (effectiveSettings.imbalanceEnabled) {
          imbalanceZones.forEach((zone) => {
              if (zone.bottom > maxPrice + padding || zone.top < minPrice - padding) return;
              const yTop = priceToY(zone.top);
              const yBottom = priceToY(zone.bottom);
              const zh = Math.max(Math.abs(yBottom - yTop), 1);
              const isDemand = zone.type === 'DEMAND';
              const sx = zoneStartX((zone as any).startIdx ?? 0);
              const zw = chartWidth - sx;
              if (zw <= 0) return;
              ctx.fillStyle = isDemand ? 'rgba(34, 211, 238, 0.1)' : 'rgba(168, 85, 247, 0.1)';
              ctx.fillRect(sx, yTop, zw, zh);
              ctx.strokeStyle = isDemand ? 'rgba(34, 211, 238, 0.4)' : 'rgba(168, 85, 247, 0.4)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(sx, yTop);    ctx.lineTo(chartWidth, yTop);
              ctx.moveTo(sx, yBottom); ctx.lineTo(chartWidth, yBottom);
              ctx.stroke();
          });
      }

      if (effectiveSettings.persistentZonesEnabled) {
          persistentZones.forEach((zone) => {
              if (zone.bottom > maxPrice + padding || zone.top < minPrice - padding) return;
              const yTop = priceToY(zone.top);
              const yBottom = priceToY(zone.bottom);
              const zh = Math.max(Math.abs(yBottom - yTop), 1);
              const isRes = zone.type === 'RESISTANCE';
              const sx = zoneStartX(zone.startIdx ?? 0);
              const zw = chartWidth - sx;
              if (zw <= 0) return;
              ctx.fillStyle = isRes ? 'rgba(251, 113, 133, 0.25)' : 'rgba(52, 211, 153, 0.25)';
              ctx.fillRect(sx, yTop, zw, zh);
              ctx.strokeStyle = isRes ? 'rgba(251, 113, 133, 0.8)' : 'rgba(52, 211, 153, 0.8)';
              ctx.lineWidth = 1.5;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(sx, yTop);    ctx.lineTo(chartWidth, yTop);
              ctx.moveTo(sx, yBottom); ctx.lineTo(chartWidth, yBottom);
              ctx.stroke();
              ctx.setLineDash([]);

              // Draw ML Score at right edge
              if (settings.mlMode && zone.mlScore !== undefined) {
                  ctx.font = 'bold 10px sans-serif';
                  ctx.fillStyle = isRes ? '#fca5a5' : '#86efac';
                  ctx.textAlign = 'right';
                  ctx.fillText(`ML ${zone.mlScore.toFixed(2)}`, chartWidth - 5, yTop + 12);
              }
          });
      }

      // ---------------------------------------------------------------
      // Visible Range Volume Profile  (drawn FIRST so candles render on top)
      // ---------------------------------------------------------------
      if (effectiveSettings.visibleRangeVolumeProfile && visibleCandles.length > 0) {
          // Use the full visible viewport including padding so bars fill the entire chart height
          const vpTopPrice = maxPrice + padding;
          const vpBottomPrice = minPrice - padding;
          const vpPriceRange = vpTopPrice - vpBottomPrice;
          const numBins = effectiveSettings.visibleRangeVPNumBins || 100;
          const binSize = vpPriceRange / numBins;
          
          const bins = new Array(numBins).fill(0).map(() => ({ buyVol: 0, sellVol: 0, totalVol: 0 }));
          
          visibleCandles.forEach(c => {
              const cHigh = Math.min(c.high, vpTopPrice);
              const cLow  = Math.max(c.low, vpBottomPrice);
              if (cHigh <= cLow) return;

              let buyRatio = c.close >= c.open ? 0.7 : 0.3;
              if (c.footprint) {
                  const levels = Object.values(c.footprint) as any[];
                  if (levels.length > 0) {
                      const totalBuy  = levels.reduce((s, l) => s + (l.buyVolume  ?? 0), 0);
                      const totalSell = levels.reduce((s, l) => s + (l.sellVolume ?? 0), 0);
                      const fpTotal = totalBuy + totalSell;
                      if (fpTotal > 0) buyRatio = totalBuy / fpTotal;
                  }
              }

              const startBin = Math.max(0, Math.floor((cLow  - vpBottomPrice) / binSize));
              const endBin   = Math.min(numBins - 1, Math.floor((cHigh - vpBottomPrice) / binSize));
              const binsCovered = Math.max(1, endBin - startBin + 1);
              const volPerBin = c.volume / binsCovered;
              for (let vi = startBin; vi <= endBin; vi++) {
                  bins[vi].totalVol += volPerBin;
                  bins[vi].buyVol   += volPerBin * buyRatio;
                  bins[vi].sellVol  += volPerBin * (1 - buyRatio);
              }
          });

          const maxVol = Math.max(...bins.map(b => b.totalVol), 1);
          const totalVolumeInRect = bins.reduce((acc, b) => acc + b.totalVol, 0);
          const vpWidth = chartWidth * 0.15;
          const direction = effectiveSettings.volBarsDirection || 'ltr';
          const opacity = (effectiveSettings.visibleRangeVolumeProfileOpacity ?? 65) / 100;

          const binTopY    = (i: number) => priceToY(vpBottomPrice + (i + 1) * binSize);
          const binBottomY = (i: number) => priceToY(vpBottomPrice + i * binSize);
          const binMidY    = (i: number) => priceToY(vpBottomPrice + (i + 0.5) * binSize);

          // POC
          let pocBinIndex = 0; let maxBinVol = -1;
          bins.forEach((b, i) => { if (b.totalVol > maxBinVol) { maxBinVol = b.totalVol; pocBinIndex = i; } });

          // Multi-Level LVN Detection (Ranked by Valley Depth)
          const allLvns: { index: number, depth: number }[] = [];
          const maxLVNs = effectiveSettings.visibleRangeVPMaxLVNs || 3;
          const minDepth = effectiveSettings.visibleRangeVPMinLVNDepth || 0.1;

          if (bins.length >= 3) {
              for (let i = 1; i < bins.length - 1; i++) {
                  const curr = bins[i].totalVol;
                  const prev = bins[i-1].totalVol;
                  const next = bins[i+1].totalVol;

                  if (curr < prev && curr < next) {
                      const neighborAvg = (prev + next) / 2;
                      // Depth Score: ratio to neighbors (higher = deeper valley)
                      const valleyDepth = curr === 0 ? neighborAvg : neighborAvg / curr;
                      
                      if (valleyDepth >= 1 + minDepth) {
                          allLvns.push({ index: i, depth: valleyDepth });
                      }
                  }
              }
          }

          const centerIndex = numBins / 2;
          const rankedLvns = allLvns
              .sort((a, b) => {
                  if (Math.abs(b.depth - a.depth) > 0.001) return b.depth - a.depth;
                  return Math.abs(a.index - centerIndex) - Math.abs(b.index - centerIndex);
              })
              .slice(0, maxLVNs);

          // Value Area (70%)
          const targetVA = totalVolumeInRect * 0.7;
          let currentVA = bins[pocBinIndex].totalVol;
          let vaHighIndex = pocBinIndex; let vaLowIndex = pocBinIndex;
          while (currentVA < targetVA) {
              const nextHigh = vaHighIndex < numBins - 1 ? bins[vaHighIndex + 1].totalVol : 0;
              const nextLow  = vaLowIndex  > 0           ? bins[vaLowIndex  - 1].totalVol : 0;
              if      (nextHigh > nextLow) { vaHighIndex++; currentVA += nextHigh; }
              else if (nextLow  > 0)       { vaLowIndex--;  currentVA += nextLow;  }
              else if (nextHigh > 0)       { vaHighIndex++; currentVA += nextHigh; }
              else break;
              if (vaHighIndex >= numBins - 1 && vaLowIndex <= 0) break;
          }

          // Draw VA Highlight
          if (effectiveSettings.visibleRangeVPShowVA) {
              const topY = binTopY(vaHighIndex);
              const botY = binBottomY(vaLowIndex);
              ctx.fillStyle = 'rgba(45, 212, 191, 0.15)';
              ctx.fillRect(0, topY, chartWidth, Math.max(botY - topY, 1));
          }

          // Draw bars
          bins.forEach((b, i) => {
              if (b.totalVol === 0) return;
              const yTop  = binTopY(i);
              const cellH = Math.max(binBottomY(i) - yTop, 1);
              const barWidth  = (b.totalVol / maxVol) * vpWidth;
              const sellWidth = (b.sellVol / b.totalVol) * barWidth;
              const buyWidth  = (b.buyVol  / b.totalVol) * barWidth;
              ctx.globalAlpha = opacity;
              if (direction === 'rtl') {
                  ctx.fillStyle = '#eab308'; ctx.fillRect(chartWidth - sellWidth, yTop, sellWidth, cellH);
                  ctx.fillStyle = '#3b82f6'; ctx.fillRect(chartWidth - sellWidth - buyWidth, yTop, buyWidth, cellH);
              } else {
                  ctx.fillStyle = '#eab308'; ctx.fillRect(0, yTop, sellWidth, cellH);
                  ctx.fillStyle = '#3b82f6'; ctx.fillRect(sellWidth, yTop, buyWidth, cellH);
              }
              ctx.globalAlpha = 1.0;
          });

          // Beams
          const drawVPBeam = (y: number, color: string, dashed = false, glow = false) => {
              const bx1 = direction === 'ltr' ? 0 : chartWidth;
              const bx2 = direction === 'ltr' ? chartWidth : 0;
              ctx.beginPath(); ctx.moveTo(bx1, y); ctx.lineTo(bx2, y);
              ctx.strokeStyle = color; ctx.lineWidth = 1;
              if (dashed) ctx.setLineDash([4, 4]); else ctx.setLineDash([]);
              if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 4; }
              ctx.stroke(); ctx.shadowBlur = 0; ctx.setLineDash([]);
          };
          if (effectiveSettings.visibleRangeVPShowVAHigh) drawVPBeam(binTopY(vaHighIndex),    '#40C4FF');
          if (effectiveSettings.visibleRangeVPShowVALow)  drawVPBeam(binBottomY(vaLowIndex),  '#AB47BC');
          if (effectiveSettings.visibleRangeVPShowPOC)    drawVPBeam(binMidY(pocBinIndex),    '#FFFFFF', false, true);
          if (effectiveSettings.visibleRangeVPShowLVN && rankedLvns.length > 0) {
              rankedLvns.forEach((lvn, rank) => {
                  const y = binMidY(lvn.index);
                  const alpha = 1.0 - (rank / maxLVNs) * 0.7;
                  const color = `rgba(161, 161, 170, ${alpha})`;
                  drawVPBeam(y, color, true);
              });
          }
      }

      // Draw Candles or Line Chart
      const gap = slotWidth * (effectiveSettings.showFootprintsOnChart ? 0.1 : 0.3);
      const candleWidth = slotWidth - gap;
      const xOffset = (effectiveVisibleCount - visibleCandles.length) * slotWidth;

      if (candleWidth < 1.5) {
          // Draw Line Chart
          ctx.strokeStyle = '#3b82f6'; // Global blue
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          visibleCandles.forEach((candle, i) => {
              const x = xOffset + i * slotWidth + slotWidth / 2;
              const y = priceToY(candle.close);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
          });
          ctx.stroke();
      } else {
          // --- BEGIN REFACTORED DRAWING LOGIC (PORTED FROM LEGACY) ---
          
          const showFootprintsAtThisZoom = effectiveSettings.showFootprintsOnChart && candleWidth > 5;
          const failedAuctions: { type: 'high' | 'low', price: number, startX: number, endX: number }[] = [];

          // 1. Pre-calculate Failed Auctions (Sequential Loop)
          visibleCandles.forEach((candle, i) => {
              if (!candle.footprint) return;
              
              const fHigh = candle.footprint[candle.high];
              const fLow = candle.footprint[candle.low];
              
              // Failed Auction = Price reached extreme but volume on testing side was zero
              const faHigh = (!fHigh || fHigh.buyVolume === 0);
              const faLow = (!fLow || fLow.sellVolume === 0);

              if (faHigh || faLow) {
                  const sX = xOffset + i * slotWidth + gap / 2;
                  let fX = sX;
                  let fW = candleWidth;
                  
                  if (footprintStyle === 'side') {
                      const drawableW = slotWidth - 2 * gap;
                      const cW = drawableW * 0.25;
                      fW = drawableW * 0.75;
                      fX = sX + cW + gap;
                  }
                  const lineStartX = fX + fW;

                  if (faHigh) {
                      let eX = chartWidth;
                      for (let j = i + 1; j < visibleCandles.length; j++) {
                          if (visibleCandles[j].high >= candle.high) {
                              eX = xOffset + j * slotWidth + gap / 2;
                              break;
                          }
                      }
                      failedAuctions.push({ type: 'high', price: candle.high, startX: lineStartX, endX: eX });
                  }
                  if (faLow) {
                      let eX = chartWidth;
                      for (let j = i + 1; j < visibleCandles.length; j++) {
                          if (visibleCandles[j].low <= candle.low) {
                              eX = xOffset + j * slotWidth + gap / 2;
                              break;
                          }
                      }
                      failedAuctions.push({ type: 'low', price: candle.low, startX: lineStartX, endX: eX });
                  }
              }
          });

          // 2. Main Drawing Loop (Sequential Loop)
          visibleCandles.forEach((candle, i) => {
              let levels: {price: number, buyVolume: number, sellVolume: number, delta: number}[] = [];
              let aggTickSize = tickSize;
              let maxVol = 0;
              let hvnLevel: any = null;
              let buyImbalances = new Set<number>();
              let sellImbalances = new Set<number>();
              let multiplier = 1;

              // Aggregation Logic (Perfectly Ported)
              if (showFootprintsAtThisZoom && candle.footprint) {
                  const rawLevels = Object.values(candle.footprint);
                  if (rawLevels.length > 0) {
                      if (effectiveSettings.autoAggregation || visibleCandles.length <= 10) {
                          const pr = maxPrice - minPrice;
                          const totalTicks = pr / tickSize;
                          multiplier = Math.max(1, Math.round(totalTicks / 60));
                      } else {
                          multiplier = effectiveSettings.chartFootprintTicksPerRow || 1;
                          const pr = maxPrice - minPrice;
                          if (pr > 500) multiplier *= 40; 
                          else if (pr > 50) multiplier *= 10;
                      }

                      aggTickSize = tickSize * multiplier;
                      const aggMap = new Map<number, {price: number, buyVolume: number, sellVolume: number, delta: number}>();
                      
                      // Pre-fill with all possible levels in candle range (Wicks included)
                      const candleLowIdx = Math.floor(Math.round(candle.low / tickSize) / multiplier);
                      const candleHighIdx = Math.floor(Math.round(candle.high / tickSize) / multiplier);
                      
                      for (let idx = candleLowIdx; idx <= candleHighIdx; idx++) {
                          const cp = Number((idx * aggTickSize).toFixed(8));
                          aggMap.set(cp, { price: cp, buyVolume: 0, sellVolume: 0, delta: 0 });
                      }

                      rawLevels.forEach(l => {
                          if (l.price < candle.low - tickSize || l.price > candle.high + tickSize) return;
                          
                          const ap = Math.floor(Math.round(l.price / tickSize) / multiplier) * aggTickSize;
                          const cp = Number(ap.toFixed(8));
                          if (aggMap.has(cp)) {
                              const e = aggMap.get(cp)!;
                              e.buyVolume += l.buyVolume; e.sellVolume += l.sellVolume; e.delta += l.delta;
                          } else {
                              aggMap.set(cp, { price: cp, buyVolume: l.buyVolume, sellVolume: l.sellVolume, delta: l.delta });
                          }
                      });

                      levels = Array.from(aggMap.values()).sort((a, b) => b.price - a.price);
                      
                      if (levels.length > 0) {
                          maxVol = Math.max(...levels.map(l => l.buyVolume + l.sellVolume));
                          hvnLevel = levels.find(l => (l.buyVolume + l.sellVolume) === maxVol);
                          for (let j = 1; j < levels.length; j++) {
                              if (levels[j-1].buyVolume >= 3 * levels[j].sellVolume && levels[j-1].buyVolume > 0) buyImbalances.add(levels[j-1].price);
                              if (levels[j].sellVolume >= 3 * levels[j-1].buyVolume && levels[j].sellVolume > 0) sellImbalances.add(levels[j].price);
                          }
                      }
                  }
              }

              const candleX = xOffset + i * slotWidth + gap / 2;
              const yO = priceToY(candle.open); const yH = priceToY(candle.high);
              const yL = priceToY(candle.low); const yC = priceToY(candle.close);
              const cBase = candle.close >= candle.open ? '#22d3ee' : '#a855f7';
              
              const drawableW = slotWidth - gap; // Total space for candle + fp
              let currCW = candleWidth; 
              let fpW = candleWidth; 
              let fpX = candleX;
              
              if (showFootprintsAtThisZoom && footprintStyle === 'side') {
                  currCW = drawableW * 0.25;
                  fpW = drawableW * 0.75;
                  fpX = candleX + currCW + (gap * 0.2); // Small inner gap
              }

              const isFaint = showFootprintsAtThisZoom && levels.length > 0 && footprintStyle === 'overlay';
              const isFootprintOnly = showFootprintsAtThisZoom && levels.length > 0 && footprintStyle === 'footprint-only';

              // 3. Draw Candle or Shadow
              if ((!showFootprintsAtThisZoom || footprintStyle === 'side' || isFaint || levels.length === 0) && !isFootprintOnly) {
                  ctx.save();
                  if (isFaint) ctx.globalAlpha = 0.2;
                  ctx.fillStyle = ctx.strokeStyle = cBase; ctx.lineWidth = 1;
                  const bY = Math.min(yO, yC); const bH = Math.max(Math.abs(yC - yO), 1);
                  
                  // Align high/low to footprint rows if in side mode
                  let dHigh = candle.high; let dLow = candle.low;
                  if (levels.length > 0 && footprintStyle === 'side') {
                      const tRow = levels[0].price + aggTickSize;
                      const bRow = levels[levels.length - 1].price;
                      // Bound the extension to 10% of chart height to prevent "endless" wicks if data is extreme
                      const maxExtend = (maxPrice - minPrice) * 0.1;
                      dHigh = Math.min(tRow, candle.high + maxExtend);
                      dLow = Math.max(bRow, candle.low - maxExtend);
                  }
                  const dyH = priceToY(dHigh); const dyL = priceToY(dLow);

                  ctx.beginPath();
                  ctx.moveTo(candleX + currCW / 2, dyH); ctx.lineTo(candleX + currCW / 2, bY);
                  ctx.moveTo(candleX + currCW / 2, bY + bH); ctx.lineTo(candleX + currCW / 2, dyL); ctx.stroke();
                  ctx.fillRect(candleX, bY, currCW, bH);
                  ctx.restore();
              }

              // 4. Draw Footprints
              if (showFootprintsAtThisZoom && levels.length > 0) {
                  const hW = fpW / 2;
                  levels.forEach(l => {
                      const yB = priceToY(l.price); const yT = priceToY(l.price + aggTickSize);
                      if (yB < 0 || yT > chartHeight) return;
                      const cH = Math.max(yB - yT - 1, 1);
                      const totalVol = l.buyVolume + l.sellVolume;
                      const inst = Math.min(1, totalVol / (maxVol || 1));
                      
                      if (totalVol === 0) {
                          ctx.fillStyle = 'rgba(113, 113, 122, 0.05)';
                      } else {
                          ctx.fillStyle = l.buyVolume > l.sellVolume 
                              ? `rgba(34, 197, 94, ${0.1 + inst * 0.7})` 
                              : `rgba(239, 68, 68, ${0.1 + inst * 0.7})`;
                      }
                      ctx.fillRect(fpX, yT, fpW, cH);

                      // Imbalance highlights (Blue)
                      if (sellImbalances.has(l.price)) { ctx.fillStyle = 'rgba(96, 165, 250, 0.4)'; ctx.fillRect(fpX, yT, hW, cH); }
                      if (buyImbalances.has(l.price)) { ctx.fillStyle = 'rgba(96, 165, 250, 0.4)'; ctx.fillRect(fpX + hW, yT, hW, cH); }
                      
                      if (cH >= 12 && fpW >= 40) {
                          ctx.fillStyle = '#ffffff'; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                          const fV = (v: number) => v === 0 ? '0' : v >= 1000 ? (v/1000).toFixed(1)+'k' : v < 1 ? v.toFixed(3) : v.toFixed(1);
                          ctx.fillText(fV(l.sellVolume), fpX + hW / 2, yT + cH / 2);
                          ctx.fillText(fV(l.buyVolume), fpX + hW + hW / 2, yT + cH / 2);
                      }

                      if (l === hvnLevel) {
                          ctx.strokeStyle = '#eab308'; ctx.lineWidth = cH > 4 ? 2 : 1;
                          if (cH > 4) ctx.strokeRect(fpX, yT, fpW, cH);
                          else { ctx.beginPath(); ctx.moveTo(fpX, yT + cH/2); ctx.lineTo(fpX + fpW, yT + cH/2); ctx.stroke(); }
                      }
                  });

                  if (footprintStyle === 'overlay') {
                      // Hollow Candle Outline over footprint
                      const oW = fpW * 0.5; 
                      const oX = fpX + (fpW - oW) / 2;
                      const bY = Math.min(yO, yC); 
                      const bH = Math.max(Math.abs(yC - yO), 1);
                      
                      ctx.strokeStyle = cBase; 
                      ctx.lineWidth = 1;
                      
                      // Wicks
                      ctx.beginPath();
                      ctx.moveTo(fpX + fpW / 2, yH); 
                      ctx.lineTo(fpX + fpW / 2, bY);
                      ctx.moveTo(fpX + fpW / 2, bY + bH); 
                      ctx.lineTo(fpX + fpW / 2, yL); 
                      ctx.stroke();
                      
                      // Body Outline
                      ctx.strokeRect(oX, bY, oW, bH);
                  }
              }

              // 5. Imbalance Markers
              if ((effectiveSettings.positionImbalanceMode === 'markersOnly' || effectiveSettings.positionImbalanceMode === 'both')) {
                  const workingLevels = levels;
                  if (workingLevels.length > 0) {
                      let mV = 0; let pL: any = null; let tV = 0; let dP = 0;
                      let hPr = -Infinity; let dH = 0; let lPr = Infinity; let dL = 0;
                      let b30 = 0; let s30 = 0;
                      const range = candle.high - candle.low; const t30Line = candle.low + range * 0.7;
                      
                      workingLevels.forEach(l => {
                          const tv = l.buyVolume + l.sellVolume;
                          if (tv > mV) { mV = tv; pL = l; tV = tv; dP = l.delta; }
                          if (l.price > hPr) { hPr = l.price; dH = l.delta; }
                          if (l.price < lPr || lPr === Infinity) { lPr = l.price; dL = l.delta; }
                          if (l.price >= t30Line) { b30 += l.buyVolume; s30 += l.sellVolume; }
                      });
                      const t30Imb = b30 > s30 * 2.5 && s30 > 0;
                      const pImb = Math.abs(dP) > tV * 0.4;
                      const hiImb = Math.abs(hPr - candle.high) < (tickSize/2) && Math.abs(dH) > (mV * 0.3);
                      const loImb = Math.abs(lPr - candle.low) < (tickSize/2) && Math.abs(dL) > (mV * 0.3);
                      const mX = candleX + currCW / 2;
                      if (t30Imb) {
                          const y = priceToY(candle.high) - 6; ctx.fillStyle = 'rgba(239, 68, 68, 0.85)';
                          ctx.beginPath(); ctx.moveTo(mX, y + 4); ctx.lineTo(mX - 3, y); ctx.lineTo(mX + 3, y); ctx.fill();
                      }
                      if (pL && pImb) {
                          const y = priceToY(pL.price); ctx.fillStyle = 'rgba(234, 179, 8, 0.85)';
                          ctx.beginPath(); ctx.moveTo(mX, y - 3); ctx.lineTo(mX + 3, y); ctx.lineTo(mX, y + 3); ctx.lineTo(mX - 3, y); ctx.fill();
                      }
                      if (hiImb) {
                          const y = priceToY(candle.high); ctx.fillStyle = dH > 0 ? '#22c55e' : '#ef4444';
                          ctx.beginPath(); ctx.arc(mX, y, 2, 0, Math.PI * 2); ctx.fill();
                      } else if (loImb) {
                          const y = priceToY(candle.low); ctx.fillStyle = dL > 0 ? '#22c55e' : '#ef4444';
                          ctx.beginPath(); ctx.arc(mX, y, 2, 0, Math.PI * 2); ctx.fill();
                      }
                  }
              }
          });

          // 3. Draw Failed Auction Lines (On Top)
          if (showFootprintsAtThisZoom) {
              ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
              failedAuctions.forEach(fa => {
                  const y = priceToY(fa.price);
                  ctx.beginPath(); ctx.moveTo(fa.startX, y); ctx.lineTo(fa.endX, y); ctx.stroke();
              });
              ctx.setLineDash([]);
          }
      }

      // Info Label for Footprints
      if (effectiveSettings.showFootprintsOnChart && !simplified) {
          ctx.save();
          ctx.font = '10px sans-serif';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.textAlign = 'right';
          ctx.fillText("Historic footprints: live only • Full tick history requires paid feed", chartWidth - 10, 24);
          ctx.restore();
      }

      // Draw Drawings (Rectangles, Lines)
      drawings.forEach(d => renderDrawing(d, d.id === selectedDrawingId));
      
      if (drawingState === 'drawing' && currentDrawingPoints.length > 0) {
          const tempDrawing: Drawing = {
              id: 'temp',
              type: activeTool === 'measure_rect' ? 'rect' : activeTool === 'horizontal_volume_bars' ? 'vol_bar_rect' : 'line',
              points: currentDrawingPoints,
              style: lineSettings,
              volBarSettings: activeTool === 'horizontal_volume_bars' ? { numBars: 50, direction: 'ltr' } : undefined
          };
          renderDrawing(tempDrawing, true);
      }

      // Current Price Line
      const lastCandle = validData[validData.length - 1];

      // --- Draw Adaptive Swing Areas (The Cage) ---
      if (squeezer.config.showBoxes && !simplified) {
          const boxesWithMidline = squeezer.swingAreas.filter(a => a.interestLevel !== null);

          squeezer.swingAreas.forEach(area => {
              const startX = xOffset + (area.startIndex - startIdx) * slotWidth;
              const endX = area.isFired && area.endIndex 
                  ? xOffset + (area.endIndex - startIdx) * slotWidth 
                  : chartWidth; // Extend to current if active
              
              if (endX < 0 || startX > chartWidth) return; // Off-screen

              const yTop = priceToY(area.top);
              const yBottom = priceToY(area.bottom);
              const boxH = Math.max(Math.abs(yBottom - yTop), 1);

              // Draw Box Background with Gradient
              const grad = ctx.createLinearGradient(0, yTop, 0, yBottom);
              grad.addColorStop(0, 'rgba(161, 161, 170, 0.05)');
              grad.addColorStop(0.5, area.isFired ? 'rgba(34, 211, 238, 0.1)' : 'rgba(161, 161, 170, 0.15)');
              grad.addColorStop(1, 'rgba(161, 161, 170, 0.05)');
              
              ctx.fillStyle = grad;
              ctx.fillRect(startX, yTop, endX - startX, boxH);

              // Draw Borders
              ctx.strokeStyle = area.isFired ? 'rgba(34, 211, 238, 0.5)' : 'rgba(161, 161, 170, 0.5)';
              ctx.lineWidth = 1;
              ctx.strokeRect(startX, yTop, endX - startX, boxH);

              // Draw ML Confidence Label
              if (squeezer.config.enableML) {
                  const direction = (area.deltaAccumulated || 0) >= 0 ? 'Mark Up' : 'Mark Down';
                  const label = area.isFallback 
                      ? 'Insufficient Training Depth' 
                      : `${direction} Confidence ${area.confidence}%`;

                  ctx.fillStyle = (area.isFallback || area.confidence >= squeezer.config.minConfidenceThreshold) ? '#22d3ee' : '#ef4444';
                  ctx.font = 'bold 9px monospace';
                  ctx.textAlign = 'left';
                  ctx.fillText(label, startX + 4, yTop - 4);
              }

              // Draw Interest Line
              if (squeezer.config.showInterestLine && area.interestLevel) {
                  const yInt = priceToY(area.interestLevel);
                  ctx.strokeStyle = squeezer.config.dynamicLineColor 
                      ? (area.maxSqueezeState === 'HIGH' ? '#f97316' : 
                         area.maxSqueezeState === 'MID' ? '#d4d4d8' : '#52525b')
                      : '#eab308';
                  ctx.lineWidth = 2;
                  ctx.setLineDash([2, 2]);
                  ctx.beginPath();
                  ctx.moveTo(startX, yInt);
                  
                  // Extend line logic: keep extending until the 3rd subsequent box starts
                  let lineEndX = endX;
                  const midlineIdx = boxesWithMidline.findIndex(b => b.id === area.id);
                  if (midlineIdx !== -1) {
                      if (midlineIdx >= boxesWithMidline.length - 3) {
                          lineEndX = chartWidth; // One of the last 3, extend to current edge
                      } else {
                          const pushingBox = boxesWithMidline[midlineIdx + 3];
                          lineEndX = xOffset + (pushingBox.startIndex - startIdx) * slotWidth;
                      }
                  }
                  lineEndX = Math.max(lineEndX, endX); // Ensure it at least covers its own box
                  
                  ctx.lineTo(lineEndX, yInt);
                  ctx.stroke();
                  ctx.setLineDash([]);
              }
          });
      }

      // --- Draw Zero-Lag Trendline ---
      if (squeezer.config.showZeroLag && !simplified) {
          ctx.strokeStyle = 'rgba(212, 212, 216, 0.8)'; // Silver
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          let started = false;
          squeezer.oscillatorData.forEach((d, i) => {
              if (i < startIdx || i >= endIdx || !d.zeroLagLevel) return;
              const x = xOffset + (i - startIdx) * slotWidth + slotWidth / 2;
              const y = priceToY(d.zeroLagLevel);
              if (!started) { ctx.moveTo(x, y); started = true; } 
              else { ctx.lineTo(x, y); }
          });
          ctx.stroke();
      }

      // Restore clipping region
      ctx.restore();

      if (data.length > 0) {
        const lastCandle = data[data.length - 1];
        const y = priceToY(lastCandle.close);
        const isBullish = lastCandle.close >= lastCandle.open;
        const color = isBullish ? '#22d3ee' : '#a855f7';

        // 1. Dash Line (Horizontal) - Only if at current time
        if (scrollOffset === 0) {
            ctx.strokeStyle = color;
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(chartWidth, y);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 2. Price Label Box on Axis
        ctx.fillStyle = color;
        ctx.fillRect(chartWidth, y - 10, rightBuffer, 20);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(lastCandle.close.toFixed(2), chartWidth + 8, y);

        // 3. Countdown Flag (only for current candle)
        if (scrollOffset === 0) {
            const interval = data.length > 1 ? data[data.length - 1].time - data[data.length - 2].time : 60000;
            const nextClose = lastCandle.time + interval;
            const timeLeft = Math.max(0, nextClose - currentTime);
            const minutes = Math.floor(timeLeft / 60000);
            const seconds = Math.floor((timeLeft % 60000) / 1000);
            const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            
            const flagY = y + 10;
            const flagHeight = 14;
            ctx.fillStyle = '#18181b';
            ctx.fillRect(chartWidth, flagY, rightBuffer, flagHeight);
            ctx.strokeStyle = '#3f3f46';
            ctx.strokeRect(chartWidth, flagY, rightBuffer, flagHeight);
            ctx.fillStyle = '#fbbf24';
            ctx.font = '10px monospace';
            ctx.fillText(timeStr, chartWidth + 8, flagY + flagHeight/2);
        }
      }

      // Loading Indicator for History
      if (isLoadingHistory) {
          ctx.fillStyle = 'rgba(24, 24, 27, 0.8)';
          ctx.fillRect(10, 10, 120, 24);
          ctx.fillStyle = '#3b82f6';
          ctx.font = '10px monospace';
          ctx.textAlign = 'left';
          ctx.fillText('Loading History...', 20, 26);
      }

      // Draw Crosshair
      if (mousePos.x > 0 && mousePos.x < chartWidth) {
          ctx.setLineDash([2, 2]);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.lineWidth = 1;

          // Vertical line
          ctx.beginPath();
          ctx.moveTo(mousePos.x, 0);
          ctx.lineTo(mousePos.x, chartHeight);
          ctx.stroke();

          // Horizontal line
          if (mousePos.y > 0 && mousePos.y < chartHeight) {
              ctx.beginPath();
              ctx.moveTo(0, mousePos.y);
              ctx.lineTo(chartWidth, mousePos.y);
              ctx.stroke();
              
              ctx.setLineDash([]);

              // Price Label on Y-axis
              const { minPrice, priceRange, padding } = scaleRef.current;
              const mousePrice = minPrice - padding + ((chartHeight - mousePos.y) / chartHeight) * (priceRange + 2 * padding);
              
              ctx.fillStyle = '#3f3f46'; // zinc-700
              ctx.fillRect(chartWidth, mousePos.y - 9, rightBuffer, 18);
              ctx.fillStyle = '#ffffff';
              ctx.font = '9px monospace';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillText(mousePrice.toFixed(2), chartWidth + 4, mousePos.y);
          } else {
              ctx.setLineDash([]);
          }

          // Time Label on X-axis
          const slotWidth = availableWidth / effectiveVisibleCount;
          const candleIdx = Math.floor((mousePos.x - xOffset) / slotWidth);
          const candle = visibleCandles[candleIdx];
          if (candle) {
              const date = new Date(candle.time);
              const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
              const fullTimeStr = `${dateStr} ${timeStr}`;
              
              ctx.font = '9px monospace';
              const textWidth = ctx.measureText(fullTimeStr).width;
              ctx.fillStyle = '#3f3f46';
              ctx.fillRect(mousePos.x - (textWidth + 10) / 2, chartHeight, textWidth + 10, xAxisHeight);
              ctx.fillStyle = '#ffffff';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(fullTimeStr, mousePos.x, chartHeight + 10);
          }

          // Tool Cursor Label
          if (activeTool === 'horizontal_volume_bars') {
              ctx.font = 'bold 10px monospace';
              ctx.fillStyle = '#3b82f6';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'bottom';
              ctx.fillText('Vol', mousePos.x + 10, mousePos.y - 10);
          }
      }
  }, [data, dimensions, settings, footprintStyle, visibleCount, scrollOffset, isLoadingHistory, absorptionZones, imbalanceZones, persistentZones, mousePos, squeezer, pricePan, priceZoom, tickSize, drawings, currentDrawingPoints, activeTool, drawingState, selectedDrawingId, lineSettings]);

  const drawRef = useRef<number | null>(null);
  const requestDraw = useCallback(() => {
    if (drawRef.current) cancelAnimationFrame(drawRef.current);
    drawRef.current = requestAnimationFrame(() => {
      draw();
      drawRef.current = null;
    });
  }, [draw]);

  useEffect(() => {
    requestDraw();
  }, [requestDraw]);

  const getMouseCoords = (e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const s = scaleRef.current;
      if (!s.chartWidth) return null;
      
      const minP = s.minPrice - s.padding;
      const rangeP = s.priceRange + 2 * s.padding;
      const price = ((s.chartHeight - y) / s.chartHeight) * rangeP + minP;
      
      const idx = Math.round((x - s.slotWidth/2) / s.slotWidth) + s.startIdx;
      const safeIdx = Math.max(0, Math.min(idx, data.length - 1));
      const time = data[safeIdx]?.time || 0;
      
      return { x, y, time, price, idx: safeIdx };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) return; 
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Drawing Logic
    if (activeTool !== 'none') {
        e.stopPropagation();
        const coords = getMouseCoords(e);
        if (!coords) return;

        if (activeTool === 'measure_rect' || activeTool === 'horizontal_volume_bars') {
            // Singleton rule for Horizontal Volume Bars
            if (activeTool === 'horizontal_volume_bars') {
                setDrawings(prev => prev.filter(d => d.type !== 'vol_bar_rect'));
            } else {
                setDrawings(prev => prev.filter(d => d.type !== 'rect'));
            }
            setCurrentDrawingPoints([{ time: coords.time, price: coords.price }, { time: coords.time, price: coords.price }]);
            setDrawingState('drawing');
            setSelectedDrawingId(null);
        } else if (activeTool === 'draw_line') {
            if (drawingState === 'idle') {
                setCurrentDrawingPoints([{ time: coords.time, price: coords.price }, { time: coords.time, price: coords.price }]);
                setDrawingState('drawing');
                setSelectedDrawingId(null);
            } else {
                const newDrawing: Drawing = {
                    id: Date.now().toString(),
                    type: 'line',
                    points: [...currentDrawingPoints],
                    style: { ...lineSettings }
                };
                setDrawings(prev => [...prev, newDrawing]);
                setDrawingState('idle');
                setCurrentDrawingPoints([]);
                setSelectedDrawingId(newDrawing.id);
            }
        }
        return;
    }

    // Selection Logic
    const coords = getMouseCoords(e);
    if (coords) {
        const s = scaleRef.current;
        let hitFound = false;
        
        const getPointXY = (p: DrawingPoint) => {
             const idx = data.findIndex(c => c.time === p.time);
             if (idx === -1) return null;
             const px = (idx - s.startIdx) * s.slotWidth + s.slotWidth/2;
             const py = s.chartHeight - ((p.price - (s.minPrice - s.padding)) / (s.priceRange + 2 * s.padding)) * s.chartHeight;
             return { x: px, y: py };
        };

        // Check selected drawing handles first
        if (selectedDrawingId) {
            const d = drawings.find(d => d.id === selectedDrawingId);
            if (d && d.type === 'line') {
                for (let i = 0; i < d.points.length; i++) {
                    const pt = getPointXY(d.points[i]);
                    if (pt && Math.hypot(pt.x - x, pt.y - y) < 8) {
                        setDragTarget({ type: 'point', index: i });
                        setIsDragging(false);
                        return;
                    }
                }
            }
        }

        // Check for line hits
        for (let i = drawings.length - 1; i >= 0; i--) {
            const d = drawings[i];
            if (d.type === 'line' && d.points.length === 2) {
                const p1 = getPointXY(d.points[0]);
                const p2 = getPointXY(d.points[1]);
                if (p1 && p2) {
                    const dist = distanceToSegment({x, y}, p1, p2);
                    if (dist < 8) {
                        setSelectedDrawingId(d.id);
                        setDragTarget({ type: 'body' });
                        setLastMouseX(x);
                        setLastMouseY(y);
                        hitFound = true;
                        setIsDragging(false);
                        return;
                    }
                }
            } else if (d.type === 'rect' || d.type === 'vol_bar_rect') {
                 const p1 = getPointXY(d.points[0]);
                 const p2 = getPointXY(d.points[1]);
                 if (p1 && p2) {
                     const minX = Math.min(p1.x, p2.x);
                     const maxX = Math.max(p1.x, p2.x);
                     const minY = Math.min(p1.y, p2.y);
                     const maxY = Math.max(p1.y, p2.y);
                     
                     const xIndices = p1.x < p2.x ? [0, 1] : [1, 0];
                     const yIndices = p1.y < p2.y ? [0, 1] : [1, 0];
                     
                     // Check Handles (Corners) - 8px radius
                     const handles = [
                         { x: minX, y: minY, xIdx: xIndices[0], yIdx: yIndices[0] }, // TL
                         { x: maxX, y: minY, xIdx: xIndices[1], yIdx: yIndices[0] }, // TR
                         { x: minX, y: maxY, xIdx: xIndices[0], yIdx: yIndices[1] }, // BL
                         { x: maxX, y: maxY, xIdx: xIndices[1], yIdx: yIndices[1] }  // BR
                     ];
                     
                     for (const h of handles) {
                         if (Math.hypot(h.x - x, h.y - y) < 8) {
                             setSelectedDrawingId(d.id);
                             setDragTarget({ type: 'resize', xIndex: h.xIdx, yIndex: h.yIdx });
                             hitFound = true;
                             setIsDragging(false);
                             return;
                         }
                     }
                     
                     // Check Edges - 5px tolerance
                     const tolerance = 5;
                     // Top Edge
                     if (Math.abs(y - minY) < tolerance && x >= minX && x <= maxX) {
                         setSelectedDrawingId(d.id);
                         setDragTarget({ type: 'resize', yIndex: yIndices[0] });
                         hitFound = true;
                         setIsDragging(false);
                         return;
                     }
                     // Bottom Edge
                     if (Math.abs(y - maxY) < tolerance && x >= minX && x <= maxX) {
                         setSelectedDrawingId(d.id);
                         setDragTarget({ type: 'resize', yIndex: yIndices[1] });
                         hitFound = true;
                         setIsDragging(false);
                         return;
                     }
                     // Left Edge
                     if (Math.abs(x - minX) < tolerance && y >= minY && y <= maxY) {
                         setSelectedDrawingId(d.id);
                         setDragTarget({ type: 'resize', xIndex: xIndices[0] });
                         hitFound = true;
                         setIsDragging(false);
                         return;
                     }
                     // Right Edge
                     if (Math.abs(x - maxX) < tolerance && y >= minY && y <= maxY) {
                         setSelectedDrawingId(d.id);
                         setDragTarget({ type: 'resize', xIndex: xIndices[1] });
                         hitFound = true;
                         setIsDragging(false);
                         return;
                     }
                     
                     // Check Body
                     if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
                         setSelectedDrawingId(d.id);
                         setDragTarget({ type: 'body' });
                         setLastMouseX(x);
                         setLastMouseY(y);
                         hitFound = true;
                         setIsDragging(false);
                         return;
                     }
                 }
            }
        }
        
        if (!hitFound) {
            setSelectedDrawingId(null);
        } else {
            return;
        }
    }

    // Existing Pan Logic
    if (x > dimensions.width - 60) {
        setIsDraggingPrice(true);
    } else {
        setIsDragging(true);
        setLastMouseX(e.clientX);
    }
    setLastMouseY(e.clientY);
  };

  const handleMouseUp = () => {
    if ((activeTool === 'measure_rect' || activeTool === 'horizontal_volume_bars') && drawingState === 'drawing') {
        const newDrawing: Drawing = {
            id: Date.now().toString(),
            type: activeTool === 'measure_rect' ? 'rect' : 'vol_bar_rect',
            points: [...currentDrawingPoints],
            style: { color: '#3b82f6', lineWidth: 1, lineType: 'solid' },
            volBarSettings: activeTool === 'horizontal_volume_bars' ? { numBars: 50, direction: 'ltr' } : undefined
        };
        setDrawings(prev => [...prev, newDrawing]);
        setDrawingState('idle');
        setCurrentDrawingPoints([]);
        setSelectedDrawingId(newDrawing.id);
    }

    setIsDragging(false);
    setIsDraggingPrice(false);
    setDragTarget(null);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
      e.preventDefault();
      const containerRect = containerRef.current?.getBoundingClientRect();
      const wrapperRect = wrapperRef.current?.getBoundingClientRect();
      
      if (!containerRect || !wrapperRect) return;
      
      // Coordinates for context menu positioning (relative to container)
      const menuX = e.clientX - containerRect.left;
      const menuY = e.clientY - containerRect.top;

      // Coordinates for hit detection (relative to wrapper/canvas)
      const canvasX = e.clientX - wrapperRect.left;
      // const canvasY = e.clientY - wrapperRect.top; // Not needed for X-only check

      // Check for Visible Range VP click
      if (settings.visibleRangeVolumeProfile) {
          const chartWidth = dimensions.width - 60;
          const vpWidth = chartWidth * 0.15;
          const direction = settings.volBarsDirection || 'ltr';
          
          let isOverVP = false;
          if (direction === 'ltr') {
              if (canvasX >= 0 && canvasX <= vpWidth) isOverVP = true;
          } else {
              if (canvasX >= chartWidth - vpWidth && canvasX <= chartWidth) isOverVP = true;
          }

          if (isOverVP) {
              setContextMenu({ x: menuX, y: menuY, drawingId: 'visible_range_vp' });
              return;
          }
      }

      if (selectedDrawingId) {
          setContextMenu({ x: menuX, y: menuY, drawingId: selectedDrawingId });
      }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    
    if (x > dimensions.width - 60) {
        setPriceZoom(1);
        setPricePan(0);
    } else {
        setScrollOffset(0);
        setVisibleCount(100);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x, y });

    // Drawing Update
    if (drawingState === 'drawing') {
        const coords = getMouseCoords(e);
        if (coords) {
            setCurrentDrawingPoints(prev => {
                if (prev.length === 0) return prev;
                const start = prev[0];
                return [start, { time: coords.time, price: coords.price }];
            });
        }
    }

    // Dragging Drawing
    if (dragTarget && selectedDrawingId) {
        const coords = getMouseCoords(e);
        if (coords) {
            setDrawings(prev => prev.map(d => {
                if (d.id !== selectedDrawingId) return d;
                
                if (dragTarget.type === 'point' && typeof dragTarget.index === 'number') {
                    const newPoints = [...d.points];
                    newPoints[dragTarget.index] = { time: coords.time, price: coords.price };
                    return { ...d, points: newPoints };
                } else if (dragTarget.type === 'resize') {
                    const newPoints = [...d.points];
                    if (typeof dragTarget.xIndex === 'number') {
                        newPoints[dragTarget.xIndex] = { ...newPoints[dragTarget.xIndex], time: coords.time };
                    }
                    if (typeof dragTarget.yIndex === 'number') {
                        newPoints[dragTarget.yIndex] = { ...newPoints[dragTarget.yIndex], price: coords.price };
                    }
                    return { ...d, points: newPoints };
                } else if (dragTarget.type === 'body') {
                    const s = scaleRef.current;
                    const dx = x - lastMouseX;
                    const dy = y - lastMouseY;
                    
                    const dIdx = dx / s.slotWidth;
                    const dPrice = -(dy / s.chartHeight) * (s.priceRange + 2 * s.padding);
                    
                    const newPoints = d.points.map(p => {
                        const currIdx = data.findIndex(c => c.time === p.time);
                        const newIdx = Math.round(currIdx + dIdx);
                        const safeIdx = Math.max(0, Math.min(data.length - 1, newIdx));
                        const newTime = data[safeIdx].time;
                        const newPrice = p.price + dPrice;
                        return { time: newTime, price: newPrice };
                    });
                    
                    return { ...d, points: newPoints };
                }
                return d;
            }));
            
            if (dragTarget.type === 'body') {
                setLastMouseX(x);
                setLastMouseY(y);
            }
        }
        return;
    }

    if (isDraggingPrice) {
        const dy = e.clientY - lastMouseY;
        if (Math.abs(dy) > 0) {
            // Convert pixel movement to price movement
            const priceMove = (dy / dimensions.height) * (scaleRef.current?.priceRange || 100);
            setPricePan(prev => prev + priceMove);
            setLastMouseY(e.clientY);
        }
    } else if (isDragging) {
        const dx = e.clientX - lastMouseX;
        const dy = e.clientY - lastMouseY;

        // Vertical Pan (Anywhere)
        if (Math.abs(dy) > 1) { // Small threshold to prioritize horizontal if only slightly vertical
            const scale = scaleRef.current;
            const totalH = dimensions.height || 400;
            const totalR = (scale.priceRange || 0) + 2 * (scale.padding || 0);
            
            if (totalH > 0 && totalR > 0) {
                const priceMove = (dy / totalH) * totalR;
                setPricePan(prev => prev + priceMove);
                setLastMouseY(e.clientY);
            }
        }

        const availableWidth = dimensions.width - 60;
        const slotWidth = availableWidth / visibleCount;
        const candlesMoved = Math.round(dx / slotWidth);
        
        if (candlesMoved !== 0) {
            let shouldFetch = false;
            setScrollOffset(prev => {
                const next = prev + candlesMoved;
                const maxScroll = Math.max(0, data.length - visibleCount);
                const result = Math.min(Math.max(next, 0), maxScroll);
                
                // Trigger fetch more history if we are near the beginning
                if (result > data.length - visibleCount - 50 && onFetchMoreHistory && !isLoadingHistory) {
                    shouldFetch = true;
                }
                
                return result;
            });
            if (shouldFetch && onFetchMoreHistory) {
                onFetchMoreHistory(data[0]?.time);
            }
            setLastMouseX(e.clientX);
        }
        return;
    }

    const { minPrice, maxPrice, priceRange, height: chartHeight, padding, globalMinTick = 1 } = scaleRef.current;
    if (chartHeight === 0) return;
    
    const tickHeightInPixels = (globalMinTick / (priceRange + 2 * padding)) * chartHeight;
    const rowH = Math.max(tickHeightInPixels, 1);
    
    // Zone Hover Detection
    if (showZoneInfo) {
        const price = (minPrice - padding) + ((chartHeight - y) / chartHeight) * (priceRange + 2 * padding);
        let found = null;
        if (settings.absorptionEnabled) {
            const zone = absorptionZones.find(z => price >= z.bottom && price <= z.top);
            if (zone) found = { ...zone, category: 'ABSORPTION' };
        }
        if (!found && settings.imbalanceEnabled) {
            const zone = imbalanceZones.find(z => price >= z.bottom && price <= z.top);
            if (zone) found = { ...zone, category: 'IMBALANCE' };
        }
        if (!found && settings.persistentZonesEnabled) {
            const zone = persistentZones.find(z => price >= z.bottom && price <= z.top);
            if (zone) found = { ...zone, category: 'PERSISTENT' };
        }
        setHoveredZone(found);
    } else {
        setHoveredZone(null);
    }

    // Footprint Hover Detection
    let foundFp = null;
    if (settings.showFootprintsOnChart && showFootprintInfo) {
        const effectiveVisibleCount = Math.min(visibleCount, data.length);
        const startIndex = Math.max(0, data.length - effectiveVisibleCount - scrollOffset);
        const visibleCandles = data.slice(startIndex, startIndex + effectiveVisibleCount);
        
        const availableWidth = dimensions.width - 60;
        const slotWidth = availableWidth / effectiveVisibleCount;
        const xOffset = (effectiveVisibleCount - visibleCandles.length) * slotWidth;
        
        const hoveredCandleIndex = Math.floor((x - xOffset) / slotWidth);
        if (hoveredCandleIndex >= 0 && hoveredCandleIndex < visibleCandles.length) {
            const candle = visibleCandles[hoveredCandleIndex];
            if (candle.footprint) {
                const gap = slotWidth * (settings.showFootprintsOnChart ? 0.1 : 0.3);
                const slotX = xOffset + hoveredCandleIndex * slotWidth;
                let candleX = slotX + gap / 2;
                let currentCandleWidth = slotWidth - gap;
                
                let fpX = candleX;
                let fpWidth = currentCandleWidth;
                
                if (footprintStyle === 'side') {
                    const drawableW = slotWidth - 2 * gap;
                    currentCandleWidth = drawableW * 0.25;
                    fpWidth = drawableW * 0.75;
                    fpX = candleX + currentCandleWidth + gap;
                }
                
                if (x >= fpX && x <= fpX + fpWidth) {
                    // Aggregate Footprint Levels for hover detection
                    let multiplier = settings.chartFootprintTicksPerRow;
                    const priceRange = maxPrice - minPrice;
                    if (priceRange > 500) multiplier *= 3;      // BTC range
                    else if (priceRange > 50) multiplier *= 2;   // ETH / mid-price coins
                    const aggTickSize = tickSize * multiplier;
                    
                    const aggMap = new Map<number, any>();
                    
                    Object.values(candle.footprint).forEach(l => {
                        const tickIndex = Math.round(l.price / tickSize);
                        const aggTickIndex = Math.floor(tickIndex / multiplier);
                        const aggPrice = aggTickIndex * aggTickSize;
                        const cleanPrice = Number(aggPrice.toFixed(8));
                        
                        if (aggMap.has(cleanPrice)) {
                            const existing = aggMap.get(cleanPrice)!;
                            existing.buyVolume += l.buyVolume;
                            existing.sellVolume += l.sellVolume;
                            existing.delta += l.delta;
                        } else {
                            aggMap.set(cleanPrice, {
                                price: cleanPrice,
                                buyVolume: l.buyVolume,
                                sellVolume: l.sellVolume,
                                delta: l.delta
                            });
                        }
                    });

                    const levels = Array.from(aggMap.values());
                    
                    for (const level of levels) {
                        const yBottom = chartHeight - ((level.price - (minPrice - padding)) / (priceRange + 2 * padding)) * chartHeight;
                        const yTop = chartHeight - (((level.price + aggTickSize) - (minPrice - padding)) / (priceRange + 2 * padding)) * chartHeight;
                        
                        if (y >= yTop && y <= yBottom) {
                            foundFp = { candle, level, x, y };
                            break;
                        }
                    }
                }
            }
        }
    }
    setHoveredFootprint(foundFp);
  };

  return (
    <div className={cn("flex w-full h-full min-h-[400px]", simplified ? "bg-transparent" : "bg-zinc-950", simplified && "min-h-0")}>
      {/* Left Toolbar */}
      {!simplified && (
        <div className={cn("w-8 shrink-0 border-r border-zinc-800 flex flex-col items-center py-3 gap-3 z-20 relative h-full", simplified ? "bg-transparent" : "bg-zinc-950")}>
        {/* Measurement Group */}
        <div className="flex flex-col gap-1">
            <button 
                onClick={() => {
                    if (activeTool === 'measure_rect') {
                        setActiveTool('none');
                        setDrawingState('idle');
                        setCurrentDrawingPoints([]);
                    } else {
                        setActiveTool('measure_rect');
                        setDrawingState('idle');
                        setCurrentDrawingPoints([]);
                        setSelectedDrawingId(null);
                    }
                }}
                className={cn("p-1.5 rounded hover:bg-zinc-800 transition-colors relative", activeTool === 'measure_rect' ? 'bg-zinc-800 text-blue-400' : 'text-zinc-400')}
                title="Measure % Rectangle"
            >
                <Ruler size={16} />
                {activeTool === 'measure_rect' && <div className="absolute top-0 right-0 w-1.5 h-1.5 bg-blue-500 rounded-full"></div>}
            </button>
            <button 
                onClick={() => {
                    if (activeTool === 'horizontal_volume_bars') {
                        setActiveTool('none');
                        setDrawingState('idle');
                        setCurrentDrawingPoints([]);
                    } else {
                        setActiveTool('horizontal_volume_bars');
                        setDrawingState('idle');
                        setCurrentDrawingPoints([]);
                        setSelectedDrawingId(null);
                    }
                }}
                className={cn("p-1.5 rounded hover:bg-zinc-800 transition-colors relative", activeTool === 'horizontal_volume_bars' ? 'bg-zinc-800 text-blue-400' : 'text-zinc-400')}
                title="Horizontal Volume Bars"
            >
                <BarChartHorizontal size={16} />
                {activeTool === 'horizontal_volume_bars' && <div className="absolute top-0 right-0 w-1.5 h-1.5 bg-blue-500 rounded-full"></div>}
            </button>
        </div>
        
        <div className="w-4 h-px bg-zinc-800"></div>

        {/* Drawing Group */}
        <div className="flex flex-col gap-1">
            <button 
                onClick={() => {
                    if (activeTool === 'draw_line') {
                        setActiveTool('none');
                        setDrawingState('idle');
                        setCurrentDrawingPoints([]);
                    } else {
                        setActiveTool('draw_line');
                        setDrawingState('idle');
                        setCurrentDrawingPoints([]);
                        setSelectedDrawingId(null);
                    }
                }}
                className={cn("p-1.5 rounded hover:bg-zinc-800 transition-colors relative", activeTool === 'draw_line' ? 'bg-zinc-800 text-blue-400' : 'text-zinc-400')}
                title="Draw Line"
            >
                <PenTool size={16} />
                {activeTool === 'draw_line' && <div className="absolute top-0 right-0 w-1.5 h-1.5 bg-blue-500 rounded-full"></div>}
            </button>
        </div>

        <div className="w-4 h-px bg-zinc-800"></div>

        <div className="relative">
            <button 
                onClick={() => updateSettings({showFootprintsOnChart: !settings.showFootprintsOnChart})}
                className={cn(
                    "p-1.5 rounded-lg transition-all duration-200",
                    settings.showFootprintsOnChart 
                        ? "bg-cyan-400/10 text-cyan-400" 
                        : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
                )}
                title="Toggle Footprint Grid"
            >
                <Grid size={16} />
            </button>
            {settings.showFootprintsOnChart && settings.chartFootprintTicksPerRow > 1 && (
                <div className="absolute -top-1 -right-1 bg-cyan-500 text-zinc-950 text-[8px] font-bold px-1 rounded-sm pointer-events-none">
                    ×{settings.chartFootprintTicksPerRow}
                </div>
            )}
        </div>
        {settings.showFootprintsOnChart && (
            <button 
                onClick={() => setFootprintStyle(s => s === 'overlay' ? 'side' : s === 'side' ? 'footprint-only' : 'overlay')}
                className="px-2 py-1 rounded-lg text-xs font-bold transition-all duration-200 text-cyan-400 bg-cyan-400/10 hover:bg-cyan-400/20"
                title="Toggle Footprint Style (Overlay / Side-by-Side / Footprint Only)"
            >
                {footprintStyle === 'overlay' ? 'OVR' : footprintStyle === 'side' ? 'SID' : 'FPO'}
            </button>
        )}
        {settings.showFootprintsOnChart && (
            <button 
                onClick={() => setShowFootprintInfo(!showFootprintInfo)}
                className={cn(
                    "p-1.5 rounded-lg transition-all duration-200",
                    showFootprintInfo 
                        ? "bg-cyan-400/10 text-cyan-400" 
                        : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
                )}
                title="Toggle Footprint Hover Info"
            >
                <Info size={16} />
            </button>
        )}
        <button 
            onClick={() => setShowZoneInfo(!showZoneInfo)}
            className={cn(
                "p-1.5 rounded-lg transition-all duration-200",
                showZoneInfo 
                    ? "bg-blue-500/10 text-blue-400" 
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
            )}
            title="Toggle Zone Info"
        >
            <ZoneToggleIcon size={16} />
        </button>

        {/* Oscillator Toggle Button (Bottom of Left Toolbar) */}
        {showOscillator && (
            <div className="absolute bottom-[152px] left-0 w-full flex justify-center">
                <button 
                    onClick={() => setShowOscillatorMenu(!showOscillatorMenu)}
                    className={cn(
                        "p-1.5 rounded-lg transition-all duration-200",
                        showOscillatorMenu 
                            ? "bg-zinc-800 text-zinc-200" 
                            : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
                    )}
                    title="Volume/Foot Pairs"
                >
                    <Zap size={16} />
                </button>
                
                {/* Menu for Oscillator Choice */}
                {showOscillatorMenu && (
                    <div className="absolute left-full bottom-0 ml-2 bg-zinc-900 border border-zinc-800 rounded shadow-xl p-1 min-w-[140px] z-50">
                        <button 
                            onClick={() => {
                                updateSettings({ selectedOscillator: 'phase' });
                                setShowOscillatorMenu(false);
                            }}
                            className={cn(
                                "w-full text-left px-2 py-1.5 text-[10px] rounded hover:bg-zinc-800 transition-colors mb-1",
                                settings.selectedOscillator === 'phase' ? "text-cyan-400 bg-zinc-800/50" : "text-zinc-400"
                            )}
                        >
                            Phase Squeezer
                        </button>
                        <button 
                            onClick={() => {
                                updateSettings({ selectedOscillator: 'supplydemand' });
                                setShowOscillatorMenu(false);
                            }}
                            className={cn(
                                "w-full text-left px-2 py-1.5 text-[10px] rounded hover:bg-zinc-800 transition-colors",
                                settings.selectedOscillator === 'supplydemand' ? "text-cyan-400 bg-zinc-800/50" : "text-zinc-400"
                            )}
                        >
                            Volume/Foot Pairs
                        </button>
                    </div>
                )}
              </div>
            )}
        </div>
      )}

      <div 
        ref={wrapperRef}
        className="flex-1 flex flex-col relative group overflow-hidden"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
            setHoveredZone(null);
            setIsDragging(false);
            setMousePos({ x: -1, y: -1 });
        }}
        onMouseUp={handleMouseUp}
      >
        {/* Ticker Overlay for Simplified Mode */}
        {simplified && (
          <div className="absolute top-2 left-3 z-30 pointer-events-none">
            <span className="text-sm font-bold text-white tracking-widest uppercase opacity-70">{symbol}</span>
            <span className="ml-2 text-[10px] font-mono text-zinc-500">1m</span>
          </div>
        )}

        <div 
            ref={containerRef} 
            className={cn(
                "flex-1 relative w-full",
                mousePos.x > dimensions.width - 60 ? "cursor-ns-resize" : 
                activeTool !== 'none' ? "cursor-crosshair" : "cursor-default"
            )}
            onMouseDown={handleMouseDown}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
        >
          <canvas ref={canvasRef} className="block" />

            {/* Context Menu */}
            {contextMenu && (
                <div 
                    className="absolute bg-zinc-900 border border-zinc-700 rounded shadow-xl p-1 z-50 flex flex-col gap-1 min-w-[120px]"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onMouseLeave={() => setContextMenu(null)}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            setDrawings(prev => prev.filter(d => d.id !== contextMenu.drawingId));
                            setContextMenu(null);
                            setSelectedDrawingId(null);
                        }}
                        className="flex items-center gap-2 px-2 py-1.5 text-xs text-red-400 hover:bg-zinc-800 rounded w-full text-left"
                    >
                        <Trash2 size={12} /> Delete
                    </button>
                    
                    {drawings.find(d => d.id === contextMenu.drawingId)?.type === 'line' && (
                        <>
                            <div className="h-px bg-zinc-800 my-0.5"></div>
                            <div className="px-2 py-1 text-[10px] text-zinc-500 font-bold">STYLE</div>
                            <div className="flex gap-1 px-2 pb-1">
                                {['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#ffffff'].map(c => (
                                    <button 
                                        key={c}
                                        className="w-4 h-4 rounded-full border border-zinc-700"
                                        style={{ backgroundColor: c }}
                                        onClick={() => {
                                            setDrawings(prev => prev.map(d => d.id === contextMenu.drawingId ? { ...d, style: { ...d.style, color: c } } : d));
                                            setLineSettings(prev => ({ ...prev, color: c }));
                                        }}
                                    />
                                ))}
                            </div>
                            
                            <div className="h-px bg-zinc-800 my-0.5"></div>
                            <div className="px-2 py-1 text-[10px] text-zinc-500 font-bold">THICKNESS</div>
                            <div className="flex gap-1 px-2 pb-1">
                                {[1, 2, 3, 4, 6, 8].map(w => (
                                    <button 
                                        key={w}
                                        className={cn(
                                            "w-6 h-5 rounded border border-zinc-700 flex items-center justify-center hover:bg-zinc-800 transition-colors",
                                            drawings.find(d => d.id === contextMenu.drawingId)?.style.lineWidth === w ? "bg-zinc-800 border-zinc-500" : "bg-zinc-900"
                                        )}
                                        onClick={() => {
                                            setDrawings(prev => prev.map(d => d.id === contextMenu.drawingId ? { ...d, style: { ...d.style, lineWidth: w } } : d));
                                            setLineSettings(prev => ({ ...prev, lineWidth: w }));
                                        }}
                                        title={`${w}px`}
                                    >
                                        <div className="bg-zinc-400 w-3 rounded-full" style={{ height: Math.max(1, w/2) }}></div>
                                    </button>
                                ))}
                            </div>
                            <div className="flex gap-1 px-2 pb-1">
                                <button 
                                    className="flex-1 py-1 text-[10px] bg-zinc-800 rounded hover:bg-zinc-700 text-zinc-300"
                                    onClick={() => {
                                        setDrawings(prev => prev.map(d => d.id === contextMenu.drawingId ? { ...d, style: { ...d.style, lineType: 'solid' } } : d));
                                        setLineSettings(prev => ({ ...prev, lineType: 'solid' }));
                                    }}
                                >Solid</button>
                                <button 
                                    className="flex-1 py-1 text-[10px] bg-zinc-800 rounded hover:bg-zinc-700 text-zinc-300"
                                    onClick={() => {
                                        setDrawings(prev => prev.map(d => d.id === contextMenu.drawingId ? { ...d, style: { ...d.style, lineType: 'dashed' } } : d));
                                        setLineSettings(prev => ({ ...prev, lineType: 'dashed' }));
                                    }}
                                >Dashed</button>
                            </div>
                        </>
                    )}

                    {drawings.find(d => d.id === contextMenu.drawingId)?.type === 'vol_bar_rect' && (
                        <>
                            <div className="h-px bg-zinc-800 my-0.5"></div>
                            <div className="px-2 py-1 text-[10px] text-zinc-500 font-bold">VISUALS</div>
                            {[
                                { label: 'Highlight VA', prop: 'showVA' },
                                { label: 'Show VA High', prop: 'showVAHighBeam' },
                                { label: 'Show VA Low', prop: 'showVALowBeam' },
                                { label: 'Show POC', prop: 'showPOCBeam' },
                                { label: 'Show LVN', prop: 'showLVNBeam' },
                            ].map(opt => {
                                const d = drawings.find(d => d.id === contextMenu.drawingId);
                                const isChecked = d?.volBarSettings?.[opt.prop as keyof NonNullable<typeof d.volBarSettings>];
                                return (
                                    <button
                                        key={opt.prop}
                                        className="flex items-center gap-2 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 rounded w-full text-left"
                                        onClick={() => {
                                            setDrawings(prev => prev.map(drawing => {
                                                if (drawing.id === contextMenu.drawingId) {
                                                    const currentSettings = drawing.volBarSettings || { numBars: 50, direction: 'ltr' };
                                                    const newSettings = { 
                                                        ...currentSettings, 
                                                        [opt.prop]: !currentSettings[opt.prop as keyof typeof currentSettings] 
                                                    };
                                                    return { ...drawing, volBarSettings: newSettings };
                                                }
                                                return drawing;
                                            }));
                                        }}
                                    >
                                        <div className={cn("w-3 h-3 rounded border border-zinc-600 flex items-center justify-center", isChecked ? "bg-blue-500 border-blue-500" : "")}>
                                            {isChecked && <Check size={8} className="text-white" />}
                                        </div>
                                        {opt.label}
                                    </button>
                                );
                            })}
                            <div className="h-px bg-zinc-800 my-0.5"></div>
                            <div className="px-2 py-1 text-[10px] text-zinc-500 font-bold uppercase">Max LVNs</div>
                            <div className="flex gap-1 px-2 pb-1">
                                {[1, 3, 5, 10].map(n => {
                                    const d = drawings.find(dx => dx.id === contextMenu.drawingId);
                                    const isActive = (d?.volBarSettings?.maxLVNs || 1) === n;
                                    return (
                                        <button 
                                            key={n}
                                            className={cn(
                                                "flex-1 py-1 text-[10px] rounded border border-zinc-700 hover:bg-zinc-800 transition-colors",
                                                isActive ? "bg-blue-500/20 text-blue-400 border-blue-500/50" : "bg-zinc-900 text-zinc-400"
                                            ) }
                                            onClick={() => {
                                                setDrawings(prev => prev.map(dx => {
                                                    if (dx.id === contextMenu.drawingId) {
                                                        const currentSettings = dx.volBarSettings || { numBars: 50, direction: 'ltr' };
                                                        return { ...dx, volBarSettings: { ...currentSettings, maxLVNs: n } };
                                                    }
                                                    return dx;
                                                }));
                                            }}
                                        >{n}</button>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    {contextMenu.drawingId === 'visible_range_vp' && (
                        <>
                            <div className="px-2 py-1 text-[10px] text-zinc-500 font-bold">VISIBLE RANGE VP</div>
                            {[
                                { label: 'Highlight VA', prop: 'visibleRangeVPShowVA' },
                                { label: 'Show VA High', prop: 'visibleRangeVPShowVAHigh' },
                                { label: 'Show VA Low', prop: 'visibleRangeVPShowVALow' },
                                { label: 'Show POC', prop: 'visibleRangeVPShowPOC' },
                                { label: 'Show LVN', prop: 'visibleRangeVPShowLVN' },
                            ].map(opt => {
                                const isChecked = settings[opt.prop as keyof typeof settings];
                                return (
                                    <button
                                        key={opt.prop}
                                        className="flex items-center gap-2 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 rounded w-full text-left"
                                        onClick={() => {
                                            updateSettings({ [opt.prop]: !isChecked });
                                        }}
                                    >
                                        <div className={cn("w-3 h-3 rounded border border-zinc-600 flex items-center justify-center", isChecked ? "bg-blue-500 border-blue-500" : "")}>
                                            {isChecked && <Check size={8} className="text-white" />}
                                        </div>
                                        {opt.label}
                                    </button>
                                );
                            })}
                            <div className="h-px bg-zinc-800 my-0.5"></div>
                            <div className="px-2 py-1 text-[10px] text-zinc-500 font-bold uppercase">Max LVNs</div>
                            <div className="flex gap-1 px-2 pb-1">
                                {[1, 3, 5, 10].map(n => {
                                    const isActive = settings.visibleRangeVPMaxLVNs === n;
                                    return (
                                        <button 
                                            key={n}
                                            className={cn(
                                                "flex-1 py-1 text-[10px] rounded border border-zinc-700 hover:bg-zinc-800 transition-colors",
                                                isActive ? "bg-blue-500/20 text-blue-400 border-blue-500/50" : "bg-zinc-900 text-zinc-400"
                                            ) }
                                            onClick={() => {
                                                updateSettings({ visibleRangeVPMaxLVNs: n });
                                            }}
                                        >{n}</button>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>
            )}

          {isLoadingHistory && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-blue-500/10 text-blue-400 px-3 py-1.5 rounded-full text-[10px] font-medium border border-blue-500/20 backdrop-blur-sm flex items-center gap-2 shadow-lg animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="w-2.5 h-2.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  Backfilling history...
              </div>
          )}

        {/* Zone Info Tooltip */}
      {showZoneInfo && hoveredZone && (
          <div 
            className="absolute z-30 bg-zinc-950/95 backdrop-blur border border-zinc-800 p-4 rounded-lg shadow-xl pointer-events-none min-w-[280px]"
            style={{ 
                left: Math.min(mousePos.x + 15, dimensions.width - 300), 
                top: Math.min(mousePos.y, dimensions.height - 180) 
            }}
          >
            {(() => {
                const asset = symbol.toUpperCase().replace('USDT', '');
                const notional = hoveredZone.volume * ((hoveredZone.top + hoveredZone.bottom) / 2);
                
                if (hoveredZone.category === 'IMBALANCE') {
                    const isSupply = hoveredZone.type === 'SUPPLY';
                    const gapType = isSupply ? 'Supply' : 'Demand';
                    const colorClass = isSupply ? "text-purple-400" : "text-cyan-400";
                    
                    return (
                        <div className="text-[11px] text-zinc-300 max-w-[280px] leading-relaxed font-sans">
                            <span className={cn("font-bold", colorClass)}>
                                {gapType} Inefficiency ${hoveredZone.size.toFixed(2)}
                            </span>
                            {" "}
                            <span className="text-zinc-500">
                                ({hoveredZone.strength?.toFixed(1)}x larger than avg. body ${marketStats.avgBody.toFixed(2)})
                            </span>
                            <br className="mb-2" />
                            Liquidity void between <span className="text-zinc-200">${hoveredZone.bottom.toFixed(2)}</span> and <span className="text-zinc-200">${hoveredZone.top.toFixed(2)}</span>
                            {" "}
                            with <span className="text-zinc-200">{hoveredZone.volume?.toFixed(4)} {asset}</span> traded during displacement
                            {" "}
                            <span className="text-zinc-500">(~{Math.round(notional).toLocaleString()} USDT)</span>.
                            {" "}
                            Aggressive {isSupply ? 'selling' : 'buying'} detected.
                        </div>
                    );
                } else if (hoveredZone.category === 'PERSISTENT') {
                    const isResistance = hoveredZone.type === 'RESISTANCE';
                    const colorClass = isResistance ? "text-rose-400" : "text-emerald-400";
                    
                    return (
                        <div className="text-[11px] text-zinc-300 max-w-[280px] leading-relaxed font-sans">
                            <span className={cn("font-bold", colorClass)}>
                                Persistent {isResistance ? 'Resistance' : 'Support'} Cluster
                            </span>
                            {" "}
                            <span className="text-zinc-500">
                                ({hoveredZone.strength?.toFixed(1)}x avg volume)
                            </span>
                            <br className="mb-2" />
                            Confirmed {isResistance ? 'rejection' : 'bounce'} at <span className="text-zinc-200">${isResistance ? hoveredZone.top.toFixed(2) : hoveredZone.bottom.toFixed(2)}</span>.
                            <br />
                            Test Count: <span className="text-zinc-200">{hoveredZone.touches || 1} touches</span>
                            <br />
                            Traded volume: <span className="text-zinc-200">{hoveredZone.volume?.toFixed(4)} {asset}</span>
                            {" "}
                            <span className="text-zinc-500">(~{Math.round(notional).toLocaleString()} USDT)</span>.
                            
                            {/* ML Info */}
                            {settings.mlMode && (hoveredZone as any).mlScore !== undefined && (
                                <>
                                    <br />
                                    <div className="mt-2 pt-2 border-t border-zinc-800">
                                        <span className="text-blue-400 font-bold">ML Relevance: {(hoveredZone as any).mlScore.toFixed(2)}</span>
                                        {(hoveredZone as any).mergedCount && (hoveredZone as any).mergedCount > 1 && (
                                            <span className="text-zinc-500 ml-2">(Merged from {(hoveredZone as any).mergedCount} zones)</span>
                                        )}
                                    </div>
                                </>
                            )}

                            <br />
                            <span className="text-zinc-500 italic">Active until true breakout (body close).</span>
                        </div>
                    );
                } else {
                    return (
                        <div className="text-[11px] text-zinc-300 max-w-[280px] leading-relaxed font-sans">
                            <span className="text-zinc-300 font-bold">Absorption Cluster</span>
                            {" "}
                            <span className="text-zinc-500">
                                ({hoveredZone.strength?.toFixed(1)}x {hoveredZone.strength >= 1 ? 'larger' : 'smaller'} than avg volume)
                            </span>
                            <br className="mb-2" />
                            Traded volume of <span className="text-zinc-200">{hoveredZone.volume?.toFixed(4)} {asset}</span>
                            {" "}
                            <span className="text-zinc-500">(~{Math.round(notional).toLocaleString()} USDT)</span>
                            {" "}
                            absorbed between <span className="text-zinc-200">${hoveredZone.bottom.toFixed(2)}</span> and <span className="text-zinc-200">${hoveredZone.top.toFixed(2)}</span>.
                        </div>
                    );
                }
            })()}
          </div>
      )}

      {/* Footprint Info Tooltip */}
      {showFootprintInfo && hoveredFootprint && (
          <div 
            className="absolute z-30 bg-zinc-950/95 backdrop-blur border border-zinc-800 p-4 rounded-lg shadow-xl pointer-events-none min-w-[280px]"
            style={{ 
                left: Math.min(mousePos.x + 15, dimensions.width - 300), 
                top: Math.min(mousePos.y, dimensions.height - 180) 
            }}
          >
            {(() => {
                const { level } = hoveredFootprint;
                const totalVol = level.buyVolume + level.sellVolume;
                const delta = level.buyVolume - level.sellVolume;
                const deltaColor = delta > 0 ? "text-cyan-400" : delta < 0 ? "text-purple-400" : "text-zinc-400";
                const isBuyImbalance = level.buyVolume > level.sellVolume * 3;
                const isSellImbalance = level.sellVolume > level.buyVolume * 3;

                return (
                    <div className="text-[11px] text-zinc-300 max-w-[280px] leading-relaxed font-sans">
                        <span className="font-bold text-zinc-200">
                            Price Level: ${level.price.toFixed(2)}
                        </span>
                        <br className="mb-2" />
                        <div className="grid grid-cols-2 gap-2 mt-2">
                            <div>
                                <span className="text-zinc-500">Bid (Sellers)</span>
                                <br />
                                <span className={cn("font-bold", isSellImbalance ? "text-blue-400" : "text-purple-400")}>
                                    {level.sellVolume < 1 ? level.sellVolume.toFixed(4) : level.sellVolume.toFixed(2)} <span className="text-[10px] text-zinc-500 font-normal">USDT</span>
                                </span>
                            </div>
                            <div>
                                <span className="text-zinc-500">Ask (Buyers)</span>
                                <br />
                                <span className={cn("font-bold", isBuyImbalance ? "text-blue-400" : "text-cyan-400")}>
                                    {level.buyVolume < 1 ? level.buyVolume.toFixed(4) : level.buyVolume.toFixed(2)} <span className="text-[10px] text-zinc-500 font-normal">USDT</span>
                                </span>
                            </div>
                        </div>
                        <div className="mt-2 pt-2 border-t border-zinc-800">
                            <span className="text-zinc-500">Total Vol: </span>
                            <span className="text-zinc-200">{totalVol < 1 ? totalVol.toFixed(4) : totalVol.toFixed(2)} <span className="text-[10px] text-zinc-500 font-normal">USDT</span></span>
                            <br />
                            <span className="text-zinc-500">Delta: </span>
                            <span className={cn("font-bold", deltaColor)}>
                                {delta > 0 ? '+' : ''}{Math.abs(delta) < 1 ? delta.toFixed(4) : delta.toFixed(2)} <span className="text-[10px] text-zinc-500 font-normal">USDT</span>
                            </span>
                        </div>
                        {(isBuyImbalance || isSellImbalance) && (
                            <div className="mt-2 text-blue-400 font-bold">
                                {isBuyImbalance ? 'Buy Imbalance Detected' : 'Sell Imbalance Detected'}
                            </div>
                        )}
                        
                        {/* Position Imbalance Info */}
                        {(() => {
                            const { candle } = hoveredFootprint;
                            // Calculate Flags
                            let maxVol = 0;
                            let totalVolAtPOC = 0;
                            let deltaAtPOC = 0;
                            let deltaAtHigh = 0;
                            let deltaAtLow = 0;
                            let highPrice = -Infinity;
                            let lowPrice = Infinity;
                            let buyVolInTop30 = 0;
                            let sellVolInTop30 = 0;
                            
                            const range = candle.high - candle.low;
                            const top30Threshold = candle.low + range * 0.7;

                            Object.values(candle.footprint).forEach((l: any) => {
                                const totalVol = l.buyVolume + l.sellVolume;
                                if (totalVol > maxVol) {
                                    maxVol = totalVol;
                                    totalVolAtPOC = totalVol;
                                    deltaAtPOC = l.delta;
                                }
                                
                                if (l.price > highPrice) { highPrice = l.price; deltaAtHigh = l.delta; }
                                if (l.price < lowPrice) { lowPrice = l.price; deltaAtLow = l.delta; }
                                
                                if (l.price >= top30Threshold) {
                                    buyVolInTop30 += l.buyVolume;
                                    sellVolInTop30 += l.sellVolume;
                                }
                            });

                            const top30Imbalance = buyVolInTop30 > sellVolInTop30 * 2.5 && sellVolInTop30 > 0;
                            const pocImbalance = Math.abs(deltaAtPOC) > totalVolAtPOC * 0.4;
                            const isHighImbalance = Math.abs(deltaAtHigh) > (maxVol * 0.1) * 3;
                            const isLowImbalance = Math.abs(deltaAtLow) > (maxVol * 0.1) * 3;

                            if (!top30Imbalance && !pocImbalance && !isHighImbalance && !isLowImbalance) return null;

                            return (
                                <div className="mt-2 pt-2 border-t border-zinc-800 space-y-1">
                                    {top30Imbalance && <div className="text-red-400">✓ Top 30% Sell Imbalance</div>}
                                    {pocImbalance && <div className="text-yellow-400">✓ POC Imbalance ({Math.abs(deltaAtPOC/totalVolAtPOC).toFixed(1)} ratio)</div>}
                                    {isHighImbalance && <div className="text-red-400">✓ High Imbalance</div>}
                                    {isLowImbalance && <div className="text-green-400">✓ Low Imbalance</div>}
                                </div>
                            );
                        })()}
                    </div>
                );
            })()}
          </div>
      )}

      {showSettings && (
        <div 
            className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl p-4 w-[320px] max-h-[80vh] overflow-y-auto"
            onMouseDown={(e) => e.stopPropagation()}
        >
            <div className="flex items-center justify-between mb-4 sticky top-0 bg-zinc-950 pb-2 border-b border-zinc-800 z-10">
                <h3 className="font-bold text-zinc-200 text-xs">Chart Analysis Settings</h3>
                <button 
                    onClick={() => onToggleSettings?.()}
                    className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors"
                >
                    <X size={14} />
                </button>
            </div>
            
            <div className="space-y-4">
                {/* Oscillator Selection */}
                <div className="border-b border-zinc-800 pb-3">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] text-zinc-400">Oscillator Type</span>
                        <select 
                            value={settings.selectedOscillator || 'phase'} 
                            onChange={e => updateSettings({ selectedOscillator: e.target.value as 'phase' | 'supplydemand' })}
                            className="bg-zinc-950 border border-zinc-800 rounded text-[10px] px-2 py-1 text-zinc-200"
                        >
                            <option value="phase">Phase Squeezer</option>
                            <option value="supplydemand">Volume Foot Oscillator</option>
                        </select>
                    </div>

                    {/* Volume Foot Oscillator Settings */}
                    {settings.selectedOscillator === 'supplydemand' && (
                        <div className="mt-3 space-y-2 pl-2 border-l border-zinc-800">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-zinc-400">Right Bar Mode</span>
                                <select 
                                    value={settings.footOscMode || 'strongestStack'} 
                                    onChange={e => updateSettings({ footOscMode: e.target.value as any })}
                                    className="bg-zinc-950 border border-zinc-800 rounded text-[10px] px-2 py-1 text-zinc-200"
                                >
                                    <option value="strongestStack">Strongest Stack</option>
                                    <option value="totalDelta">Total Delta</option>
                                </select>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-zinc-400">Show Net Delta Line</span>
                                <input 
                                    type="checkbox" 
                                    checked={settings.showNetDeltaLine ?? true} 
                                    onChange={e => updateSettings({ showNetDeltaLine: e.target.checked })} 
                                    className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500" 
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-zinc-400">Show Tooltips</span>
                                <input 
                                    type="checkbox" 
                                    checked={settings.showFootOscTooltips ?? true} 
                                    onChange={e => updateSettings({ showFootOscTooltips: e.target.checked })} 
                                    className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500" 
                                />
                            </div>
                            <div className="flex justify-between items-center bg-zinc-950/50 p-1.5 rounded border border-zinc-800/50">
                                <span className="text-[10px] text-zinc-400">Min Stack Ratio</span>
                                <input 
                                    type="number" 
                                    step="0.1" 
                                    value={Number.isNaN(settings.minStackRatio) ? 3.0 : settings.minStackRatio} 
                                    onChange={e => updateSettings({ minStackRatio: parseFloat(e.target.value) })} 
                                    className="w-12 bg-zinc-900 border border-zinc-700 text-[10px] text-center rounded focus:ring-1 focus:ring-cyan-500" 
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <div className="flex justify-between">
                                    <span className="text-[10px] text-zinc-400">Bar Opacity</span>
                                    <span className="text-[10px] text-zinc-400">{settings.barOpacity ?? 80}%</span>
                                </div>
                                <input 
                                    type="range" 
                                    min="10" 
                                    max="100" 
                                    value={Number.isNaN(settings.barOpacity) ? 80 : settings.barOpacity} 
                                    onChange={e => updateSettings({ barOpacity: parseInt(e.target.value) })} 
                                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500" 
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Adaptive Phase Squeezer */}
                <div className="border-b border-zinc-800 pb-3">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Adaptive Phase Squeezer</h4>
                        <select 
                            value={squeezer.config.preset}
                            onChange={(e) => squeezer.setConfig({ preset: e.target.value as any })}
                            className="bg-zinc-950 border border-zinc-800 rounded text-[10px] text-zinc-300 px-2 py-1"
                        >
                            <option>Standard Mode</option>
                            <option>Machine Learning Mode</option>
                        </select>
                    </div>
                    
                    <div className="text-[9px] text-zinc-500 italic mb-3 px-1">
                        {squeezer.config.preset === 'Standard Mode' && "Follows the official Technical Reference Manual settings. ML is disabled."}
                        {squeezer.config.preset === 'Machine Learning Mode' && "Enables the local TensorFlow.js engine to learn and predict Squeeze breakouts."}
                    </div>

                    {/* Squeeze Engine */}
                    <div className="space-y-2 mt-2">
                        <label className="text-[10px] text-zinc-500 font-bold uppercase">1. Squeeze Engine (Volatility)</label>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="flex justify-between items-center bg-zinc-950/50 p-1.5 rounded border border-zinc-800/50" title="Standard lookback period for Bollinger Bands and Keltner Channels. A setting of 20 is the industry standard for identifying volatility compression.">
                                <span className="text-[10px] text-zinc-400">Length</span>
                                <input type="number" value={Number.isNaN(squeezer.config.sqzLen) ? '' : squeezer.config.sqzLen} onChange={e => squeezer.setConfig({sqzLen: e.target.value === '' ? NaN : Number(e.target.value)})} className="w-12 bg-zinc-900 border border-zinc-700 text-[10px] text-center rounded focus:ring-1 focus:ring-cyan-500" />
                            </div>
                            <div className="flex justify-between items-center bg-zinc-950/50 p-1.5 rounded border border-zinc-800/50" title="Standard Deviation multiplier. Controls how wide the Bollinger Bands are. Tighter bands (lower value) make it harder to trigger a squeeze.">
                                <span className="text-[10px] text-zinc-400">BB Mult</span>
                                <input type="number" step="0.1" value={Number.isNaN(squeezer.config.bbMult) ? '' : squeezer.config.bbMult} onChange={e => squeezer.setConfig({bbMult: e.target.value === '' ? NaN : Number(e.target.value)})} className="w-12 bg-zinc-900 border border-zinc-700 text-[10px] text-center rounded focus:ring-1 focus:ring-cyan-500" />
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2" title="Keltner Channel multipliers define the squeeze intensity zones.&#10;&#10;• High (Orange): Extreme compression, explosive move imminent.&#10;• Mid (Silver): Strong compression (Trade Setup Zone).&#10;• Low (Black): Mild compression (Pre-Setup).">
                            <div className="flex flex-col items-center bg-zinc-950/50 p-1.5 rounded border border-zinc-800/50">
                                <span className="text-[10px] text-orange-400">KC High</span>
                                <input type="number" step="0.1" value={Number.isNaN(squeezer.config.kcMultHigh) ? '' : squeezer.config.kcMultHigh} onChange={e => squeezer.setConfig({kcMultHigh: e.target.value === '' ? NaN : Number(e.target.value)})} className="w-full mt-1 bg-zinc-900 border border-zinc-700 text-[10px] text-center rounded focus:ring-1 focus:ring-cyan-500" />
                            </div>
                            <div className="flex flex-col items-center bg-zinc-950/50 p-1.5 rounded border border-zinc-800/50">
                                <span className="text-[10px] text-zinc-300">KC Mid</span>
                                <input type="number" step="0.1" value={Number.isNaN(squeezer.config.kcMultMid) ? '' : squeezer.config.kcMultMid} onChange={e => squeezer.setConfig({kcMultMid: e.target.value === '' ? NaN : Number(e.target.value)})} className="w-full mt-1 bg-zinc-900 border border-zinc-700 text-[10px] text-center rounded focus:ring-1 focus:ring-cyan-500" />
                            </div>
                            <div className="flex flex-col items-center bg-zinc-950/50 p-1.5 rounded border border-zinc-800/50">
                                <span className="text-[10px] text-zinc-500">KC Low</span>
                                <input type="number" step="0.1" value={Number.isNaN(squeezer.config.kcMultLow) ? '' : squeezer.config.kcMultLow} onChange={e => squeezer.setConfig({kcMultLow: e.target.value === '' ? NaN : Number(e.target.value)})} className="w-full mt-1 bg-zinc-900 border border-zinc-700 text-[10px] text-center rounded focus:ring-1 focus:ring-cyan-500" />
                            </div>
                        </div>
                    </div>

                    {/* Market Phase Oscillator */}
                    <div className="space-y-2 mt-3 pt-3 border-t border-zinc-800/50">
                        <label className="text-[10px] text-zinc-500 font-bold uppercase">2. Market Phase Oscillator</label>
                        <div className="flex items-center justify-between mt-1" title="If enabled, the oscillator color adapts to the market cycle:&#10;&#10;• Gray Zone: Phase 1 (Recharge/Noise). Momentum is inside the volatility tunnel.&#10;• Colored: Phase 2/3 (Expansion/Trend). Momentum breaks out of the tunnel.">
                            <span className="text-[10px] text-zinc-400">Show Market Phases</span>
                            <input type="checkbox" checked={squeezer.config.showPhases} onChange={e => squeezer.setConfig({showPhases: e.target.checked})} className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500" />
                        </div>
                        <div className="flex items-center justify-between mt-1">
                            <span className="text-[10px] text-zinc-400">Show Oscillator Pane</span>
                            <input type="checkbox" checked={showOscillator} onChange={e => setShowOscillator(e.target.checked)} className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500" />
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-1">
                            <div className="flex justify-between items-center bg-zinc-950/50 p-1.5 rounded border border-zinc-800/50" title="Lookback period to calculate the 'normal' noise level of momentum. Higher values create a more stable tunnel.">
                                <span className="text-[10px] text-zinc-400">Phase Len</span>
                                <input type="number" value={Number.isNaN(squeezer.config.phaseLen) ? '' : squeezer.config.phaseLen} onChange={e => squeezer.setConfig({phaseLen: e.target.value === '' ? NaN : Number(e.target.value)})} className="w-12 bg-zinc-900 border border-zinc-700 text-[10px] text-center rounded focus:ring-1 focus:ring-cyan-500" />
                            </div>
                            <div className="flex justify-between items-center bg-zinc-950/50 p-1.5 rounded border border-zinc-800/50" title="Multiplies the standard deviation of momentum. Increase this to filter out more fake-outs.">
                                <span className="text-[10px] text-zinc-400">Tunnel Width</span>
                                <input type="number" step="0.1" value={Number.isNaN(squeezer.config.phaseMult) ? '' : squeezer.config.phaseMult} onChange={e => squeezer.setConfig({phaseMult: e.target.value === '' ? NaN : Number(e.target.value)})} className="w-12 bg-zinc-900 border border-zinc-700 text-[10px] text-center rounded focus:ring-1 focus:ring-cyan-500" />
                            </div>
                        </div>
                    </div>

                    {/* Structure Boxes */}
                    <div className="space-y-2 mt-3 pt-3 border-t border-zinc-800/50">
                        <label className="text-[10px] text-zinc-500 font-bold uppercase">3. Structure Boxes (Chart Overlay)</label>
                        <div className="flex items-center justify-between mt-1" title="Draws rectangles on the chart identifying the price range during a squeeze phase.">
                            <span className="text-[10px] text-zinc-400">Show Squeeze Boxes</span>
                            <input type="checkbox" checked={squeezer.config.showBoxes} onChange={e => squeezer.setConfig({showBoxes: e.target.checked})} className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500" />
                        </div>
                        <div className="flex flex-col gap-1 mt-1" title="Determines which squeeze intensity starts a box.&#10;&#10;• Orange: Extreme compression only.&#10;• Silver: Focus on high-probability setups.&#10;• Black: Includes early warning signs (more boxes).">
                            <span className="text-[10px] text-zinc-400">Box Trigger Zone</span>
                            <select value={squeezer.config.boxTriggerMode} onChange={e => squeezer.setConfig({boxTriggerMode: +e.target.value as any})} className="bg-zinc-950 border border-zinc-800 rounded text-[10px] text-zinc-300 px-2 py-1">
                                <option value={SqueezeState.HIGH}>High Squeeze (Orange)</option>
                                <option value={SqueezeState.MID}>Mid Squeeze (Silver)</option>
                                <option value={SqueezeState.LOW}>Low Squeeze (Gray)</option>
                            </select>
                        </div>
                        <div className="flex justify-between items-center bg-zinc-950/50 p-1.5 rounded border border-zinc-800/50 mt-1" title="How many consecutive squeeze dots are required to validate a structure box. Filters out single-dot noise.">
                            <span className="text-[10px] text-zinc-400">Min. Dots Sequence</span>
                            <input type="number" min="1" value={Number.isNaN(squeezer.config.minDotSequence) ? '' : squeezer.config.minDotSequence} onChange={e => squeezer.setConfig({minDotSequence: e.target.value === '' ? NaN : Number(e.target.value)})} className="w-12 bg-zinc-900 border border-zinc-700 text-[10px] text-center rounded focus:ring-1 focus:ring-cyan-500" />
                        </div>
                    </div>

                    {/* Interest Lines */}
                    <div className="space-y-2 mt-3 pt-3 border-t border-zinc-800/50">
                        <label className="text-[10px] text-zinc-500 font-bold uppercase">4. Interest Lines (Equilibrium)</label>
                        <div className="flex items-center justify-between mt-1" title="Plots the key level derived from the Squeeze Box. This is your primary equilibrium level for the current structure.">
                            <span className="text-[10px] text-zinc-400">Show Interest Line</span>
                            <input type="checkbox" checked={squeezer.config.showInterestLine} onChange={e => squeezer.setConfig({showInterestLine: e.target.checked})} className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500" />
                        </div>
                        <div className="flex flex-col gap-1 mt-1" title="• Gap Induced: Hunts for Fair Value Gaps inside the box. Best for Smart Money Concepts.&#10;• Box Midpoint: Uses the geometric center of the squeeze range. Best for classical technical analysis.">
                            <span className="text-[10px] text-zinc-400">Calculation Mode</span>
                            <select value={squeezer.config.calcMode} onChange={e => squeezer.setConfig({calcMode: e.target.value as any})} className="bg-zinc-950 border border-zinc-800 rounded text-[10px] text-zinc-300 px-2 py-1">
                                <option value="Gap Induced">Gap Induced</option>
                                <option value="Box Midpoint">Box Midpoint</option>
                            </select>
                        </div>
                        {squeezer.config.calcMode === 'Gap Induced' && (
                            <div className="flex flex-col gap-1 mt-1" title="Only relevant for 'Gap Induced' mode:&#10;If NO gap is found in a box, should we update the line to the box middle or keep the old level?">
                                <span className="text-[10px] text-zinc-400">Gap Fallback Logic</span>
                                <select value={squeezer.config.boxFallback} onChange={e => squeezer.setConfig({boxFallback: e.target.value as any})} className="bg-zinc-950 border border-zinc-800 rounded text-[10px] text-zinc-300 px-2 py-1">
                                    <option value="Ignore Box">Ignore Box</option>
                                    <option value="Use Box Midpoint">Use Box Midpoint</option>
                                </select>
                            </div>
                        )}
                        <div className="flex items-center justify-between mt-1" title="If checked, the Interest Line changes color based on the current Squeeze Status (Blue/Black/Silver/Orange).">
                            <span className="text-[10px] text-zinc-400">Dynamic Line Color</span>
                            <input type="checkbox" checked={squeezer.config.dynamicLineColor} onChange={e => squeezer.setConfig({dynamicLineColor: e.target.checked})} className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500" />
                        </div>
                    </div>

                    {/* Zero-Lag Trendline */}
                    <div className="space-y-2 mt-3 pt-3 border-t border-zinc-800/50">
                        <label className="text-[10px] text-zinc-500 font-bold uppercase">5. Zero-Lag Trendline</label>
                        <div className="flex items-center justify-between mt-1" title="Enables a fast-reacting line that updates immediately when ANY new gap is detected, regardless of squeeze boxes. Useful for trailing stops or scalping.">
                            <span className="text-[10px] text-zinc-400">Show Zero-Lag Line</span>
                            <input type="checkbox" checked={squeezer.config.showZeroLag} onChange={e => squeezer.setConfig({showZeroLag: e.target.checked})} className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500" />
                        </div>
                    </div>

                    {/* Adaptive Learning (ML) */}
                    <div className="space-y-2 pt-3 mt-3 border-t border-zinc-800/50">
                        <div className="flex items-center justify-between" title="The Smart Learning Engine tracks historical breakout success rates and recent volatility to auto-tune the Phase Tunnel (Length & Width). It also scores each Squeeze Box with a Confidence % based on intensity, duration, footprint delta, and historical success.">
                            <div className="flex items-center gap-1">
                                <label className="text-[10px] text-purple-400 font-bold uppercase flex items-center gap-1">
                                    <Zap size={10} /> Smart Learning Engine
                                </label>
                            </div>
                            <input type="checkbox" checked={squeezer.config.enableML} onChange={e => squeezer.setConfig({enableML: e.target.checked})} className="rounded border-zinc-700 bg-zinc-900 text-purple-500 focus:ring-purple-500" />
                        </div>
                        {squeezer.config.enableML && (
                            <div className="grid grid-cols-1 gap-2 pl-2 border-l-2 border-purple-500/30 mt-2">
                                <div className="flex justify-between items-center bg-zinc-950/50 p-1.5 rounded border border-zinc-800/50">
                                    <span className="text-[10px] text-zinc-400" title="Minimum Confidence % to display a Swing Area">Min Confidence Filter</span>
                                    <div className="flex items-center gap-1">
                                        <input type="range" min="0" max="100" value={Number.isNaN(squeezer.config.minConfidenceThreshold) ? 0 : squeezer.config.minConfidenceThreshold} onChange={e => squeezer.setConfig({minConfidenceThreshold: e.target.value === '' ? NaN : Number(e.target.value)})} className="w-16 accent-purple-500" />
                                        <span className="text-[10px] text-zinc-300 w-6 text-right">{squeezer.config.minConfidenceThreshold}%</span>
                                    </div>
                                </div>
                                <div className="flex justify-between items-center bg-zinc-950/50 p-1.5 rounded border border-zinc-800/50">
                                    <span className="text-[10px] text-zinc-400" title="Auto-retrain model every X days (0 = Manual)">Auto-Retrain Days</span>
                                    <input type="number" min="0" max="30" value={squeezer.config.autoRetrainDays || 0} onChange={e => squeezer.setConfig({autoRetrainDays: Number(e.target.value)})} className="w-12 bg-zinc-900 border border-zinc-700 text-[10px] text-center rounded focus:ring-1 focus:ring-purple-500" />
                                </div>
                                <div className="flex justify-between items-center bg-zinc-950/50 p-1.5 rounded border border-zinc-800/50">
                                    <div className="flex flex-col">
                                        <span className="text-[10px] text-zinc-400">ML Status</span>
                                        <span className="text-[9px] text-zinc-500 italic">{squeezer.mlStatus}</span>
                                    </div>
                                    <button onClick={squeezer.forceRetrain} className="px-2 py-1 bg-purple-900/30 hover:bg-purple-900/50 border border-purple-500/30 rounded text-[9px] text-purple-300 transition-colors">
                                        Force Retrain
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Horizontal Volume Bars */}
                <div className="border-b border-zinc-800 pb-3">
                    <h4 className="text-zinc-400 font-bold mb-2">Horizontal Volume Bars</h4>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between" title="Direction of the volume bars.">
                            <span className="text-[10px] text-zinc-400">Drawing Direction</span>
                            <select 
                                value={settings.volBarsDirection || 'ltr'} 
                                onChange={e => updateSettings({volBarsDirection: e.target.value as 'ltr' | 'rtl'})}
                                className="bg-zinc-950 border border-zinc-800 rounded text-[10px] text-zinc-300 px-2 py-1"
                            >
                                <option value="ltr">Left to Right</option>
                                <option value="rtl">Right to Left</option>
                            </select>
                        </div>
                        <div className="flex items-center justify-between" title="Show Volume Profile for the visible range.">
                            <span className="text-[10px] text-zinc-400">Visible Range VP</span>
                            <input type="checkbox" checked={settings.visibleRangeVolumeProfile} onChange={e => updateSettings({visibleRangeVolumeProfile: e.target.checked})} className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500" />
                        </div>
                        {settings.visibleRangeVolumeProfile && (
                            <div className="space-y-3 pl-2 border-l border-cyan-500/30">
                                <div className="flex flex-col gap-1">
                                    <div className="flex justify-between">
                                        <span className="text-[10px] text-zinc-400">VP Opacity</span>
                                        <span className="text-[10px] text-zinc-400">{settings.visibleRangeVolumeProfileOpacity ?? 65}%</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="10" 
                                        max="100" 
                                        value={Number.isNaN(settings.visibleRangeVolumeProfileOpacity) ? 65 : settings.visibleRangeVolumeProfileOpacity} 
                                        onChange={e => updateSettings({ visibleRangeVolumeProfileOpacity: parseInt(e.target.value) })} 
                                        className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500" 
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <div className="flex justify-between">
                                        <span className="text-[10px] text-zinc-400">Resolution (Bins)</span>
                                        <span className="text-[10px] text-zinc-400">{settings.visibleRangeVPNumBins || 100}</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="10" 
                                        max="300" 
                                        step="10"
                                        value={settings.visibleRangeVPNumBins || 100} 
                                        onChange={e => updateSettings({ visibleRangeVPNumBins: parseInt(e.target.value) })} 
                                        className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500" 
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <div className="flex justify-between">
                                        <span className="text-[10px] text-zinc-400">Max LVNs</span>
                                        <span className="text-[10px] text-zinc-400">{settings.visibleRangeVPMaxLVNs}</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="1" 
                                        max="10" 
                                        value={settings.visibleRangeVPMaxLVNs || 3} 
                                        onChange={e => updateSettings({ visibleRangeVPMaxLVNs: parseInt(e.target.value) })} 
                                        className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-500" 
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <div className="flex justify-between">
                                        <span className="text-[10px] text-zinc-400" title="Sensitivity of LVN detection. Higher = only show deeper valleys.">LVN Sensitivity</span>
                                        <span className="text-[10px] text-zinc-400">{((settings.visibleRangeVPMinLVNDepth || 0.1) * 100).toFixed(0)}%</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="0" 
                                        max="1" 
                                        step="0.05"
                                        value={settings.visibleRangeVPMinLVNDepth || 0.1} 
                                        onChange={e => updateSettings({ visibleRangeVPMinLVNDepth: parseFloat(e.target.value) })} 
                                        className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-500" 
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footprint Settings */}
                <div className="border-b border-zinc-800 pb-3">
                    <h4 className="text-zinc-400 font-bold mb-2">Footprint Aggregation</h4>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between" title="Enables/disables the entire footprint display on the chart.">
                            <span className="text-[10px] text-zinc-400">Show Footprints On Chart</span>
                            <input type="checkbox" checked={settings.showFootprintsOnChart} onChange={e => updateSettings({showFootprintsOnChart: e.target.checked})} className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500" />
                        </div>
                        <div className="flex items-center justify-between" title="Automatically adjusts aggregation based on current volatility/zoom.">
                            <span className="text-[10px] text-zinc-400">Auto Aggregation</span>
                            <input type="checkbox" checked={settings.autoAggregation} onChange={e => updateSettings({autoAggregation: e.target.checked})} className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500" />
                        </div>
                        <div className={cn("flex justify-between items-center bg-zinc-950/50 p-1.5 rounded border border-zinc-800/50", settings.autoAggregation && "opacity-50 pointer-events-none")} title="Chart Footprint Aggregation – Higher = cleaner blocks (recommended 40–80)">
                            <span className="text-[10px] text-zinc-400">Chart Aggregation (Ticks)</span>
                            <input type="number" min="1" max="200" value={Number.isNaN(settings.chartFootprintTicksPerRow) ? '' : settings.chartFootprintTicksPerRow} onChange={e => updateSettings({chartFootprintTicksPerRow: e.target.value ? Number(e.target.value) : 64})} className="w-12 bg-zinc-900 border border-zinc-700 text-[10px] text-center rounded focus:ring-1 focus:ring-cyan-500" />
                        </div>
                        <div className="flex justify-between items-center bg-zinc-950/50 p-1.5 rounded border border-zinc-800/50" title="Usually kept at 1–2 so that real-time changes remain visible in the tape.">
                            <span className="text-[10px] text-zinc-400">Tape Aggregation (Ticks)</span>
                            <input type="number" min="1" max="20" value={Number.isNaN(settings.tapeFootprintTicksPerRow) ? '' : settings.tapeFootprintTicksPerRow} onChange={e => updateSettings({tapeFootprintTicksPerRow: e.target.value ? Number(e.target.value) : 2})} className="w-12 bg-zinc-900 border border-zinc-700 text-[10px] text-center rounded focus:ring-1 focus:ring-cyan-500" />
                        </div>
                    </div>
                </div>

                {/* Analysis Period */}
                <div className="border-b border-zinc-800 pb-3">
                    <h4 className="text-zinc-400 font-bold mb-2">Analysis Period</h4>
                    <div className="space-y-2">
                        <div>
                            <label className="block text-zinc-500 mb-1">Mode</label>
                            <select 
                                value={settings.lookbackType} 
                                onChange={e => {
                                    const newType = e.target.value as any;
                                    let newValue = 233;
                                    if (newType === 'Minutes') newValue = 15;
                                    if (newType === 'Hours') newValue = 24;
                                    updateSettings({lookbackType: newType, lookbackValue: newValue});
                                }} 
                                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200"
                            >
                                <option value="Candles">Lookback Periods</option>
                                <option value="Minutes">Lookback Minutes</option>
                                <option value="Hours">Lookback Hours</option>
                                <option value="Since Open">Since Open</option>
                            </select>
                        </div>
                        
                        {settings.lookbackType !== 'Since Open' ? (
                            <div>
                                <label className="block text-zinc-500 mb-1">Value</label>
                                <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded overflow-hidden">
                                    <input 
                                        type="number" 
                                        value={Number.isNaN(settings.lookbackValue) ? '' : settings.lookbackValue} 
                                        onChange={e => updateSettings({lookbackValue: parseInt(e.target.value)})} 
                                        className="flex-1 bg-transparent border-none px-2 py-1 text-zinc-200 focus:ring-0 text-right appearance-none" 
                                        min={1}
                                    />
                                    <span className="px-2 py-1 bg-zinc-900 border-l border-zinc-800 text-zinc-500 text-[10px] min-w-[30px] text-center">
                                        {settings.lookbackType === 'Candles' ? 'periods' : settings.lookbackType === 'Minutes' ? 'min' : 'hrs'}
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <label className="block text-zinc-500 mb-1">Region</label>
                                <select 
                                    value={settings.sinceOpenRegion} 
                                    onChange={e => updateSettings({sinceOpenRegion: e.target.value as any})} 
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200"
                                >
                                    <option value="US_OPEN">USA New York</option>
                                    <option value="EU_OPEN">Europe London/Frankfurt</option>
                                    <option value="ASIA_OPEN">Asia Tokio</option>
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                {/* Absorption Zones */}
                <div className="border-b border-zinc-800 pb-3">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-zinc-400 font-bold">Absorption Zones</h4>
                        <input 
                            type="checkbox" 
                            checked={settings.absorptionEnabled} 
                            onChange={e => updateSettings({absorptionEnabled: e.target.checked})} 
                        />
                    </div>
                    {settings.absorptionEnabled && (
                        <div className="space-y-2 pl-2 border-l border-zinc-800">
                            <div>
                                <label className="block text-zinc-500 mb-1">Min Volume Multiplier</label>
                                <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded overflow-hidden">
                                    <input 
                                        type="number" 
                                        step="0.1" 
                                        value={Number.isNaN(settings.absorptionVolMult) ? '' : settings.absorptionVolMult} 
                                        onChange={e => updateSettings({absorptionVolMult: parseFloat(e.target.value)})} 
                                        className="flex-1 bg-transparent border-none px-2 py-1 text-zinc-200 focus:ring-0 text-right appearance-none" 
                                    />
                                    <span className="px-2 py-1 bg-zinc-900 border-l border-zinc-800 text-zinc-500 text-[10px] min-w-[30px] text-center">x</span>
                                </div>
                            </div>
                            <div>
                                <label className="block text-zinc-500 mb-1">Show Max Zones</label>
                                <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded overflow-hidden">
                                    <input 
                                        type="number" 
                                        value={Number.isNaN(settings.absorptionCount) ? '' : settings.absorptionCount} 
                                        onChange={e => updateSettings({absorptionCount: parseInt(e.target.value)})} 
                                        className="flex-1 bg-transparent border-none px-2 py-1 text-zinc-200 focus:ring-0 text-right appearance-none" 
                                    />
                                    <span className="px-2 py-1 bg-zinc-900 border-l border-zinc-800 text-zinc-500 text-[10px] min-w-[30px] text-center">zones</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Imbalance Zones */}
                <div className="border-b border-zinc-800 pb-3">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-zinc-400 font-bold">Imbalance Zones</h4>
                        <input 
                            type="checkbox" 
                            checked={settings.imbalanceEnabled} 
                            onChange={e => updateSettings({imbalanceEnabled: e.target.checked})} 
                        />
                    </div>
                    {settings.imbalanceEnabled && (
                        <div className="space-y-2 pl-2 border-l border-zinc-800">
                            <div>
                                <label className="block text-zinc-500 mb-1">Min Size (x Avg Body)</label>
                                <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded overflow-hidden">
                                    <input 
                                        type="number" 
                                        step="0.1" 
                                        value={Number.isNaN(settings.imbalanceMinSize) ? '' : settings.imbalanceMinSize} 
                                        onChange={e => updateSettings({imbalanceMinSize: parseFloat(e.target.value)})} 
                                        className="flex-1 bg-transparent border-none px-2 py-1 text-zinc-200 focus:ring-0 text-right appearance-none" 
                                    />
                                    <span className="px-2 py-1 bg-zinc-900 border-l border-zinc-800 text-zinc-500 text-[10px] min-w-[30px] text-center">x</span>
                                </div>
                            </div>
                            <div>
                                <label className="block text-zinc-500 mb-1">Show Max Zones</label>
                                <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded overflow-hidden">
                                    <input 
                                        type="number" 
                                        value={Number.isNaN(settings.imbalanceCount) ? '' : settings.imbalanceCount} 
                                        onChange={e => updateSettings({imbalanceCount: parseInt(e.target.value)})} 
                                        className="flex-1 bg-transparent border-none px-2 py-1 text-zinc-200 focus:ring-0 text-right appearance-none" 
                                    />
                                    <span className="px-2 py-1 bg-zinc-900 border-l border-zinc-800 text-zinc-500 text-[10px] min-w-[30px] text-center">zones</span>
                                </div>
                            </div>
                            <div>
                                <label className="block text-zinc-500 mb-1">Position-Based Imbalance</label>
                                <select 
                                    value={settings.positionImbalanceMode || 'both'} 
                                    onChange={e => updateSettings({positionImbalanceMode: e.target.value as any})} 
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded text-[10px] text-zinc-300 px-2 py-1"
                                >
                                    <option value="none">None</option>
                                    <option value="markersOnly">Markers on Chart Only</option>
                                    <option value="overlayOnly">Color Overlay Only</option>
                                    <option value="both">Both (Recommended)</option>
                                </select>
                            </div>
                        </div>
                    )}
                </div>

                {/* Persistent Zones */}
                <div className="pb-1">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-zinc-400 font-bold">Persistent S/R Clusters</h4>
                        <input 
                            type="checkbox" 
                            checked={settings.persistentZonesEnabled} 
                            onChange={e => updateSettings({persistentZonesEnabled: e.target.checked})} 
                        />
                    </div>
                    {settings.persistentZonesEnabled && (
                        <div className="space-y-2 pl-2 border-l border-zinc-800">
                            <p className="text-[10px] text-zinc-500 leading-tight mb-2">
                                Detects high-volume absorption at local peaks/troughs. 
                                Zones persist until a full candle body closes on the other side.
                            </p>
                            <div>
                                <label className="block text-zinc-500 mb-1">Min Volume Multiplier</label>
                                <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded overflow-hidden">
                                    <input 
                                        type="number" 
                                        step="0.1" 
                                        value={Number.isNaN(settings.persistentVolMult) ? '' : settings.persistentVolMult} 
                                        onChange={e => updateSettings({persistentVolMult: parseFloat(e.target.value)})} 
                                        className="flex-1 bg-transparent border-none px-2 py-1 text-zinc-200 focus:ring-0 text-right appearance-none" 
                                    />
                                    <span className="px-2 py-1 bg-zinc-900 border-l border-zinc-800 text-zinc-500 text-[10px] min-w-[30px] text-center">x</span>
                                </div>
                            </div>
                            <div>
                                <label className="block text-zinc-500 mb-1">Min Test Touches</label>
                                <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded overflow-hidden">
                                    <input 
                                        type="number" 
                                        value={Number.isNaN(settings.persistentMinTouches) ? '' : settings.persistentMinTouches} 
                                        onChange={e => updateSettings({persistentMinTouches: parseInt(e.target.value)})} 
                                        className="flex-1 bg-transparent border-none px-2 py-1 text-zinc-200 focus:ring-0 text-right appearance-none" 
                                        min={1}
                                    />
                                    <span className="px-2 py-1 bg-zinc-900 border-l border-zinc-800 text-zinc-500 text-[10px] min-w-[30px] text-center">tests</span>
                                </div>
                            </div>

                            {/* Zone Draw Direction */}
                            <div className="flex items-center justify-between mt-2">
                                <div className="flex items-center gap-1">
                                    <label className="text-zinc-400 text-[11px]">Draw Zones From Detection</label>
                                    <div className="group/icon relative">
                                        <Info size={10} className="text-zinc-500 cursor-help" />
                                        <div className="absolute left-0 top-5 w-56 p-2 bg-zinc-950 border border-zinc-800 rounded text-[10px] text-zinc-400 hidden group-hover/icon:block z-[60] shadow-xl pointer-events-none">
                                            <b>ON (default):</b> Each zone starts at the candle where it was detected and extends to the right edge — shows context clearly.<br/>
                                            <b>OFF:</b> Zones span the full chart width (classic look).
                                        </div>
                                    </div>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={(settings as any).zoneDrawFromDetection ?? true}
                                    onChange={e => updateSettings({ zoneDrawFromDetection: e.target.checked })}
                                />
                            </div>

                            {/* ML Settings */}

                            <div className="mt-4 pt-3 border-t border-zinc-800">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-1 relative">
                                        <label className="text-zinc-400 font-bold">ML Mode</label>
                                        <div className="group/icon relative">
                                            <Info size={10} className="text-zinc-500 cursor-help" />
                                            <div className="absolute left-0 top-5 w-48 p-2 bg-zinc-950 border border-zinc-800 rounded text-[10px] text-zinc-400 hidden group-hover/icon:block z-[60] shadow-xl pointer-events-none">
                                                Enable real machine learning to merge zones and show only the most relevant ones
                                            </div>
                                        </div>
                                    </div>
                                    <input 
                                        type="checkbox" 
                                        checked={settings.mlMode} 
                                        onChange={e => updateSettings({mlMode: e.target.checked})} 
                                    />
                                </div>

                                {settings.mlMode && (
                                    <div className="space-y-3 pl-2 border-l border-blue-500/30">
                                        <div>
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="text-zinc-500">Relevance Threshold</label>
                                                <span className="text-zinc-300">{settings.mlThreshold.toFixed(2)}</span>
                                            </div>
                                            <input 
                                                type="range" 
                                                min="0.50" 
                                                max="0.95" 
                                                step="0.01" 
                                                value={Number.isNaN(settings.mlThreshold) ? 0.5 : settings.mlThreshold} 
                                                onChange={e => updateSettings({mlThreshold: parseFloat(e.target.value)})} 
                                                className="w-full accent-blue-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                                            />
                                            <p className="text-[9px] text-zinc-600 mt-0.5">Higher = fewer but higher-quality zones</p>
                                        </div>

                                        <div className="flex items-center justify-between">
                                            <label className="text-zinc-500">Auto-Merge Zones</label>
                                            <input 
                                                type="checkbox" 
                                                checked={settings.autoMerge} 
                                                onChange={e => updateSettings({autoMerge: e.target.checked})} 
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-zinc-500 mb-1">Auto-Retrain</label>
                                            <select 
                                                value={Number.isNaN(settings.autoRetrainDays) ? 0 : settings.autoRetrainDays} 
                                                onChange={e => updateSettings({autoRetrainDays: parseInt(e.target.value)})} 
                                                className="w-full bg-zinc-950 border border-zinc-800 rounded text-[10px] text-zinc-300 px-2 py-1"
                                            >
                                                <option value={0}>Off</option>
                                                <option value={1}>Every 1 Day</option>
                                                <option value={3}>Every 3 Days</option>
                                                <option value={7}>Every 7 Days</option>
                                                <option value={14}>Every 14 Days</option>
                                                <option value={30}>Every 30 Days</option>
                                            </select>
                                        </div>

                                        <button 
                                            onClick={() => {
                                                setMlStatus("Training started...");
                                                mlZoneService.train(symbol || 'UNKNOWN', data, rawZonesRef.current).then((res) => {
                                                    if (res?.trained) {
                                                        setMlStatus(`Retrained on ${res.sampleSize} samples`);
                                                        updateSettings({ lastRetrainDate: Date.now() });
                                                    } else {
                                                        setMlStatus("Training failed or no data");
                                                    }
                                                });
                                            }}
                                            className="w-full py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded transition-colors text-center font-medium"
                                        >
                                            Force Retrain Now
                                        </button>

                                        <div className="text-[9px] text-zinc-500 font-mono border-t border-zinc-800 pt-2 mt-2">
                                            {mlStatus}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
      )}
      </div>

        {/* Oscillator Pane */}
        {showOscillator && !simplified && (() => {
            const validData = data.filter(c => !isNaN(c.low) && !isNaN(c.high) && c.low > 0 && c.high > 0);
            const availableWidth = Math.max(dimensions.width - 70, 10);
            const slotWidth = availableWidth / visibleCount;
            
            const endIdx = validData.length - scrollOffset;
            const startIdx = Math.max(0, endIdx - visibleCount);
            const visibleCandles = validData.slice(startIdx, endIdx);
            
            // Align xOffset exactly with main chart logic to ensure vertical alignment
            const xOffset = (visibleCount - visibleCandles.length) * slotWidth;
            
            // Calculate candle width ratio to ensure oscillator bars match candle width exactly
            const candleGapRatio = settings.showFootprintsOnChart ? 0.1 : 0.3;
            const candleWidthRatio = 1 - candleGapRatio;

            return (
                <div className="h-[120px] shrink-0 w-full border-t border-zinc-800">
                    <ErrorBoundary>
                        {settings.selectedOscillator === 'supplydemand' ? (
                            <VolumeFootOscillatorPane 
                                candles={visibleCandles} 
                                width={dimensions.width} 
                                height={120} 
                                chartWidth={dimensions.width - 60}
                                rightBuffer={60}
                                xOffset={xOffset}
                                slotWidth={slotWidth}
                                mousePos={mousePos}
                                mainChartHeight={dimensions.height}
                                candleWidthRatio={candleWidthRatio}
                                footOscMode={settings.footOscMode}
                                showNetDeltaLine={settings.showNetDeltaLine}
                                minStackRatio={settings.minStackRatio}
                                barOpacity={settings.barOpacity}
                                positionImbalanceMode={settings.positionImbalanceMode}
                                showTooltips={settings.showFootOscTooltips}
                            />
                        ) : (
                            <PhaseSqueezerOscillatorPane 
                                data={squeezer.oscillatorData.slice(startIdx, endIdx)} 
                                width={dimensions.width} 
                                height={120} 
                                chartWidth={dimensions.width - 60}
                                rightBuffer={60}
                                xOffset={xOffset}
                                slotWidth={slotWidth}
                                mousePos={mousePos}
                                mainChartHeight={dimensions.height}
                            />
                        )}
                    </ErrorBoundary>
                </div>
            );
        })()}

        {/* Bottom Navigation Bar */}
        {!simplified && (
          <div className="h-8 shrink-0 bg-zinc-950 border-t border-zinc-800 flex items-center justify-center gap-6 select-none z-20">
            {/* Zoom Controls */}
            <div className="flex items-center gap-1">
                <button 
                    onClick={() => {
                        setVisibleCount(prev => Math.max(Math.round(prev * 0.8), 5));
                    }}
                    className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
                    title="Zoom In"
                >
                    <Plus size={14} />
                </button>
                <button 
                    onClick={() => {
                        setVisibleCount(prev => Math.min(Math.round(prev * 1.25), 500));
                    }}
                    className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
                    title="Zoom Out"
                >
                    <Minus size={14} />
                </button>
            </div>

            <div className="w-px h-4 bg-zinc-800" />

            {/* Pan Controls */}
            <div className="flex items-center gap-1">
                <button
                    onClick={() => {
                        const { priceRange } = scaleRef.current;
                        if (priceRange) {
                            setPricePan(prev => prev + priceRange * 0.1);
                            requestDraw();
                        }
                    }}
                    className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
                    title="Pan Up"
                >
                    <ChevronUp size={14} />
                </button>
                <button
                    onClick={() => {
                        const { priceRange } = scaleRef.current;
                        if (priceRange) {
                            setPricePan(prev => prev - priceRange * 0.1);
                            requestDraw();
                        }
                    }}
                    className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
                    title="Pan Down"
                >
                    <ChevronDown size={14} />
                </button>
            </div>

            <div className="w-px h-4 bg-zinc-800" />

            {/* Scroll Controls */}
            <div className="flex items-center gap-1">
                <button
                    onClick={() => {
                        setScrollOffset(prev => {
                            const next = prev + 10;
                            const maxScroll = Math.max(0, data.length - visibleCount);
                            return Math.min(next, maxScroll);
                        });
                        requestDraw();
                    }}
                    className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
                    title="Scroll Left"
                >
                    <ChevronLeft size={14} />
                </button>
                <button
                    onClick={() => {
                        setScrollOffset(prev => Math.max(0, prev - 10));
                        requestDraw();
                    }}
                    className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
                    title="Scroll Right"
                >
                    <ChevronRight size={14} />
                </button>
            </div>

            <div className="w-px h-4 bg-zinc-800" />

            {/* Reset Button */}
            <button
                onClick={() => {
                    setScrollOffset(0);
                    setVisibleCount(100);
                    setPriceZoom(1);
                    setPricePan(0);
                    requestDraw();
                }}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
                title="Reset View"
            >
                <RotateCcw size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
