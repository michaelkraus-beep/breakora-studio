import { useState, useEffect } from 'react';
import { sharedStreamService, StreamData } from '../services/SharedStreamService';

export function useSharedStream(symbol: string, marketType: 'spot' | 'perp', interval: string) {
    const [data, setData] = useState<StreamData>({
        ticker: null,
        trades: [],
        candles: [],
        latency: 0,
        tickSize: 0.01,
        isLoadingHistory: true
    });

    useEffect(() => {
        if (!symbol) return;

        const unsubscribe = sharedStreamService.subscribe(
            symbol,
            marketType,
            interval,
            (newData) => {
                setData(newData);
            }
        );

        return () => {
            unsubscribe();
        };
    }, [symbol, marketType, interval]);

    return data;
}
