import asyncio
import httpx
import pandas as pd
import logging
from typing import Optional
from sqlalchemy import select
from database import AsyncSessionLocal
from models import Candle
import backtester.data.parquet_store as parquet_store

logger = logging.getLogger(__name__)

class BinanceFetcher:
    def __init__(self):
        self.spot_url = "https://api.binance.com/api/v3/klines"
        self.fapi_url = "https://fapi.binance.com/fapi/v1/klines"
        self.funding_url = "https://fapi.binance.com/fapi/v1/fundingRate"
        self.min_delay_ms = 400

    async def _request_with_retry(self, client: httpx.AsyncClient, url: str, params: dict, retries: int = 3):
        delay = self.min_delay_ms / 1000.0
        for attempt in range(retries):
            try:
                response = await client.get(url, params=params)
                if response.status_code == 429 or response.status_code == 418:
                    # Rate limit hit, backoff exponentially
                    backoff = int(response.headers.get("Retry-After", delay * (2 ** attempt)))
                    await asyncio.sleep(backoff)
                    continue
                response.raise_for_status()
                # Ensure we respect our own minimum delay
                await asyncio.sleep(delay)
                return response.json()
            except httpx.HTTPError as e:
                if attempt == retries - 1:
                    logger.error(f"Failed to fetch {url} after {retries} attempts: {e}")
                    raise
                await asyncio.sleep(delay * (2 ** attempt))
        return []

    async def fetch_ohlcv(self, symbol: str, timeframe: str, start_ms: int, end_ms: int, market_type: str = 'spot') -> pd.DataFrame:
        url = self.fapi_url if market_type == 'perp' else self.spot_url
        
        # Max limit is 1000
        limit = 1000
        interval_ms = 60000 if timeframe == '1m' else 60000 # Default to 1m for now
        
        all_data = []
        current_start = start_ms
        
        async with httpx.AsyncClient() as client:
            while current_start < end_ms:
                # Calculate what the current end should be to exactly fetch `limit` bars max
                current_end = min(current_start + (limit - 1) * interval_ms, end_ms)
                
                params = {
                    "symbol": symbol.upper(),
                    "interval": timeframe,
                    "startTime": current_start,
                    "endTime": current_end,
                    "limit": limit
                }
                
                data = await self._request_with_retry(client, url, params)
                if not data:
                    break
                    
                all_data.extend(data)
                
                # Update current_start to the last received timestamp + 1 interval
                last_ts = data[-1][0]
                current_start = last_ts + interval_ms
                
                if current_start > end_ms:
                    break
                    
        if not all_data:
            return pd.DataFrame(columns=['timestamp', 'open', 'high', 'low', 'close', 'volume', 'quote_volume', 'trades_count'])
            
        # Parse data
        df = pd.DataFrame(all_data, columns=[
            'timestamp', 'open', 'high', 'low', 'close', 'volume', 
            'close_time', 'quote_volume', 'trades_count', 
            'taker_buy_base', 'taker_buy_quote', 'ignore'
        ])
        
        df = df[['timestamp', 'open', 'high', 'low', 'close', 'volume', 'quote_volume', 'trades_count']]
        df = df.astype({
            'timestamp': 'int64',
            'open': 'float64',
            'high': 'float64',
            'low': 'float64',
            'close': 'float64',
            'volume': 'float64',
            'quote_volume': 'float64',
            'trades_count': 'int64'
        })
        
        # Ensure timezone-naiveUTC (Binance API returns UNIX ms)
        df.sort_values('timestamp', inplace=True)
        df.drop_duplicates(subset=['timestamp'], inplace=True)
        df.reset_index(drop=True, inplace=True)
        
        # Filter strictly within [start_ms, end_ms] bounds
        df = df[(df['timestamp'] >= start_ms) & (df['timestamp'] <= end_ms)]
        
        return df

    async def fetch_funding_history(self, symbol: str, start_ms: int, end_ms: int) -> pd.DataFrame:
        limit = 1000
        all_data = []
        current_start = start_ms
        
        async with httpx.AsyncClient() as client:
            while current_start < end_ms:
                params = {
                    "symbol": symbol.upper(),
                    "startTime": current_start,
                    "endTime": end_ms,
                    "limit": limit
                }
                
                data = await self._request_with_retry(client, self.funding_url, params)
                if not data:
                    break
                    
                all_data.extend(data)
                
                # Update current_start based on last received data
                last_ts = data[-1]['fundingTime']
                if last_ts == current_start:
                    # Prevent infinite loop if we keep getting the exact same timestamp
                    break
                # API doesn't guarantee strict interval (usually 8h), adding 1ms avoids duplicates
                current_start = last_ts + 1
                
                if current_start > end_ms:
                    break
                    
        if not all_data:
            return pd.DataFrame(columns=['timestamp', 'funding_rate', 'mark_price'])
            
        df = pd.DataFrame(all_data)
        df = df[['fundingTime', 'fundingRate', 'markPrice']]
        df.rename(columns={'fundingTime': 'timestamp', 'fundingRate': 'funding_rate', 'markPrice': 'mark_price'}, inplace=True)
        
        df = df.astype({
            'timestamp': 'int64',
            'funding_rate': 'float64',
            'mark_price': 'float64'
        })
        
        df.sort_values('timestamp', inplace=True)
        df.drop_duplicates(subset=['timestamp'], inplace=True)
        df.reset_index(drop=True, inplace=True)
        df = df[(df['timestamp'] >= start_ms) & (df['timestamp'] <= end_ms)]
        
        return df

async def sync_data_to_db(symbol: str, timeframe: str, start_ms: int, end_ms: int, market_type: str, job_state: dict = None):
    if job_state is None:
        job_state = {}
        
    expected_interval = 60000 if timeframe == '1m' else 300000
    
    job_state["progress"] = "Checking local database for existing data..."
    
    async with AsyncSessionLocal() as session:
        stmt = select(Candle.time).where(
            Candle.symbol == symbol.lower(),
            Candle.interval == timeframe,
            Candle.time >= start_ms,
            Candle.time <= end_ms
        ).order_by(Candle.time)
        res = await session.execute(stmt)
        existing_times = res.scalars().all()

    missing_ranges = []
    if not existing_times:
        missing_ranges.append((start_ms, end_ms))
    else:
        if existing_times[0] > start_ms:
            missing_ranges.append((start_ms, existing_times[0] - 1))
        for i in range(1, len(existing_times)):
            diff = existing_times[i] - existing_times[i-1]
            if diff > expected_interval * 1.5:
                missing_ranges.append((existing_times[i-1] + expected_interval, existing_times[i] - 1))
        if existing_times[-1] < end_ms - expected_interval:
            missing_ranges.append((existing_times[-1] + expected_interval, end_ms))

    fetcher = BinanceFetcher()
    total_items = len(missing_ranges)
    for idx, (run_start, run_end) in enumerate(missing_ranges):
        pct = int((idx / (total_items + 1)) * 100)
        job_state["progress"] = f"Downloading gap {idx+1}/{total_items} from Binance... ({pct}%)"
        df = await fetcher.fetch_ohlcv(symbol, timeframe, run_start, run_end, market_type)
        if not df.empty:
            job_state["progress"] = f"Inserting gap {idx+1}/{total_items} into database... ({pct + 5}%)"
            async with AsyncSessionLocal() as session:
                candles_to_insert = []
                for _, row in df.iterrows():
                    candles_to_insert.append(Candle(
                        symbol=symbol.lower(),
                        market_type=market_type,
                        interval=timeframe,
                        time=int(row['timestamp']),
                        open=float(row['open']),
                        high=float(row['high']),
                        low=float(row['low']),
                        close=float(row['close']),
                        volume=float(row['volume']),
                        quote_volume=float(row['quote_volume']),
                        count=int(row['trades_count']),
                        is_closed=True,
                        footprint={} 
                    ))
                chunk_size = 5000
                for i in range(0, len(candles_to_insert), chunk_size):
                    session.add_all(candles_to_insert[i:i+chunk_size])
                    await session.commit()
                        
    job_state["progress"] = "Extracting complete continuous range to Parquet cache..."
    async with AsyncSessionLocal() as session:
        stmt = select(Candle).where(
            Candle.symbol == symbol.lower(),
            Candle.interval == timeframe,
            Candle.time >= start_ms,
            Candle.time <= end_ms
        ).order_by(Candle.time)
        res = await session.execute(stmt)
        all_candles = res.scalars().all()
        
        if all_candles:
            import json
            data = [{
                'timestamp': c.time,
                'open': c.open,
                'high': c.high,
                'low': c.low,
                'close': c.close,
                'volume': c.volume,
                'quote_volume': c.quote_volume or 0.0,
                'trades_count': c.count or 0,
                'footprint_json': json.dumps(c.footprint) if c.footprint else "{}"
            } for c in all_candles]
            
            full_df = pd.DataFrame(data)
            await parquet_store.store_ohlcv(symbol, timeframe, full_df)
            
    if market_type == 'perp':
        job_state["progress"] = "Downloading continuous funding history..."
        funding_df = await fetcher.fetch_funding_history(symbol, start_ms, end_ms)
        # Funding is currently handled memory-only or could be saved to Parquet. 
        # For now, fetcher loads it locally inside run_backtest.
        
    job_state["progress"] = "Complete"
