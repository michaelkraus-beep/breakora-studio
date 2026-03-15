import { useState, useEffect, useCallback } from 'react';

export interface MarketAlert {
  id: string;
  symbol: string;
  fullSymbol: string;
  type: 'HIGH_VOLATILITY' | 'PRICE_SURGE' | 'PRICE_DROP' | 'HIGH_VOLUME';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  message: string;
  firstDetected: number;
  lastUpdated: number;
  value: number;
}

export interface ScannerFilters {
  minVolume: number;
  minMarketCap: number;
  lookbackValue: number;
  lookbackUnit: 'bars' | 'minutes' | 'hours' | 'days' | 'weeks';
  minVolChange: number;
  useExchangeHours: boolean;
}

interface Ticker24h {
  symbol: string;
  priceChangePercent: string;
  quoteVolume: string;
  lastPrice: string;
  count: number;
}

export function useMarketScanner() {
  const [alerts, setAlerts] = useState<MarketAlert[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScan, setLastScan] = useState<number>(Date.now());
  
  const [filters, setFilters] = useState<ScannerFilters>({
    minVolume: 1000000,
    minMarketCap: 10000000,
    lookbackValue: 89,
    lookbackUnit: 'bars',
    minVolChange: 5,
    useExchangeHours: false
  });

  const isSessionActive = useCallback(() => {
    if (!filters.useExchangeHours) return true;

    const now = new Date();
    const nyTimeStr = now.toLocaleString("en-US", {timeZone: "America/New_York"});
    const nyTime = new Date(nyTimeStr);
    const hour = nyTime.getHours();
    const minute = nyTime.getMinutes();
    const timeValue = hour + (minute / 60);

    // NYSE Regular Hours: 09:30 - 16:00
    return timeValue >= 9.5 && timeValue < 16;
  }, [filters.useExchangeHours]);

  const scanMarket = useCallback(async () => {
    if (!isSessionActive()) {
        setIsScanning(false);
        return;
    }

    setIsScanning(true);
    try {
      const res = await fetch('/api/binance/ticker24?type=spot');
      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error');
        throw new Error(`HTTP error! status: ${res.status} - ${errorText}`);
      }
      const data: Ticker24h[] = await res.json();
      
      const candidates: MarketAlert[] = [];
      const now = Date.now();

      const relevantPairs = data.filter(t => 
        t.symbol.endsWith('USDT') && 
        parseFloat(t.quoteVolume) >= filters.minVolume
      );

      // Process basic movers directly from ticker data for speed and coverage
      relevantPairs.forEach(t => {
        const pc = parseFloat(t.priceChangePercent);
        const qv = parseFloat(t.quoteVolume);
        
        // 1. Basic Price Movers (Direct from ticker)
        if (Math.abs(pc) >= 3) {
            const isPositive = pc > 0;
            candidates.push({
                id: `${t.symbol}-price`,
                symbol: t.symbol.replace('USDT', ''),
                fullSymbol: t.symbol,
                type: isPositive ? 'PRICE_SURGE' : 'PRICE_DROP',
                severity: Math.abs(pc) > 10 ? 'HIGH' : Math.abs(pc) > 5 ? 'MEDIUM' : 'LOW',
                message: `${isPositive ? '+' : ''}${pc.toFixed(2)}% price change in 24h`,
                firstDetected: now,
                lastUpdated: now,
                value: pc
            });
        }
      });

      // 2. High Volume / Relative Surge (Requires Klines for AVG)
      const topVol = [...relevantPairs].sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume)).slice(0, 30);
      const topMovers = [...relevantPairs].sort((a, b) => Math.abs(parseFloat(b.priceChangePercent)) - Math.abs(parseFloat(a.priceChangePercent))).slice(0, 30);
      const candidatesToCheck = Array.from(new Set([...topVol, ...topMovers]));

      let interval = '15m';
      let limit = filters.lookbackValue + 5;
      
      if (filters.lookbackUnit === 'minutes') { interval = '1m'; }
      else if (filters.lookbackUnit === 'hours') { interval = '1h'; }
      else if (filters.lookbackUnit === 'days') { interval = '1d'; }
      else if (filters.lookbackUnit === 'weeks') { interval = '1w'; }

      const batchSize = 5;
      for (let i = 0; i < candidatesToCheck.length; i += batchSize) {
          const batch = candidatesToCheck.slice(i, i + batchSize);
          await Promise.all(batch.map(async (t) => {
              try {
                  const kres = await fetch(`/api/binance/klines?symbol=${t.symbol}&interval=${interval}&limit=${limit}&type=spot`);
                  if (!kres.ok) return;
                  const klines = await kres.json();
                  if (!Array.isArray(klines) || klines.length < filters.lookbackValue) return;

                  const previousKlines = klines.slice(0, klines.length - 1).slice(-filters.lookbackValue);
                  const currentKline = klines[klines.length - 1];
                  
                  const avgVol = previousKlines.reduce((sum: number, k: any) => sum + parseFloat(k[7]), 0) / previousKlines.length;
                  const currentVol = parseFloat(currentKline[7]);
                  const volChangePct = ((currentVol - avgVol) / avgVol) * 100;

                  if (volChangePct >= filters.minVolChange) {
                    candidates.push({
                        id: `${t.symbol}-vol`,
                        symbol: t.symbol.replace('USDT', ''),
                        fullSymbol: t.symbol,
                        type: 'HIGH_VOLUME',
                        severity: volChangePct > 200 ? 'HIGH' : volChangePct > 100 ? 'MEDIUM' : 'LOW',
                        message: `+${volChangePct.toFixed(0)}% Volume Surge vs ${filters.lookbackValue}p avg`,
                        firstDetected: now,
                        lastUpdated: now,
                        value: currentVol
                    });
                  }
              } catch (e) {
                  // silent skip
              }
          }));
          if (i + batchSize < candidatesToCheck.length) {
              await new Promise(r => setTimeout(r, 100));
          }
      }

      setAlerts(prev => {
          const next = [...prev];
          
          candidates.forEach(cand => {
              const existingIdx = next.findIndex(a => a.id === cand.id);
              if (existingIdx >= 0) {
                  next[existingIdx] = {
                      ...next[existingIdx],
                      value: cand.value,
                      message: cand.message,
                      lastUpdated: now,
                      severity: cand.severity
                  };
              } else {
                  next.push(cand);
              }
          });
          
          const sorted = next.sort((a, b) => b.firstDetected - a.firstDetected).slice(0, 200);

          // Tell backend to auto-ingest the top 10 scanner results
          const topSymbols = Array.from(new Set(sorted.slice(0, 10).map(a => a.fullSymbol.toLowerCase())));
          if (topSymbols.length > 0) {
            fetch('/api/engine/subscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(topSymbols)
            }).catch(e => console.warn("Scanner failed to subscribe assets:", e));
          }

          return sorted;
      });

      setLastScan(now);
    } catch (e) {
      console.error("Scan failed", e);
    } finally {
      setIsScanning(false);
    }
  }, [filters, isSessionActive]);

  useEffect(() => {
    scanMarket();
    const interval = setInterval(scanMarket, 10000);
    return () => clearInterval(interval);
  }, [scanMarket]);

  return {
    alerts,
    isScanning,
    lastScan,
    filters,
    setFilters,
    isSessionActive,
    scanMarket
  };
}
