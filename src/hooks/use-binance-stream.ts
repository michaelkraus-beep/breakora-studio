import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Candle, Ticker, Trade } from '../types/market';
import { persistenceService } from '../services/persistence';
import { aggregateCandles, INTERVAL_MS } from '../lib/utils';

const SPOT_BASE_URL = 'wss://stream.binance.com:9443';
const PERP_BASE_URL = 'wss://fstream.binance.com';

export function useBinanceStream(symbol: string = 'btcusdt', marketType: 'spot' | 'perp' = 'spot', interval: string = '1m') {
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [latency, setLatency] = useState<number>(0);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [tickSize, setTickSize] = useState<number>(0.01);
  const wsRef = useRef<WebSocket | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const currentCandleRef = useRef<Candle | null>(null);
  const isInitialLoadRef = useRef<boolean>(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isLoadingHistoryRef = useRef<boolean>(false);

  // Buffer for trades to avoid too many state updates
  const tradesBuffer = useRef<Trade[]>([]);
  const lastUpdateRef = useRef<number>(0);
  const pendingCandleUpdate = useRef<boolean>(false);
  const minDiffRef = useRef<number>(Infinity);
  const latestLatencyRef = useRef<number>(0);

  // Helper to fetch candles in chunks for any interval
  const fetchCandlesChunked = useCallback(async (
    symbol: string, 
    marketType: string, 
    fetchInterval: string,
    startTime: number, 
    endTime: number, 
    signal?: AbortSignal
  ): Promise<Candle[]> => {
    const MAX_LIMIT = 1000;
    const allCandles: Candle[] = [];
    let currentEndTime = endTime;

    let safetyCounter = 0;
    const MAX_REQUESTS = 20; 

    while (currentEndTime > startTime && safetyCounter < MAX_REQUESTS) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      
      const intervalMs = INTERVAL_MS[fetchInterval] || 60000;
      const limit = Math.min(MAX_LIMIT, Math.ceil((currentEndTime - startTime) / intervalMs));
      if (limit <= 0) break;

      const url = `/api/binance/klines?symbol=${symbol.toUpperCase()}&interval=${fetchInterval}&limit=${MAX_LIMIT}&type=${marketType}&endTime=${currentEndTime}`;
      
      let data;
      let retries = 3;
      let delay = 500;

      while (retries > 0) {
        try {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const res = await fetch(url, { signal });
            if (res.status === 429) {
                delay *= 2;
                throw new Error('Rate limited');
            }
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            data = await res.json();
            break;
        } catch (e: any) {
            if (e.name === 'AbortError') throw e;
            retries--;
            if (retries === 0) throw e;
            await new Promise(r => setTimeout(r, delay));
        }
      }

      if (!data || data.length === 0) break;

      const chunk: Candle[] = data.map((d: any) => ({
        time: d[0],
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5]),
        isClosed: true,
      })).sort((a: Candle, b: Candle) => a.time - b.time);

      const oldestInChunk = chunk[0].time;
      const newestInChunk = chunk[chunk.length - 1].time;

      if (oldestInChunk > currentEndTime) break;

      allCandles.push(...chunk);
      currentEndTime = oldestInChunk - 1;
      safetyCounter++;
    }

    return allCandles.sort((a, b) => a.time - b.time);
  }, []);

  // Fast local load of target interval
  const loadHistoryFromIDB = useCallback(async () => {
      try {
          const localTarget = await persistenceService.getLatestCandles(symbol, marketType, interval, 1000);
          if (localTarget.length > 0) {
              setCandles(localTarget);
              candlesRef.current = localTarget;
              
              // Restore live aggregator buffer purely from recent 1m local if available
              const targetMs = INTERVAL_MS[interval] || 60000;
              const now = Date.now();
              const currentIntervalStart = Math.floor(now / targetMs) * targetMs;
              const local1m = await persistenceService.getLatestCandles(symbol, marketType, '1m', 1000);
              const recent1m = local1m.filter(c => c.time >= currentIntervalStart);
              recent1m.forEach(c => currentIntervalBuffer.current.set(c.time, c));

              return true;
          }
      } catch (e) {
          console.warn("Failed to load local history", e);
      }
      return false;
  }, [symbol, marketType, interval]);

  // Instant fetch of missing target interval data
  const fetchTargetHistoryFromAPI = useCallback(async (requestEndTime?: number, signal?: AbortSignal): Promise<boolean> => {
      try {
          let fetchEnd = requestEndTime;
          let fetchStart: number;
          const targetMs = INTERVAL_MS[interval] || 60000;
          const requiredDuration = 500 * targetMs;

          if (!fetchEnd) {
              const lastCandle = candlesRef.current[candlesRef.current.length - 1];
              if (lastCandle) {
                  if (Date.now() - lastCandle.time > 60000) {
                      fetchEnd = Date.now();
                      fetchStart = lastCandle.time - targetMs; // Fetch just enough to cover the gap
                  } else {
                      fetchEnd = candlesRef.current[0].time - 1;
                      fetchStart = fetchEnd - requiredDuration;
                  }
              } else {
                  fetchEnd = Date.now();
                  fetchStart = fetchEnd - requiredDuration;
              }
          } else {
              fetchStart = fetchEnd - requiredDuration;
          }

          const newTargetCandles = await fetchCandlesChunked(symbol, marketType, interval, fetchStart, fetchEnd, signal);
          
          if (newTargetCandles.length === 0) {
              if (requestEndTime) setHasMoreHistory(false);
              return false;
          }

          setCandles(prev => {
            if (signal?.aborted) return prev;
            const combined = [...newTargetCandles, ...prev];
            const uniqueMap = new Map<number, Candle>();
            
            for (const c of combined) {
                if (uniqueMap.has(c.time)) {
                    const existing = uniqueMap.get(c.time)!;
                    const merged = { ...existing, ...c };
                    if (existing.footprint) merged.footprint = { ...existing.footprint, ...(c.footprint || {}) };
                    else if (c.footprint) merged.footprint = { ...c.footprint };
                    uniqueMap.set(c.time, merged);
                } else {
                    uniqueMap.set(c.time, { ...c });
                }
            }
            const sorted = Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time);
            candlesRef.current = sorted;
            if (sorted.length > 0) {
                const latest = sorted[sorted.length - 1];
                if (!latest.isClosed) currentCandleRef.current = latest;
            }
            
            persistenceService.saveCandles(symbol, marketType, interval, newTargetCandles).catch(console.error);

            return sorted;
          });
          
          return true;
      } catch (e: any) {
          if (e.name === 'AbortError') return false;
          console.error("Failed to fetch API history", e);
          return false;
      }
  }, [symbol, marketType, interval, fetchCandlesChunked]);

  const fetchMoreHistory = useCallback(async (requestEndTime?: number) => {
    if (isLoadingHistoryRef.current) return false;
    if (requestEndTime && !hasMoreHistory) return false;
    
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    setIsLoadingHistory(true);
    isLoadingHistoryRef.current = true;
    
    try {
        return await fetchTargetHistoryFromAPI(requestEndTime, controller.signal);
    } finally {
        setIsLoadingHistory(false);
        isLoadingHistoryRef.current = false;
        abortControllerRef.current = null;
    }
  }, [fetchTargetHistoryFromAPI, hasMoreHistory]);

  useEffect(() => {
    if (!symbol) return;

    let isMounted = true;

    // Reset state on symbol change
    setTicker(null);
    setTrades([]);
    setCandles([]);
    setLatency(0);
    setHasMoreHistory(true);
    setTickSize(0.01);
    setIsLoadingHistory(false);
    isLoadingHistoryRef.current = false;
    
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
    }

    candlesRef.current = [];
    currentCandleRef.current = null;
    isInitialLoadRef.current = true;
    tradesBuffer.current = [];
    lastUpdateRef.current = 0;
    pendingCandleUpdate.current = false;
    minDiffRef.current = Infinity;
    latestLatencyRef.current = 0;

    // Close previous socket if it exists (safety check)
    if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
    }

    const baseUrl = marketType === 'spot' ? SPOT_BASE_URL : PERP_BASE_URL;
    // Always subscribe to 1m kline for the "Source of Truth"
    // But also subscribe to the target interval kline for real-time updates?
    // If we only subscribe to 1m, we have to aggregate in real-time.
    // That's cleaner for "Single Source of Truth".
    // Let's try subscribing ONLY to 1m kline and aggregating it for the current candle.
    // Wait, if we subscribe to 1m, we get updates every 2s (or tick).
    // We can aggregate that into the current '5m' candle in real-time.
    // This ensures perfect consistency.
    
    const streams = [
        `${symbol.toLowerCase()}@ticker`,
        `${symbol.toLowerCase()}@trade`,
        `${symbol.toLowerCase()}@kline_1m` // Always 1m
    ].join('/');
    
    let ws: WebSocket | null = null;
    let reconnectTimer: any;
    let reconnectAttempts = 0;
    const maxReconnects = 8;

    const connect = () => {
        if (!isMounted) return;

        ws = new WebSocket(`${baseUrl}/stream?streams=${streams}`);
        wsRef.current = ws;

        ws.onopen = () => {
            if (!isMounted) {
                ws?.close();
                return;
            }
            reconnectAttempts = 0;
        };

        ws.onmessage = (event) => {
          if (!isMounted || ws !== wsRef.current) return;
          
          try {
              let data;
              try {
                  const msg = JSON.parse(event.data);
                  data = msg.data || msg;
              } catch (e) {
                  return;
              }
              
              if (!data) return;

              if (data.s && data.s.toLowerCase() !== symbol.toLowerCase()) return;

              const eventType = data.e;
              
              if (data.E) {
                const now = Date.now();
                const diff = now - data.E;
                if (diff < minDiffRef.current) {
                    minDiffRef.current = diff;
                }
                latestLatencyRef.current = Math.max(0, diff - minDiffRef.current);
              }

              if (eventType === '24hrTicker') {
                setTicker({
                  symbol: data.s,
                  price: parseFloat(data.c),
                  priceChangePercent: parseFloat(data.P),
                  high: parseFloat(data.h),
                  low: parseFloat(data.l),
                  volume: parseFloat(data.v),
                  quoteVolume: parseFloat(data.q),
                  count: parseInt(data.n),
                });
              } else if (eventType === 'trade') {
                const price = parseFloat(data.p);
                const quantity = parseFloat(data.q);
                
                if (isNaN(price) || isNaN(quantity)) return;

                const trade: Trade = {
                  id: data.t,
                  price: price,
                  quantity: quantity,
                  time: data.T,
                  isBuyerMaker: data.m,
                };
                
                tradesBuffer.current = [trade, ...tradesBuffer.current].slice(0, 50);
                updateFootprintFromTrade(trade);
              } else if (eventType === 'kline') {
                // This is always a 1m kline now
                updateCandleFrom1mKline(data.k);
              }
          } catch (e) {
              console.error("WS message error", e);
          }
        };

        ws.onclose = (event) => {
            if (!isMounted) return;
            reconnectAttempts++;
            if (reconnectAttempts > maxReconnects) return;
            const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 15000);
            reconnectTimer = setTimeout(connect, delay);
        };
        
        ws.onerror = () => {
            if (!isMounted) return;
            ws?.close();
        };
    };

    connect();

    const flushInterval = setInterval(() => {
        if (!isMounted) return;
        setLatency(latestLatencyRef.current);

        if (pendingCandleUpdate.current) {
            setCandles([...candlesRef.current]);
            pendingCandleUpdate.current = false;
            
            // Save the latest candle(s) to IDB for the CURRENT interval
            // This persists the footprints and real-time updates
            if (candlesRef.current.length > 0) {
                const latest = candlesRef.current.slice(-2); // Save last 2 to be safe (current and just closed)
                persistenceService.saveCandles(symbol, marketType, interval, latest).catch(console.error);
            }
        }
        
        if (tradesBuffer.current.length > 0) {
             setTrades([...tradesBuffer.current]);
        }
    }, 100);

    return () => {
      isMounted = false;
      clearInterval(flushInterval);
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
      wsRef.current = null;
    };
  }, [symbol, marketType, interval]);

  // Updated to handle 1m kline updates and aggregate them into target interval
  const updateCandleFrom1mKline = (k: any) => {
    const kline1m: Candle = {
        time: k.t,
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
        isClosed: k.x,
        footprint: {}
    };

    // 1. Save 1m candle to IDB (if closed, or maybe every update?)
    // Saving every update is too heavy. Save only when closed.
    if (kline1m.isClosed) {
        persistenceService.saveCandles(symbol, marketType, '1m', [kline1m]).catch(console.error);
    }

    // 2. Aggregate into current target interval candle
    const targetMs = INTERVAL_MS[interval] || 60000;
    const targetTime = Math.floor(kline1m.time / targetMs) * targetMs;
    
    const existingIdx = candlesRef.current.findIndex(c => c.time === targetTime);
    
    if (existingIdx !== -1) {
        const existing = candlesRef.current[existingIdx];
        
        // We need to merge the 1m kline into the target candle.
        // Since we don't have the full history of 1m candles for this target candle in memory (we only have the aggregated result),
        // we have to be careful.
        // Ideally, we should maintain the "Current Target Candle" state by accumulating 1m updates.
        
        // Logic:
        // Open is existing.open (unless this is the first 1m of the target?)
        // High is max(existing.high, kline1m.high)
        // Low is min(existing.low, kline1m.low)
        // Close is kline1m.close (always latest)
        // Volume is... tricky. 'existing.volume' is sum of previous 1m candles?
        // If we just add kline1m.volume, we might double count if we process multiple updates for same 1m candle.
        // BUT, kline stream gives cumulative volume for the 1m candle.
        // So we can't just add.
        
        // Better approach:
        // We need to know if this 1m candle is NEW to the target candle or an update to an existing 1m candle inside it.
        // This is getting complicated to do purely incrementally without the constituent 1m candles.
        
        // Simplified approach for "Real-time Aggregation":
        // We can trust the High/Low/Close/Volume from the 1m kline update for the *current moment*,
        // but for the *Target Candle*, we need to know the state of the *other* 1m candles in this interval.
        
        // Since we loaded history from IDB (aggregated), we have the base state.
        // As new 1m candles come in (sequentially), we can update the target candle.
        
        // If kline1m.time > last_processed_1m_time, it's a new 1m candle. Add volume.
        // If kline1m.time == last_processed_1m_time, it's an update. Update volume delta.
        
        // This requires tracking `lastProcessed1mTime` and `lastProcessed1mVolume`.
        // Let's attach this metadata to the currentCandleRef or a separate ref.
        
        // Hack: For High/Low/Close, it's easy.
        // For Volume: We can just re-aggregate if we had the list.
        // Since we don't, maybe we can just use the Ticker volume? No, that's 24h.
        
        // Let's use a simpler heuristic:
        // If we are in the "Live" candle, we can just update High/Low/Close.
        // For Volume, we can accumulate `k.v` (volume of this 1m candle).
        // But `k.v` is cumulative for the 1m candle.
        // So we need to track the volume of the *current 1m candle* we have already added to the target.
        
        // Let's store `current1mCandle` in a ref.
    }
    
    // RE-THINK:
    // If we want "Single Source of Truth", we should probably maintain a buffer of 1m candles for the *current* target interval in memory.
    // When a new 1m kline comes, update that buffer, then re-aggregate the target candle from that buffer.
    // This is robust.
    
    // We need a map of `time -> 1mCandle` for the current target interval.
    // `currentIntervalBuffer` ref.
    
    updateCurrentIntervalBuffer(kline1m, targetTime, targetMs);
  };
  
  const currentIntervalBuffer = useRef<Map<number, Candle>>(new Map());
  
  const updateCurrentIntervalBuffer = (kline1m: Candle, targetTime: number, targetMs: number) => {
      // 1. Clean buffer of old candles (from previous intervals)
      for (const t of currentIntervalBuffer.current.keys()) {
          if (t < targetTime) {
              currentIntervalBuffer.current.delete(t);
          }
      }
      
      // 2. Update/Insert current 1m candle
      currentIntervalBuffer.current.set(kline1m.time, kline1m);
      
      // 3. Aggregate buffer to create/update target candle
      const candlesInBuffer: Candle[] = Array.from(currentIntervalBuffer.current.values());
      if (candlesInBuffer.length === 0) return;
      
      const aggregated = aggregateCandles(candlesInBuffer, interval)[0];
      
      // 4. Update main candles state
      const existingIdx = candlesRef.current.findIndex(c => c.time === targetTime);
      if (existingIdx !== -1) {
          // Merge with existing (which might have history from IDB that is not in buffer?)
          // Wait, if we loaded from IDB, we have the "started" target candle.
          // But we don't have the constituent 1m candles in the buffer yet (unless we loaded them).
          // So `aggregated` only contains the *new* 1m candles we saw since stream start.
          // This is a problem. The volume will be too low (only new 1m candles).
          
          // Fix: When loading from IDB, we should populate `currentIntervalBuffer` with the 1m candles that make up the latest target candle.
          // We can do this in `fetchMoreHistory` (initial load).
          
          const existing = candlesRef.current[existingIdx];
          
          // If the buffer covers the *entire* duration of the target candle so far, `aggregated` is authoritative.
          // But we might have missed some 1m candles if we just connected.
          // However, we loaded history. So we should have them.
          
          // Let's assume `existing` is the base. We want to update it with `kline1m`.
          // If we use the "Buffer" strategy, we need the buffer to be complete.
          
          // Alternative: Just update `existing` with `kline1m` directly.
          // NewHigh = max(existing.high, kline1m.high)
          // NewLow = min(existing.low, kline1m.low)
          // NewClose = kline1m.close
          // NewVolume = existing.volume - (old_vol_of_this_1m) + kline1m.volume
          // This requires tracking `old_vol_of_this_1m`.
          
          const previousVersionOf1m = currentIntervalBuffer.current.get(kline1m.time); // Wait, we just set it.
          // We need the *previous* value before we updated the map.
          // But we updated the map in step 2.
          
          // Let's refine:
          // We need to track the contribution of each 1m candle to the target candle.
          // `currentIntervalBuffer` is perfect for this.
          // But we need to initialize it correctly.
          
          // If `currentIntervalBuffer` is empty, but we have an `existing` target candle:
          // We are in a "partial state".
          // We can't easily reconstruct the buffer without fetching 1m data for the current open candle.
          // LUCKILY, `fetchMoreHistory` loads ALL 1m data.
          // So we CAN populate the buffer!
          
          // So: In `fetchMoreHistory`, if we have an open candle at the end, populate `currentIntervalBuffer` with its constituent 1m candles.
          
          candlesRef.current[existingIdx] = {
             ...existing,
             high: Math.max(existing.high, aggregated.high),
             low: Math.min(existing.low, aggregated.low),
             close: aggregated.close,
             volume: existing.volume + (aggregated.volume - (existing.tempBufferVolume || 0)), // Delta logic? No.
             // If we rely on `aggregated` being correct, we need `candlesInBuffer` to be ALL 1m candles for this interval.
             // If we populated the buffer on load, this works.
             
             // Let's try to make `aggregated` authoritative.
             // This requires `currentIntervalBuffer` to have ALL 1m candles for the current target interval.
             // We will ensure this in `fetchMoreHistory`.
             ...aggregated,
             footprint: { ...existing.footprint, ...aggregated.footprint } // Merge footprint
          };
      } else {
          candlesRef.current.push(aggregated);
          candlesRef.current.sort((a, b) => a.time - b.time);
      }
      
      currentCandleRef.current = candlesRef.current.find(c => c.time === targetTime) || null;
      pendingCandleUpdate.current = true;
  };

  const updateFootprintFromTrade = (tick: Trade) => {
    if (!currentCandleRef.current) return;
    
    const c = currentCandleRef.current;
    const targetMs = INTERVAL_MS[interval] || 60000;
    const tickCandleTime = Math.floor(tick.time / targetMs) * targetMs;

    if (tickCandleTime !== c.time) return;

    if (!c.footprint) c.footprint = {};
    
    const priceKey = tick.price; 
    if (!c.footprint[priceKey]) {
        c.footprint[priceKey] = { price: priceKey, buyVolume: 0, sellVolume: 0, delta: 0 };
    }
    
    const level = c.footprint[priceKey];
    const quoteVolume = tick.quantity * tick.price;
    
    if (tick.isBuyerMaker) {
        level.sellVolume += quoteVolume;
        level.delta -= quoteVolume;
    } else {
        level.buyVolume += quoteVolume;
        level.delta += quoteVolume;
    }

    pendingCandleUpdate.current = true;
  };

  // Initial fetch for historical klines and exchange info
  useEffect(() => {
    let isMounted = true;

    const fetchExchangeInfo = async () => {
        try {
            const res = await fetch(`/api/binance/exchangeInfo?type=${marketType}`);
            if (!isMounted) return;
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const data = await res.json();
            if (!isMounted) return;
            const symbolInfo = data.symbols.find((s: any) => s.symbol === symbol.toUpperCase());
            if (symbolInfo) {
                const priceFilter = symbolInfo.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
                if (priceFilter) {
                    setTickSize(parseFloat(priceFilter.tickSize));
                }
            }
        } catch (e) {
            console.error("Failed to fetch exchange info", e);
        }
    };

    const loadInitialData = async () => {
        if (isLoadingHistoryRef.current) return;
        setIsLoadingHistory(true);
        isLoadingHistoryRef.current = true;
        
        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            await fetchExchangeInfo();
            if (!isMounted) return;
            
            // 1. Load from IDB immediately to show something
            await loadHistoryFromIDB();
            
            if (!isMounted) return;

            // 2. Fetch from API with retries for target interval missing parts
            let retries = 5;
            let success = false;
            
            while (retries > 0 && isMounted && !success) {
                if (controller.signal.aborted) break;
                
                success = await fetchTargetHistoryFromAPI(undefined, controller.signal);
                if (!success) {
                    console.warn(`Initial API history load failed, retrying... (${retries} attempts left)`);
                    retries--;
                    if (retries > 0 && isMounted && !controller.signal.aborted) {
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }
            }
            
            if (!isMounted || controller.signal.aborted) return;
            
            const targetMs = INTERVAL_MS[interval] || 60000;
            const now = Date.now();
            const currentIntervalStart = Math.floor(now / targetMs) * targetMs;
            
            try {
                // Prime 1m buffer just for the CURRENT interval
                const recent1m = await fetchCandlesChunked(symbol, marketType, '1m', currentIntervalStart, now, controller.signal);
                recent1m.forEach(c => currentIntervalBuffer.current.set(c.time, c));
                await persistenceService.saveCandles(symbol, marketType, '1m', recent1m);
            } catch (e) {
                console.warn("Failed to prime interval buffer", e);
            }

            // 3. Start slow background 1m footprint backfill
            const startBackgroundBackfill = async (signal: AbortSignal) => {
                const fourWeeksMs = 4 * 7 * 24 * 60 * 60 * 1000;
                let currentEnd = Date.now();
                const limitTime = currentEnd - fourWeeksMs;
                
                while (currentEnd > limitTime) {
                    if (signal.aborted) break;
                    const chunkStart = currentEnd - (1000 * 60000); // 1000 mins per chunk
                    
                    try {
                        const local1m = await persistenceService.get1mCandles(symbol, marketType, chunkStart, currentEnd);
                        if (local1m.length < 900) { 
                            const new1m = await fetchCandlesChunked(symbol, marketType, '1m', chunkStart, currentEnd, signal);
                            if (new1m.length > 0) {
                                await persistenceService.saveCandles(symbol, marketType, '1m', new1m);
                            }
                            await new Promise(r => setTimeout(r, 2000)); 
                        }
                    } catch (e: any) {
                        if (e.name === 'AbortError') break;
                        await new Promise(r => setTimeout(r, 5000));
                    }
                    currentEnd = chunkStart - 1;
                }
            };

            startBackgroundBackfill(controller.signal);

        } finally {
            if (isMounted) {
                setIsLoadingHistory(false);
                isLoadingHistoryRef.current = false;
                if (abortControllerRef.current === controller) {
                    abortControllerRef.current = null;
                }
            }
        }
    };

    loadInitialData();

    return () => {
        isMounted = false;
    };
  }, [symbol, marketType, interval]);

  // ---------------------------------------------------------------------------
  // Footprint overlay: fetch stored footprint data from backend DB and merge
  // into existing candle array. The backend stores 1m candles with real
  // buyVolume/sellVolume per price level. For higher timeframes the backend
  // aggregates these 1m rows on the fly.
  // We fetch up to 1500 1m candles (covers 25h) and merge footprint data into
  // whichever candles in `candlesRef` have a matching time bucket.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let isMounted = true;

    const mergeFootprints = async () => {
      // Wait a moment so the initial candle load is likely done
      await new Promise(r => setTimeout(r, 3000));
      if (!isMounted) return;

      try {
        const res = await fetch(
          `/api/history?symbol=${symbol.toLowerCase()}&interval=1m&limit=1500`
        );
        if (!res.ok) return;
        const json = await res.json();
        const fpCandles: { time: number; footprint: any }[] = json?.data ?? [];

        if (fpCandles.length === 0 || !isMounted) return;

        // Build a quick lookup map: 1m-candle-time → footprint
        const fpMap = new Map<number, any>();
        for (const c of fpCandles) {
          if (c.footprint && Object.keys(c.footprint).length > 0) {
            fpMap.set(c.time, c.footprint);
          }
        }

        if (fpMap.size === 0) return;

        // For each target-interval candle, merge in all constituent 1m footprints
        const targetMs = INTERVAL_MS[interval] || 60000;

        setCandles(prev => {
          if (!isMounted) return prev;
          let changed = false;
          const updated = prev.map(candle => {
            // Find all 1m keys that fall within this target-interval bucket
            const bucketStart = (Math.floor(candle.time / targetMs)) * targetMs;
            const bucketEnd = bucketStart + targetMs;

            const mergedFp: any = { ...(candle.footprint || {}) };
            let added = false;

            fpMap.forEach((fp, t) => {
              if (t >= bucketStart && t < bucketEnd) {
                for (const [priceStr, level] of Object.entries(fp as any)) {
                  if (!mergedFp[priceStr]) {
                    mergedFp[priceStr] = { ...(level as any) };
                    added = true;
                  } else {
                    const existing = mergedFp[priceStr];
                    const l = level as any;
                    existing.buyVolume += l.buyVolume ?? 0;
                    existing.sellVolume += l.sellVolume ?? 0;
                    existing.delta += l.delta ?? 0;
                    added = true;
                  }
                }
              }
            });

            if (added) {
              changed = true;
              return { ...candle, footprint: mergedFp };
            }
            return candle;
          });
          if (!changed) return prev;
          candlesRef.current = updated;
          return updated;
        });
      } catch (e) {
        console.warn('[FootprintOverlay] Failed to fetch footprints:', e);
      }
    };

    mergeFootprints();

    return () => { isMounted = false; };
  }, [symbol, marketType, interval]);

  return useMemo(() => ({
    ticker,
    trades,
    candles,
    latency,
    fetchMoreHistory,
    isLoadingHistory,
    hasMoreHistory,
    tickSize
  }), [ticker, trades, candles, latency, fetchMoreHistory, isLoadingHistory, hasMoreHistory, tickSize]);
}
