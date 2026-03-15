"""
historical_backfill.py
======================
Background service that populates the 1m candle database with historical data
from the Binance REST API.

Strategy:
  1. On startup, immediately fetch the last 24h of 1m klines for every
     (symbol, market_type) pair and upsert them into the DB.
  2. Then slowly walk backwards to 4 weeks, 1000-candle chunks at a time,
     with a 2-second pause between requests to avoid rate-limiting.
  3. Each chunk is checked first — if we already have >= 900 rows for that
     time window we skip it (idempotent).
  4. Fetched candles have empty footprint dicts; real footprint data is
     added by the live MarketEngine stream for candles captured in real-time.
"""

import asyncio
import httpx
from sqlalchemy import select, func
from database import AsyncSessionLocal
from models import Candle

BINANCE_REST = {
    'spot': 'https://api.binance.com/api/v3/klines',
    'perp': 'https://fapi.binance.com/fapi/v1/klines',
}
CHUNK = 1000
DELAY_S = 2.0
FOUR_WEEKS_MS = 4 * 7 * 24 * 60 * 60 * 1000
ONE_MINUTE_MS = 60_000

# Pairs to backfill — extend as needed
PAIRS = [
    ('btcusdt', 'spot'),
    ('ethusdt', 'spot'),
    ('solusdt', 'spot'),
    ('bnbusdt', 'spot'),
    ('adausdt', 'spot'),
    ('xrpusdt', 'spot'),
    ('dotusdt', 'spot'),
    ('linkusdt', 'spot'),
]


async def fetch_klines(symbol: str, market_type: str, end_time_ms: int, limit: int = CHUNK) -> list[dict]:
    """Fetch up to `limit` 1m klines ending at end_time_ms from Binance REST."""
    url = BINANCE_REST.get(market_type, BINANCE_REST['spot'])
    params = {
        'symbol': symbol.upper(),
        'interval': '1m',
        'endTime': end_time_ms,
        'limit': limit,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        raw = resp.json()

    candles = []
    for d in raw:
        candles.append({
            'symbol': symbol.lower(),
            'market_type': market_type,
            'interval': '1m',
            'time': int(d[0]),
            'open': float(d[1]),
            'high': float(d[2]),
            'low': float(d[3]),
            'close': float(d[4]),
            'volume': float(d[5]),
            'is_closed': True,
            'footprint': {},
        })
    return candles


async def count_rows_in_window(symbol: str, market_type: str, start_ms: int, end_ms: int) -> int:
    async with AsyncSessionLocal() as session:
        stmt = select(func.count()).where(
            Candle.symbol == symbol.lower(),
            Candle.market_type == market_type,
            Candle.interval == '1m',
            Candle.time >= start_ms,
            Candle.time < end_ms,
        )
        result = await session.execute(stmt)
        res = result.scalar()
    return int(res) if res is not None else 0


async def upsert_candles(candles: list[dict]):
    if not candles:
        return
    async with AsyncSessionLocal() as session:
        times = [c['time'] for c in candles]
        stmt = select(Candle).where(
            Candle.symbol == candles[0]['symbol'],
            Candle.interval == '1m',
            Candle.time.in_(times),
        )
        result = await session.execute(stmt)
        existing_map = {row.time: row for row in result.scalars().all()}

        for c in candles:
            existing = existing_map.get(c['time'])
            if existing:
                # Only fill in missing OHLCV; never overwrite real footprint data
                if not existing.footprint:
                    existing.footprint = {}
            else:
                session.add(Candle(
                    symbol=c['symbol'],
                    market_type=c['market_type'],
                    interval='1m',
                    time=c['time'],
                    open=c['open'],
                    high=c['high'],
                    low=c['low'],
                    close=c['close'],
                    volume=c['volume'],
                    is_closed=c['is_closed'],
                    footprint=c['footprint'],
                ))
        await session.commit()


async def backfill_pair(symbol: str, market_type: str):
    import time as _time
    now_ms = int(_time.time() * 1000)
    limit_ms = now_ms - FOUR_WEEKS_MS

    print(f"[Backfill] Starting for {symbol}/{market_type}")

    # --- Phase 1: last 24h immediately ---
    day_ms = 24 * 60 * 60 * 1000
    start_24h = now_ms - day_ms

    # Fetch 24h in 1000-candle (~16.7h) chunks
    chunk_end = now_ms
    counts = []
    while chunk_end > start_24h:
        try:
            klines = await fetch_klines(symbol, market_type, chunk_end, CHUNK)
            if not klines:
                break
            await upsert_candles(klines)
            counts.append(len(klines))
            current_total = sum(counts)
            oldest = klines[0]['time']
            print(f"[Backfill] Phase1 {symbol}: saved {len(klines)} candles up to {chunk_end}. Oldest={oldest}")
            chunk_end = oldest - 1
            if chunk_end <= start_24h:
                break
            await asyncio.sleep(0.5)  # fast during initial fill
        except Exception as e:
            print(f"[Backfill] Phase1 error {symbol}: {e}")
            await asyncio.sleep(5)

    print(f"[Backfill] Phase1 done for {symbol}: {sum(counts)} candles. Starting slow 4-week fill...")

    # --- Phase 2: slow walk to 4 weeks ---
    chunk_end = start_24h  # pick up where phase 1 ended
    while chunk_end > limit_ms:
        chunk_start = chunk_end - CHUNK * ONE_MINUTE_MS

        try:
            existing = await count_rows_in_window(symbol, market_type, chunk_start, chunk_end)
            if existing >= 900:  # good enough
                print(f"[Backfill] Skipping {symbol} window ending {chunk_end} ({existing} rows exist)")
            else:
                klines = await fetch_klines(symbol, market_type, chunk_end, CHUNK)
                if klines:
                    await upsert_candles(klines)
                    print(f"[Backfill] Phase2 {symbol}: saved {len(klines)} candles for window ending {chunk_end}")
                else:
                    print(f"[Backfill] No more data for {symbol} at {chunk_end}")
                    break

            await asyncio.sleep(DELAY_S)

        except Exception as e:
            print(f"[Backfill] Phase2 error {symbol} window {chunk_end}: {e}")
            await asyncio.sleep(10)

        chunk_end = chunk_start - 1

    print(f"[Backfill] Complete for {symbol}/{market_type}")


async def run_backfill():
    """Entry point — run all pairs concurrently."""
    tasks = [backfill_pair(sym, mkt) for sym, mkt in PAIRS]
    await asyncio.gather(*tasks)
