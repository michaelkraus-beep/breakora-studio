import React, { useEffect, useRef } from 'react';
import { SqueezerDataPoint, MarketPhase, SqueezeState } from '../../types/squeezer';

interface Props {
  data: SqueezerDataPoint[];
  width: number;
  height: number;
  chartWidth: number;
  rightBuffer: number;
  xOffset: number;
  slotWidth: number;
  mousePos: { x: number, y: number };
  mainChartHeight?: number;
}

export function PhaseSqueezerOscillatorPane({ data, width, height, chartWidth, rightBuffer, xOffset, slotWidth, mousePos, mainChartHeight = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const validData = data.filter(d => d && !isNaN(d.momentum) && !isNaN(d.phaseUpper));
    const maxMom = Math.max(0.0001, ...validData.map(d => Math.abs(d.momentum)), ...validData.map(d => Math.abs(d.phaseUpper)));
    const yCenter = height / 2;
    const scaleY = (height / 2 - 10) / maxMom;

    // Draw Price Scale Background to match main chart
    ctx.fillStyle = '#18181b';
    ctx.fillRect(chartWidth, 0, rightBuffer, height);

    // Draw Zero Line
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, yCenter);
    ctx.lineTo(chartWidth, yCenter);
    ctx.stroke();

    // Draw Phase Tunnel (Gray Area)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, chartWidth, height);
    ctx.clip();

    ctx.fillStyle = 'rgba(113, 113, 122, 0.15)';
    ctx.beginPath();
    let started = false;
    data.forEach((d, i) => {
        if (!d || isNaN(d.phaseUpper)) return;
        const x = xOffset + i * slotWidth + slotWidth / 2;
        const y = yCenter - (d.phaseUpper * scaleY);
        if (!started) { ctx.moveTo(x, y); started = true; } 
        else { ctx.lineTo(x, y); }
    });
    for (let i = data.length - 1; i >= 0; i--) {
        const d = data[i];
        if (!d || isNaN(d.phaseLower)) continue;
        const x = xOffset + i * slotWidth + slotWidth / 2;
        const y = yCenter - (d.phaseLower * scaleY);
        ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    // Draw Momentum Line
    ctx.lineWidth = 2;
    for (let i = 1; i < data.length; i++) {
        const d = data[i];
        const prev = data[i-1];
        if (!d || !prev || isNaN(d.momentum) || isNaN(prev.momentum)) continue;

        const x1 = xOffset + (i-1) * slotWidth + slotWidth / 2;
        const y1 = yCenter - (prev.momentum * scaleY);
        const x2 = xOffset + i * slotWidth + slotWidth / 2;
        const y2 = yCenter - (d.momentum * scaleY);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        
        // Color based on Phase and Direction
        if (d.marketPhase === MarketPhase.ACCUMULATION) ctx.strokeStyle = '#71717a'; // Gray
        else if (d.momentum > 0) ctx.strokeStyle = d.momentum > prev.momentum ? '#22d3ee' : '#2563eb'; // Aqua / Blue
        else ctx.strokeStyle = d.momentum < prev.momentum ? '#ef4444' : '#eab308'; // Red / Yellow
        
        ctx.stroke();
    }
    
    ctx.restore();

    // Draw Squeeze Dots on Zero Line
    data.forEach((d, i) => {
        if (!d || isNaN(d.momentum)) return;
        const x = xOffset + i * slotWidth + slotWidth / 2;
        
        // Don't draw dots in the right buffer area
        if (x > chartWidth) return;

        ctx.beginPath();
        ctx.arc(x, yCenter, 2.5, 0, Math.PI * 2);
        
        if (d.squeezeState === SqueezeState.HIGH) {
            ctx.fillStyle = '#f97316'; // Orange
            ctx.shadowColor = '#f97316';
            ctx.shadowBlur = 8;
        } else if (d.squeezeState === SqueezeState.MID) {
            ctx.fillStyle = '#d4d4d8'; // Silver
            ctx.shadowBlur = 0;
        } else if (d.squeezeState === SqueezeState.LOW) {
            ctx.fillStyle = '#52525b'; // Gray
            ctx.shadowBlur = 0;
        } else {
            ctx.fillStyle = '#3b82f6'; // Blue (Fired)
            ctx.shadowBlur = 0;
        }
        ctx.fill();
        ctx.shadowBlur = 0; // reset
    });

    // Draw Crosshair
    if (mousePos.x > 0 && mousePos.x < chartWidth) {
        // Vertical Line (Always visible)
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mousePos.x, 0);
        ctx.lineTo(mousePos.x, height);
        ctx.stroke();

        // Horizontal Line (Only if mouse is in this pane)
        const localY = mousePos.y - mainChartHeight;
        if (localY >= 0 && localY <= height) {
            ctx.beginPath();
            ctx.moveTo(0, localY);
            ctx.lineTo(chartWidth + rightBuffer, localY);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

  }, [data, width, height, chartWidth, rightBuffer, xOffset, slotWidth, mousePos, mainChartHeight]);

  return <canvas ref={canvasRef} style={{ width, height }} className="bg-zinc-950 border-t border-zinc-800" />;
}
