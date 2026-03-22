import { Candle, Ticker, Trade } from '../types/market';
import { aggregateCandles, INTERVAL_MS } from '../lib/utils';
import { persistenceService } from './persistence';

const SPOT_BASE_URL = 'wss://stream.binance.com:9443';
const PERP_BASE_URL = 'wss://fstream.binance.com';

export interface StreamData {
    ticker: Ticker | null;
    trades: Trade[];
    candles: Candle[];
    latency: number;
    tickSize: number;
    isLoadingHistory: boolean;
}

export type StreamCallback = (data: StreamData) => void;

class StreamSession {
    public symbol: string;
    public marketType: 'spot' | 'perp';
    public interval: string;
    
    private subscribers: Set<StreamCallback> = new Set();
    private ws: WebSocket | null = null;
    private data: StreamData = {
        ticker: null,
        trades: [],
        candles: [],
        latency: 0,
        tickSize: 0.01,
        isLoadingHistory: false
    };

    private candlesRef: Candle[] = [];
    private currentCandleRef: Candle | null = null;
    private currentIntervalBuffer: Map<number, Candle> = new Map();
    private tradesBuffer: Trade[] = [];
    private minDiff = Infinity;
    private latestLatency = 0;
    private reconnectAttempts = 0;
    private maxReconnects = 8;
    
    constructor(symbol: string, marketType: 'spot' | 'perp', interval: string) {
        this.symbol = symbol;
        this.marketType = marketType;
        this.interval = interval;
        this.init();
    }

    public subscribe(callback: StreamCallback) {
        this.subscribers.add(callback);
        callback(this.data);
    }

    public unsubscribe(callback: StreamCallback) {
        this.subscribers.delete(callback);
    }

    public get subscriberCount() {
        return this.subscribers.size;
    }

    private async init() {
        this.data.isLoadingHistory = true;
        this.notify();

        await this.fetchExchangeInfo();
        await this.loadInitialData(); // Load IDB + API
        this.connectWS();

        this.data.isLoadingHistory = false;
        this.notify();

        const flushInterval = setInterval(() => {
            this.flush();
        }, 100);

        // Store interval for disposal
        (this as any)._flushInterval = flushInterval;

        const saveInterval = setInterval(() => {
            this.saveToPersistence();
        }, 10000); // Save every 10 seconds
        (this as any)._saveInterval = saveInterval;
    }

    private async saveToPersistence() {
        if (this.candlesRef.length === 0) return;
        // Save latest 500 candles (including footprints)
        const toSave = this.candlesRef.slice(-500);
        await persistenceService.saveCandles(this.symbol, this.marketType, this.interval, toSave);
    }

    private async fetchExchangeInfo() {
        try {
            const res = await fetch(`/api/binance/exchangeInfo?type=${this.marketType}`);
            const data = await res.json();
            const symbolInfo = data.symbols.find((s: any) => s.symbol === this.symbol.toUpperCase());
            if (symbolInfo) {
                const priceFilter = symbolInfo.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
                if (priceFilter) this.data.tickSize = parseFloat(priceFilter.tickSize);
            }
        } catch (e) {
            console.error("Failed to fetch exchange info", e);
        }
    }

    private async loadInitialData() {
        try {
            // 1. Load from IDB
            const local = await persistenceService.getLatestCandles(this.symbol, this.marketType, this.interval, 1000);
            const idbMap = new Map<number, Candle>();
            local.forEach(c => idbMap.set(c.time, c));

            if (local.length > 0) {
                const targetMs = INTERVAL_MS[this.interval] || 60000;
                const now = Date.now();
                const currentIntervalStart = Math.floor(now / targetMs) * targetMs;
                const local1m = await persistenceService.getLatestCandles(this.symbol, this.marketType, '1m', 1500);
                local1m.forEach(c => {
                    if (c.time >= currentIntervalStart) {
                        this.currentIntervalBuffer.set(c.time, c);
                    }
                });
            }

            // 2. Fetch from API
            const res = await fetch(`/api/binance/klines?symbol=${this.symbol.toUpperCase()}&interval=${this.interval}&limit=1000&type=${this.marketType}`);
            const apiData = await res.json();
            const apiCandles: Candle[] = apiData.map((d: any) => ({
                time: d[0], open: parseFloat(d[1]), high: parseFloat(d[2]),
                low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5]),
                isClosed: true
            }));

            // Intelligent Merge: Preserve IDB footprint data if available
            const finalCandlesMap = new Map<number, Candle>();
            
            // Start with API candles
            apiCandles.forEach(c => finalCandlesMap.set(c.time, c));
            
            // Overwrite with IDB candles if they have footprints, or are missing from API
            local.forEach(idbC => {
                const apiC = finalCandlesMap.get(idbC.time);
                if (!apiC || (idbC.footprint && Object.keys(idbC.footprint).length > 0)) {
                    finalCandlesMap.set(idbC.time, idbC);
                }
            });

            this.candlesRef = Array.from(finalCandlesMap.values()).sort((a, b) => a.time - b.time);
            this.data.candles = this.candlesRef;
            
            // Re-sync current candle from buffer if possible
            if (this.currentIntervalBuffer.size > 0) {
                const targetMs = INTERVAL_MS[this.interval] || 60000;
                const now = Date.now();
                const currentIntervalStart = Math.floor(now / targetMs) * targetMs;
                const currentBufferArr = Array.from(this.currentIntervalBuffer.values()).filter(c => c.time >= currentIntervalStart);
                if (currentBufferArr.length > 0) {
                    const aggregated = aggregateCandles(currentBufferArr, this.interval)[0];
                    const existingIdx = this.candlesRef.findIndex(c => c.time === currentIntervalStart);
                    if (existingIdx !== -1) {
                         const existing = this.candlesRef[existingIdx];
                         this.candlesRef[existingIdx] = { 
                             ...existing, 
                             ...aggregated, 
                             footprint: { ...(existing.footprint || {}), ...(aggregated.footprint || {}) } 
                         };
                    } else {
                        this.candlesRef.push(aggregated);
                        this.candlesRef.sort((a, b) => a.time - b.time);
                    }
                }
            }

            if (this.candlesRef.length > 0) {
                const latest = this.candlesRef[this.candlesRef.length - 1];
                if (!latest.isClosed) this.currentCandleRef = latest;
            }
        } catch (e) {
            console.error("Failed to load initial data", e);
        }
    }

    private connectWS() {
        const baseUrl = this.marketType === 'spot' ? SPOT_BASE_URL : PERP_BASE_URL;
        const streams = [
            `${this.symbol.toLowerCase()}@ticker`,
            `${this.symbol.toLowerCase()}@trade`,
            `${this.symbol.toLowerCase()}@kline_1m`
        ].join('/');

        this.ws = new WebSocket(`${baseUrl}/stream?streams=${streams}`);
        this.ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            const data = msg.data || msg;
            if (!data) return;

            if (data.E) {
                const now = Date.now();
                const diff = now - data.E;
                if (diff < this.minDiff) this.minDiff = diff;
                this.latestLatency = Math.max(0, diff - this.minDiff);
            }

            if (data.e === '24hrTicker') {
                this.data.ticker = {
                    symbol: data.s, price: parseFloat(data.c), priceChangePercent: parseFloat(data.P),
                    high: parseFloat(data.h), low: parseFloat(data.l), volume: parseFloat(data.v),
                    quoteVolume: parseFloat(data.q), count: parseInt(data.n),
                };
            } else if (data.e === 'trade') {
                const trade: Trade = {
                    id: data.t, price: parseFloat(data.p), quantity: parseFloat(data.q),
                    time: data.T, isBuyerMaker: data.m,
                };
                this.tradesBuffer = [trade, ...this.tradesBuffer].slice(0, 50);
                this.updateFootprintFromTrade(trade);
            } else if (data.e === 'kline') {
                this.updateCandleFrom1mKline(data.k);
            }
        };

        this.ws.onclose = () => {
            if (this.reconnectAttempts < this.maxReconnects) {
                this.reconnectAttempts++;
                setTimeout(() => this.connectWS(), 2000);
            }
        };
    }

    private updateCandleFrom1mKline(k: any) {
        const targetMs = INTERVAL_MS[this.interval] || 60000;
        const targetTime = Math.floor(k.t / targetMs) * targetMs;

        // Preserve existing footprint data from the buffer if we have it for this specific 1m interval
        const existing1m = this.currentIntervalBuffer.get(k.t);
        const kline1m: Candle = {
            time: k.t, 
            open: parseFloat(k.o), 
            high: parseFloat(k.h),
            low: parseFloat(k.l), 
            close: parseFloat(k.c), 
            volume: parseFloat(k.v),
            isClosed: k.x, 
            footprint: existing1m?.footprint || {}
        };

        this.currentIntervalBuffer.set(kline1m.time, kline1m);
        const candlesInBuffer = Array.from(this.currentIntervalBuffer.values()).filter(c => c.time >= targetTime);
        if (candlesInBuffer.length === 0) return;

        const aggregated = aggregateCandles(candlesInBuffer, this.interval)[0];
        const existingIdx = this.candlesRef.findIndex(c => c.time === targetTime);
        if (existingIdx !== -1) {
            // Merging aggregated data but MUST preserve and merge footprints deep
            const current = this.candlesRef[existingIdx];
            this.candlesRef[existingIdx] = { 
                ...current, 
                ...aggregated,
                footprint: { ...(current.footprint || {}), ...(aggregated.footprint || {}) }
            };
        } else {
            this.candlesRef.push(aggregated);
            this.candlesRef.sort((a, b) => a.time - b.time);
        }
        this.currentCandleRef = this.candlesRef.find(c => c.time === targetTime) || null;
    }

    private updateFootprintFromTrade(tick: Trade) {
        if (!this.currentCandleRef) return;
        const c = this.currentCandleRef;
        const targetMs = INTERVAL_MS[this.interval] || 60000;
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
    }

    private flush() {
        this.data.latency = this.latestLatency;
        this.data.trades = [...this.tradesBuffer];
        this.data.candles = [...this.candlesRef];
        this.notify();
    }

    private notify() {
        this.subscribers.forEach(cb => cb({ ...this.data }));
    }

    public dispose() {
        if (this.ws) this.ws.close();
        if ((this as any)._flushInterval) clearInterval((this as any)._flushInterval);
        this.subscribers.clear();
        if ((this as any)._saveInterval) clearInterval((this as any)._saveInterval);
    }
}

class SharedStreamService {
    private sessions: Map<string, StreamSession> = new Map();
    private disposalTimers: Map<string, any> = new Map();
    private static instance: SharedStreamService;

    private constructor() {}

    public static getInstance(): SharedStreamService {
        if (!SharedStreamService.instance) SharedStreamService.instance = new SharedStreamService();
        return SharedStreamService.instance;
    }

    public subscribe(symbol: string, marketType: 'spot' | 'perp', interval: string, callback: StreamCallback) {
        const key = `${symbol}-${marketType}-${interval}`;
        
        // Cancel pending disposal if any
        if (this.disposalTimers.has(key)) {
            clearTimeout(this.disposalTimers.get(key));
            this.disposalTimers.delete(key);
        }

        let session = this.sessions.get(key);
        if (!session) {
            session = new StreamSession(symbol, marketType, interval);
            this.sessions.set(key, session);
        }
        session.subscribe(callback);

        return () => {
            session!.unsubscribe(callback);
            if (session!.subscriberCount === 0) {
                // Delay disposal by 5 minutes to handle background recording and tab switching
                const timer = setTimeout(() => {
                    session!.dispose();
                    this.sessions.delete(key);
                    this.disposalTimers.delete(key);
                }, 300000); // 5 minutes
                this.disposalTimers.set(key, timer);
            }
        };
    }
}

export const sharedStreamService = SharedStreamService.getInstance();
