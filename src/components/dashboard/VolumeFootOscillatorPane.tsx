import React, { useEffect, useRef, useMemo } from 'react';
import { Candle } from '../../types/market';

interface Props {
  candles: Candle[];
  width: number;
  height: number;
  chartWidth: number;
  rightBuffer: number;
  xOffset: number;
  slotWidth: number;
  mousePos: { x: number; y: number };
  candleWidthRatio?: number;
  mainChartHeight?: number;
  
  // New Settings
  footOscMode?: 'strongestStack' | 'totalDelta';
  showNetDeltaLine?: boolean;
  minStackRatio?: number;
  barOpacity?: number;
  positionImbalanceMode?: 'none' | 'markersOnly' | 'overlayOnly' | 'both';
  showTooltips?: boolean;
}

export const VolumeFootOscillatorPane = React.memo(function VolumeFootOscillatorPane({ 
  candles, width, height, chartWidth, rightBuffer, xOffset, slotWidth, mousePos,
  candleWidthRatio = 0.8,
  footOscMode = 'strongestStack',
  showNetDeltaLine = true,
  minStackRatio = 3.0,
  barOpacity = 65,
  positionImbalanceMode = 'both',
  showTooltips = true
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 1. Memoize Data Calculation (Zero extra bandwidth, pure logic)
  const dataPoints = useMemo(() => {
    const maxVolContext = Math.max(...candles.map(c => c.volume), 1);

    return candles.map(c => {
        let buyVol = 0;
        let sellVol = 0;
        let maxStackImb = 0;
        let maxStackDir = 0; // 1 = Buy, -1 = Sell
        let maxStackRatio = 0;
        let hasFootprint = false;
        
        // Position Flags
        let top30Imbalance = false;
        let pocImbalance = false;
        let highLowImbalance: 'high' | 'low' | 'none' = 'none';
        let pocLevel: any = null;
        
        // Stats needed for tooltip
        let deltaAtHigh = 0;
        let deltaAtLow = 0;
        
        // Stack Lengths
        let maxBuyStack = 0;
        let maxSellStack = 0;
        
        let candleFootprint = c.footprint;

        if (candleFootprint && Object.keys(candleFootprint).length > 0) {
            hasFootprint = true;
            const rawLevels = Object.values(candleFootprint) as any[];
            
            const workingLevels = rawLevels;

            // Calculate Position Stats
            let maxVol = 0;
            let totalVolAtPOC = 0;
            let deltaAtPOC = 0;
            let highPrice = -Infinity;
            let lowPrice = Infinity;
            let buyVolInTop30 = 0;
            let sellVolInTop30 = 0;
            
            const range = c.high - c.low;
            const top30Threshold = c.low + range * 0.7;

            // --- Calculate Stack Lengths & Volume ---
            // Sort levels by price descending (Top to Bottom)
            const sortedLevels = [...rawLevels].sort((a, b) => b.price - a.price);
            
            let currentBuyStack = 0;
            let currentSellStack = 0;

            sortedLevels.forEach(l => {
                // Check for Imbalance
                const isBuyImbalance = l.buyVolume > l.sellVolume * minStackRatio && l.buyVolume > 0;
                const isSellImbalance = l.sellVolume > l.buyVolume * minStackRatio && l.sellVolume > 0;

                if (isBuyImbalance) {
                    currentBuyStack++;
                    maxBuyStack = Math.max(maxBuyStack, currentBuyStack);
                    currentSellStack = 0;
                } else if (isSellImbalance) {
                    currentSellStack++;
                    maxSellStack = Math.max(maxSellStack, currentSellStack);
                    currentBuyStack = 0;
                } else {
                    currentBuyStack = 0;
                    currentSellStack = 0;
                }

                buyVol += l.buyVolume;
                sellVol += l.sellVolume;
                
                // Calculate Imbalance Ratio (Max Stack Imbalance Volume)
                const totalLevelVol = l.buyVolume + l.sellVolume;
                if (totalLevelVol > 0) {
                    if (isBuyImbalance) {
                        if (l.delta > maxStackImb) {
                            maxStackImb = l.delta;
                            maxStackDir = 1;
                            maxStackRatio = l.sellVolume > 0 ? l.buyVolume / l.sellVolume : l.buyVolume;
                        }
                    }
                    else if (isSellImbalance) {
                        const absDelta = Math.abs(l.delta);
                        if (absDelta > maxStackImb) {
                            maxStackImb = absDelta; 
                            maxStackDir = -1;
                            maxStackRatio = l.buyVolume > 0 ? l.sellVolume / l.buyVolume : l.sellVolume;
                        }
                    }
                }
            });

            // Position stats — using raw footprint levels as per legacy logic
            rawLevels.forEach(l => {
                const totalVol = l.buyVolume + l.sellVolume;
                if (totalVol > maxVol) {
                    maxVol = totalVol;
                    pocLevel = l;
                    totalVolAtPOC = totalVol;
                    deltaAtPOC = l.delta;
                }
                
                if (l.price > highPrice) { highPrice = l.price; deltaAtHigh = l.delta; }
                if (l.price < lowPrice)  { lowPrice  = l.price; deltaAtLow  = l.delta; }
                
                if (l.price >= top30Threshold) {
                    buyVolInTop30  += l.buyVolume;
                    sellVolInTop30 += l.sellVolume;
                }
            });
            
            // Calculate Flags
            top30Imbalance = buyVolInTop30 > sellVolInTop30 * 2.5 && sellVolInTop30 > 0;
            pocImbalance = Math.abs(deltaAtPOC) > totalVolAtPOC * 0.4;
            
            // Check high/low imbalance
            const isHighImbalance = Math.abs(deltaAtHigh) > (maxVol * 0.1) * 3; 
            const isLowImbalance = Math.abs(deltaAtLow) > (maxVol * 0.1) * 3;
            
            if (isHighImbalance) highLowImbalance = 'high';
            else if (isLowImbalance) highLowImbalance = 'low';
            else highLowImbalance = 'none';

        } else {
            // Fallback if no footprint data
            if (c.close >= c.open) {
                buyVol = c.volume;
                maxStackDir = 1;
                maxStackImb = c.volume * 0.5; // Fallback estimate
            } else {
                sellVol = c.volume;
                maxStackDir = -1;
                maxStackImb = c.volume * 0.5; // Fallback estimate
            }
            maxStackRatio = 1.0;
        }

        // --- Tooltip Data Calculation ---
        const netDelta = buyVol - sellVol;
        const isBuy = netDelta >= 0;
        const deltaColor = isBuy ? 'text-cyan-400' : 'text-purple-400';
        
        const rightValue = footOscMode === 'totalDelta' ? Math.abs(netDelta) : maxStackImb;
        const rightColor = footOscMode === 'totalDelta' 
            ? deltaColor 
            : (maxStackDir > 0 ? 'text-cyan-400' : 'text-purple-400');
        const rightDirection = footOscMode === 'totalDelta'
            ? (isBuy ? 'Buy' : 'Sell')
            : (maxStackDir > 0 ? 'Buy' : 'Sell');

        // POC Stats
        let pocRatioVal = 0;
        let pocIsBuy = false;
        if (pocLevel) {
             const pBuy = pocLevel.buyVolume;
             const pSell = pocLevel.sellVolume;
             pocIsBuy = pocLevel.delta > 0;
             if (pocIsBuy) pocRatioVal = pSell > 0 ? pBuy / pSell : pBuy;
             else pocRatioVal = pBuy > 0 ? pSell / pBuy : pSell;
        }

        // High/Low Stats
        const highLowIsHigh = highLowImbalance === 'high';
        // Need deltaAtHigh/Low but they are scoped in if block. 
        // Re-accessing via closure variables defined above (deltaAtHigh, deltaAtLow)
        const highLowIsBuy = highLowIsHigh ? deltaAtHigh > 0 : deltaAtLow > 0;

        // Interpretation
        const volumeHigh = c.volume > (maxVolContext * 0.7);
        const imbalanceLow = Math.abs(netDelta) < c.volume * 0.15;
        
        let interpretation = null;
        if (volumeHigh && imbalanceLow) interpretation = "Absorption detected – strong defense";
        else if (top30Imbalance) interpretation = "Selling into strength at highs";
        
        return {
            volume: c.volume,
            buyVol,
            sellVol,
            netDelta,
            maxStackImb,
            maxStackDir,
            maxStackRatio,
            hasFootprint,
            time: c.time,
            positionFlags: { top30: top30Imbalance, poc: pocImbalance, highLow: highLowImbalance },
            pocPrice: pocLevel ? pocLevel.price : 0,
            high: c.high,
            low: c.low,

            // Tooltip Fields
            rightValue,
            rightColor,
            ratio: maxStackRatio > 0 ? maxStackRatio.toFixed(1) : null,
            stackDirection: maxStackDir > 0 ? 'Buy' : 'Sell',
            rightDirection,
            top30: top30Imbalance,
            poc: pocImbalance,
            pocRatio: pocRatioVal.toFixed(1),
            pocDirection: pocIsBuy ? 'Buy' : 'Sell',
            highLow: highLowImbalance !== 'none',
            highLowAt: highLowIsHigh ? 'High' : 'Low',
            highLowDirection: highLowIsBuy ? 'Buy' : 'Sell',
            interpretation,
            maxBuyStack,
            maxSellStack
        };
    });
  }, [candles, minStackRatio, footOscMode]);

  // 2. Memoize Scaling Factors
  const { scaleVol, scaleImb, maxVol, maxRight } = useMemo(() => {
      if (dataPoints.length === 0) return { scaleVol: 1, scaleImb: 1, maxVol: 1, maxRight: 1 };

      const maxVol = Math.max(...dataPoints.map(d => d.volume), 1);
      
      // Calculate max value for the right bar based on mode
      const rightValues = dataPoints.map(d => 
          footOscMode === 'totalDelta' ? Math.abs(d.netDelta) : d.maxStackImb
      );
      const maxRight = Math.max(...rightValues, 1);

      // Standard Mode: Independent Scaling
      // Volume uses 90% height
      const scaleVol = (height * 0.9) / maxVol;
      // Imbalance uses 85% height (slightly shorter to distinguish)
      const scaleImb = (height * 0.85) / maxRight;

      return { scaleVol, scaleImb, maxVol, maxRight };
  }, [dataPoints, height, footOscMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Draw Right Buffer Background
    ctx.fillStyle = '#18181b';
    ctx.fillRect(chartWidth, 0, rightBuffer, height);

    // Clip to Chart Area
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, chartWidth, height);
    ctx.clip();

    if (candles.length === 0) {
      ctx.fillStyle = '#52525b';
      ctx.font = '10px monospace';
      ctx.fillText('Waiting for data...', 40, height / 2);
      ctx.restore();
      return;
    }

    // 3. Draw Bars
    const totalGroupWidth = slotWidth * candleWidthRatio;
    const internalGap = slotWidth * 0.05;
    const barWidth = Math.max((totalGroupWidth - internalGap) / 2, 1);
    
    // Opacity string
    const opacityHex = Math.round((barOpacity / 100) * 255).toString(16).padStart(2, '0');

    dataPoints.forEach((d, i) => {
        const cx = xOffset + i * slotWidth + slotWidth / 2;
        
        // --- A. Volume Bar (Left) ---
        const xVol = cx - internalGap / 2 - barWidth;
        const hVol = Math.max(d.volume * scaleVol, d.volume > 0 ? 1 : 0);
        
        // Color Logic
        const threshold = d.volume * 0.05;
        let volColor = '#52525b'; // Zinc-600
        
        if (d.netDelta > threshold) volColor = '#22d3ee'; // Turquoise
        else if (d.netDelta < -threshold) volColor = '#a855f7'; // Purple
        
        ctx.fillStyle = `${volColor}${opacityHex}`;
        ctx.fillRect(xVol, height - hVol, barWidth, hVol);

        // Border for strong bars (> 60% of max)
        if (d.volume > maxVol * 0.6) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1;
            ctx.strokeRect(xVol, height - hVol, barWidth, hVol);
        }

        // --- B. Right Bar (Imbalance or Delta) ---
        const xImb = cx + internalGap / 2;
        
        // Determine Value and Color based on Mode
        let rightVal = 0;
        let rightDir = 0;
        
        if (footOscMode === 'totalDelta') {
            rightVal = Math.abs(d.netDelta);
            rightDir = d.netDelta > 0 ? 1 : -1;
        } else {
            rightVal = d.maxStackImb;
            rightDir = d.maxStackDir;
        }

        if (d.hasFootprint && rightVal > 0) {
            const hImb = Math.max(rightVal * scaleImb, 1);
            const stackColor = rightDir > 0 ? '#22d3ee' : '#a855f7';
            
            ctx.fillStyle = `${stackColor}${opacityHex}`;
            ctx.fillRect(xImb, height - hImb, barWidth, hImb);

            // Border for strong bars
            if (rightVal > maxRight * 0.6) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.lineWidth = 1;
                ctx.strokeRect(xImb, height - hImb, barWidth, hImb);
            }

            // Tiny Delta Arrow
            if (showNetDeltaLine) {
                ctx.fillStyle = '#ffffff';
                ctx.font = '8px monospace';
                ctx.textAlign = 'center';
                // Draw arrow above bar if there is space, or inside if tall
                const arrowY = height - hImb - 4;
                if (arrowY > 10) {
                   // ctx.fillText(rightDir > 0 ? '↑' : '↓', xImb + barWidth/2, arrowY);
                }
            }

            // --- C. Position Overlay (New) ---
            if (positionImbalanceMode === 'overlayOnly' || positionImbalanceMode === 'both') {
                const { top30, poc, highLow } = d.positionFlags;
                
                // 1. Top 30% Gradient
                if (top30) {
                    const gradH = hImb * 0.3;
                    const grad = ctx.createLinearGradient(0, height - hImb, 0, height - hImb + gradH);
                    grad.addColorStop(0, 'rgba(239, 68, 68, 0.4)');
                    grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
                    ctx.fillStyle = grad;
                    ctx.fillRect(xImb, height - hImb, barWidth, gradH);
                }

                // 2. POC Line — drawn on the imbalance (right) bar at the proportional price position (Legacy Logic)
                if (poc && d.high > d.low && d.pocPrice > 0) {
                    const range = d.high - d.low;
                    const pocRatio = Math.max(0, Math.min(1, (d.pocPrice - d.low) / range));
                    const pocY = height - hImb * pocRatio;
                    
                    ctx.fillStyle = '#facc15'; // Yellow
                    ctx.fillRect(xImb, pocY - 0.5, barWidth, 1.5);
                }

                // 3. High/Low Arrow
                if (highLow !== 'none') {
                    const isHigh = highLow === 'high';
                    const arrowY = isHigh ? height - hImb - 4 : height + 4; // Above or below bar? 
                    // Wait, below bar is outside canvas? No, height is canvas height.
                    // If bar is short, arrow might be far from it?
                    // "at the very top or bottom of the bar"
                    
                    const y = isHigh ? height - hImb : height; 
                    // If isHigh, draw at top of bar. If isLow, draw at bottom of bar (which is `height`).
                    
                    ctx.fillStyle = isHigh ? '#ef4444' : '#22c55e';
                    ctx.beginPath();
                    if (isHigh) {
                        // Down arrow at top
                        ctx.moveTo(xImb + barWidth/2, y);
                        ctx.lineTo(xImb + barWidth/2 - 3, y - 4);
                        ctx.lineTo(xImb + barWidth/2 + 3, y - 4);
                    } else {
                        // Up arrow at bottom
                        ctx.moveTo(xImb + barWidth/2, height - 2);
                        ctx.lineTo(xImb + barWidth/2 - 3, height + 2); // Might be clipped
                        ctx.lineTo(xImb + barWidth/2 + 3, height + 2);
                    }
                    ctx.fill();
                    
                    // Alternative: Draw small dot inside the bar at top/bottom
                    ctx.beginPath();
                    ctx.arc(xImb + barWidth/2, isHigh ? height - hImb + 3 : height - 3, 1.5, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

        } else {
            // Fallback: draw a ghost bar for missing footprint data
            const fallbackH = Math.max(d.maxStackImb * scaleImb, 1);
            const fallbackColor = d.maxStackDir > 0 ? '#22d3ee' : '#a855f7';
            ctx.fillStyle = `${fallbackColor}22`; // Very low opacity (Hex 22)
            ctx.fillRect(xImb, height - fallbackH, barWidth, fallbackH);
        }
    });

    // Draw Net Delta Line (Connecting Volume Tops)
    if (showNetDeltaLine && dataPoints.length > 0) {
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        
        for (let i = 0; i < dataPoints.length - 1; i++) {
            const d1 = dataPoints[i];
            const d2 = dataPoints[i+1];
            
            const cx1 = xOffset + i * slotWidth + slotWidth / 2;
            const cx2 = xOffset + (i+1) * slotWidth + slotWidth / 2;
            
            const xVol1 = cx1 - internalGap / 2 - barWidth / 2;
            const xVol2 = cx2 - internalGap / 2 - barWidth / 2;
            
            const hVol1 = Math.max(d1.volume * scaleVol, d1.volume > 0 ? 1 : 0);
            const hVol2 = Math.max(d2.volume * scaleVol, d2.volume > 0 ? 1 : 0);
            
            const y1 = height - hVol1;
            const y2 = height - hVol2;
            
            const deltaColor = d1.netDelta > 0 ? '#22d3ee' : '#a855f7'; // Use color of starting point
            
            ctx.strokeStyle = deltaColor;
            ctx.beginPath();
            ctx.moveTo(xVol1, y1);
            ctx.lineTo(xVol2, y2);
            ctx.stroke();
        }
    }

    ctx.restore();

    // 4. Draw Right Scale Labels
    ctx.fillStyle = '#18181b';
    ctx.fillRect(chartWidth, 0, rightBuffer, height);
    
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chartWidth, 0);
    ctx.lineTo(chartWidth, height);
    ctx.stroke();

    const formatNumber = (num: number) => {
        if (Math.abs(num) >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (Math.abs(num) >= 1000) return (num / 1000).toFixed(0) + 'k';
        return num.toFixed(0);
    };

    ctx.fillStyle = '#71717a';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    // Draw Volume Scale (Left Bar context)
    const labels = [maxVol, maxVol / 2, 0];
    labels.forEach((val, i) => {
        const y = height - (val * scaleVol); 
        const textY = Math.min(Math.max(y, 6), height - 6);
        ctx.fillText(formatNumber(val), chartWidth + 6, textY);
        
        ctx.strokeStyle = '#3f3f46';
        ctx.beginPath();
        ctx.moveTo(chartWidth, y);
        ctx.lineTo(chartWidth + 4, y);
        ctx.stroke();
    });

    // 5. Tooltip Crosshair (Tooltip box is now HTML)
    if (mousePos.x > 0 && mousePos.x < chartWidth) {
        const candleIdx = Math.floor((mousePos.x - xOffset) / slotWidth);
        
        if (candleIdx >= 0 && candleIdx < dataPoints.length) {
            // Crosshair
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, chartWidth, height);
            ctx.clip();
            
            const cx = xOffset + candleIdx * slotWidth + slotWidth / 2;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(cx, 0);
            ctx.lineTo(cx, height);
            ctx.stroke();
            ctx.restore();
        }
    }

  }, [candles, width, height, chartWidth, rightBuffer, xOffset, slotWidth, mousePos, dataPoints, scaleVol, scaleImb, maxVol, footOscMode, showNetDeltaLine, barOpacity, positionImbalanceMode]);

  // Determine hovered item for HTML Tooltip
  const hoveredItem = useMemo(() => {
    if (mousePos.x > 0 && mousePos.x < chartWidth) {
        const candleIdx = Math.floor((mousePos.x - xOffset) / slotWidth);
        if (candleIdx >= 0 && candleIdx < dataPoints.length) {
            return dataPoints[candleIdx];
        }
    }
    return null;
  }, [mousePos, xOffset, slotWidth, dataPoints, chartWidth]);

  return (
    <div className="relative" style={{ width, height }}>
        <canvas ref={canvasRef} style={{ width, height }} className="bg-zinc-950 border-t border-zinc-800" />
        
        {showTooltips && hoveredItem && (
            <div 
                className="absolute bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl p-3 text-[11px] font-sans z-50 min-w-[210px] pointer-events-none"
                style={{
                    left: mousePos.x < chartWidth / 2 ? mousePos.x + 10 : mousePos.x - 220,
                    bottom: 10
                }}
            >
                {/* Header Removed */}

                {/* Volume Section */}
                <div className="flex justify-between mb-1">
                    <span className="text-zinc-400">Total Volume</span>
                    <span className="text-zinc-200 font-medium">{hoveredItem.volume.toLocaleString()}</span>
                </div>

                {/* Net Delta */}
                <div className="flex justify-between mb-3">
                    <span className="text-zinc-400">Net Delta</span>
                    <span className={`font-medium ${hoveredItem.netDelta >= 0 ? 'text-cyan-400' : 'text-purple-400'}`}>
                    {hoveredItem.netDelta >= 0 ? '+' : ''}{hoveredItem.netDelta.toLocaleString()}
                    </span>
                </div>

                {/* Divider */}
                <div className="h-px bg-zinc-800 my-2"></div>

                {/* Right Bar – Imbalance */}
                <div className="flex justify-between items-center mb-1">
                    <span className="text-zinc-400">
                    {footOscMode === 'totalDelta' ? 'Total Delta' : 'Strongest Stack'}
                    </span>
                    <span className={`font-bold ${hoveredItem.rightColor}`}>
                    {hoveredItem.rightValue.toLocaleString()}
                    </span>
                </div>

                {/* Imbalance Stacks */}
                <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>Imbalance Stacks</span>
                    <span className="font-medium font-sans">
                        {hoveredItem.maxBuyStack === 0 && hoveredItem.maxSellStack === 0 ? (
                            <span className="text-zinc-500">–/–</span>
                        ) : (
                            <>
                                <span className="text-cyan-400">{hoveredItem.maxBuyStack}</span>
                                <span className="text-white">/</span>
                                <span className="text-purple-400">{hoveredItem.maxSellStack}</span>
                            </>
                        )}
                    </span>
                </div>

                {/* Position-Based Imbalances – The new magic */}
                {(hoveredItem.top30 || hoveredItem.poc || hoveredItem.highLow) && positionImbalanceMode !== 'none' && (
                    <>
                    <div className="h-px bg-zinc-800 my-2"></div>
                    <div className="text-[10px] text-zinc-400 mb-1">POSITION IMBALANCE</div>
                    
                    {hoveredItem.top30 && (
                        <div className="flex justify-between text-rose-400 text-[10px]">
                        <span>Top 30% (Highs)</span>
                        <span className="font-medium">Selling Pressure</span>
                        </div>
                    )}
                    
                    {hoveredItem.poc && (
                        <div className="flex justify-between text-yellow-400 text-[10px]">
                        <span>POC Level</span>
                        <span className="font-medium">{hoveredItem.pocRatio}:1 {hoveredItem.pocDirection}</span>
                        </div>
                    )}
                    
                    {hoveredItem.highLow && (
                        <div className={`flex justify-between text-[10px] ${hoveredItem.highLowDirection === 'Buy' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        <span>Candle {hoveredItem.highLowAt}</span>
                        <span className="font-medium">{hoveredItem.highLowDirection} Imbalance</span>
                        </div>
                    )}
                    </>
                )}

                {/* Quick Interpretation Hint */}
                {hoveredItem.interpretation && (
                    <div className="mt-3 text-[9px] text-zinc-500 italic border-t border-zinc-800 pt-2">
                    {hoveredItem.interpretation}
                    </div>
                )}
            </div>
        )}
    </div>
  );
});
