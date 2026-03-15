import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Candle, FootprintLevel } from "../types/market";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const INTERVAL_MS: Record<string, number> = {
  '1m': 60000,
  '3m': 180000,
  '5m': 300000,
  '15m': 900000,
  '30m': 1800000,
  '1h': 3600000,
  '2h': 7200000,
  '4h': 14400000,
  '6h': 21600000,
  '8h': 28800000,
  '12h': 43200000,
  '1d': 86400000,
  '3d': 259200000,
  '1w': 604800000,
  '1M': 2592000000,
};

export function aggregateCandles(candles: Candle[], targetInterval: string): Candle[] {
  const ms = INTERVAL_MS[targetInterval];
  if (!ms) return candles;

  const groups = new Map<number, Candle[]>();

  for (const candle of candles) {
    const bucketTime = Math.floor(candle.time / ms) * ms;
    if (!groups.has(bucketTime)) {
      groups.set(bucketTime, []);
    }
    groups.get(bucketTime)!.push(candle);
  }

  const aggregated: Candle[] = [];

  for (const [time, group] of groups.entries()) {
    group.sort((a, b) => a.time - b.time);

    const first = group[0];
    const last = group[group.length - 1];

    const newCandle: Candle = {
      time,
      open: first.open,
      high: Math.max(...group.map(c => c.high)),
      low: Math.min(...group.map(c => c.low)),
      close: last.close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
      isClosed: last.isClosed && (time + ms <= Date.now()), // Heuristic: closed if time passed
      footprint: {},
    };

    for (const c of group) {
      if (c.footprint) {
        for (const [priceStr, level] of Object.entries(c.footprint)) {
          const price = parseFloat(priceStr);
          if (!newCandle.footprint![price]) {
            newCandle.footprint![price] = { ...level };
          } else {
            newCandle.footprint![price].buyVolume += level.buyVolume;
            newCandle.footprint![price].sellVolume += level.sellVolume;
            newCandle.footprint![price].delta += level.delta;
          }
        }
      }
    }
    
    aggregated.push(newCandle);
  }

  return aggregated.sort((a, b) => a.time - b.time);
}
