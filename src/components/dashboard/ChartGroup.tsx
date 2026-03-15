import React, { useState } from 'react';
import { CandlestickChart } from './CandlestickChart';
import { useSharedStream } from '../../hooks/use-shared-stream';
import { cn } from '../../lib/utils';
import { Settings } from 'lucide-react';

interface ChartGroupProps {
    instanceId: string;
    symbol: string;
    timeframe: string;
    marketType: 'spot' | 'perp';
    showSettings: boolean;
    onToggleSettings: () => void;
}

export function ChartGroup({ 
    instanceId, 
    symbol, 
    timeframe,
    marketType,
    showSettings,
    onToggleSettings
}: ChartGroupProps) {
    const { candles, ticker, trades, latency, tickSize, isLoadingHistory } = useSharedStream(symbol, marketType, timeframe);
    const instanceIdx = instanceId.split('-').pop();

    return (
        <div className="flex flex-col h-full w-full bg-zinc-950 overflow-hidden">
            {/* Main Content Area */}
            <div className="flex-1 relative min-h-0 bg-black/20">
                <CandlestickChart 
                    data={candles} 
                    symbol={symbol} 
                    isLoadingHistory={isLoadingHistory}
                    tickSize={tickSize}
                    instanceId={instanceId}
                    showSettings={showSettings}
                    onToggleSettings={onToggleSettings}
                />
            </div>
        </div>
    );
}
