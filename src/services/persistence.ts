import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Candle } from '../types/market';

interface MarketDB extends DBSchema {
  candles: {
    key: [string, string, string, number]; // [symbol, marketType, interval, time]
    value: Candle & { symbol: string; marketType: string; interval: string };
    indexes: { 'by-context': [string, string, string] };
  };
}

const DB_NAME = 'market-data-db';
const DB_VERSION = 1;

class PersistenceService {
  private dbPromise: Promise<IDBPDatabase<MarketDB>>;

  constructor() {
    this.dbPromise = openDB<MarketDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('candles', {
          keyPath: ['symbol', 'marketType', 'interval', 'time'],
        });
        store.createIndex('by-context', ['symbol', 'marketType', 'interval']);
      },
    });
  }

  async saveCandles(
    symbol: string,
    marketType: string,
    interval: string,
    candles: Candle[]
  ): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('candles', 'readwrite');
    const store = tx.objectStore('candles');

    await Promise.all(
      candles.map((candle) =>
        store.put({
          ...candle,
          symbol,
          marketType,
          interval,
        })
      )
    );
    await tx.done;
  }

  async get1mCandles(symbol: string, marketType: string, startTime: number, endTime: number): Promise<Candle[]> {
    return this.getCandles(symbol, marketType, '1m', startTime, endTime);
  }

  async getCandles(
    symbol: string,
    marketType: string,
    interval: string,
    startTime?: number,
    endTime?: number
  ): Promise<Candle[]> {
    const db = await this.dbPromise;
    const range = IDBKeyRange.bound(
      [symbol, marketType, interval, startTime || 0],
      [symbol, marketType, interval, endTime || Infinity]
    );
    
    // This might be slow if we have millions of records.
    // Ideally we use a cursor or the index.
    // The compound key [symbol, marketType, interval, time] allows range queries naturally
    // because IndexedDB sorts by key.
    // So we can just query the store directly with the range.
    
    const records = await db.getAll('candles', range);
    
    // Map back to pure Candle object (remove extra metadata if needed, though it's fine to keep)
    return records.map(({ symbol, marketType, interval, ...candle }) => candle as Candle);
  }

  async clearHistory(symbol: string, marketType: string, interval: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('candles', 'readwrite');
    const store = tx.objectStore('candles');
    const index = store.index('by-context');
    
    // Delete is tricky with indexes. We might need to iterate and delete.
    // Or just use a range on the main store if the key starts with these 3.
    // Since key is [symbol, marketType, interval, time], we can use a range.
    const range = IDBKeyRange.bound(
      [symbol, marketType, interval, 0],
      [symbol, marketType, interval, Infinity]
    );
    
    // delete(range) is supported in modern IDB
    await store.delete(range);
    await tx.done;
  }
  
  async getLatestCandle(symbol: string, marketType: string, interval: string): Promise<Candle | null> {
      const db = await this.dbPromise;
      const tx = db.transaction('candles', 'readonly');
      const store = tx.objectStore('candles');
      
      const range = IDBKeyRange.bound(
          [symbol, marketType, interval, 0],
          [symbol, marketType, interval, Infinity]
      );
      
      const cursor = await store.openCursor(range, 'prev'); // 'prev' to get the last one
      if (cursor) {
          const { symbol, marketType, interval, ...candle } = cursor.value;
          return candle as Candle;
      }
      return null;
  }

  async getLatestCandles(
    symbol: string,
    marketType: string,
    interval: string,
    limit: number
  ): Promise<Candle[]> {
    const db = await this.dbPromise;
    const tx = db.transaction('candles', 'readonly');
    const store = tx.objectStore('candles');
    
    const range = IDBKeyRange.bound(
      [symbol, marketType, interval, 0],
      [symbol, marketType, interval, Infinity]
    );
    
    const candles: Candle[] = [];
    let cursor = await store.openCursor(range, 'prev');
    
    while (cursor && candles.length < limit) {
      const { symbol: s, marketType: m, interval: i, ...candle } = cursor.value;
      candles.push(candle as Candle);
      cursor = await cursor.continue();
    }
    
    return candles.reverse();
  }
}

export const persistenceService = new PersistenceService();
