import os
import asyncio
import pandas as pd
from datetime import datetime, timezone
from typing import Optional

STORE_DIR = "backend/data/parquet"

def _get_daily_path(symbol: str, timeframe: str, dt: datetime) -> str:
    date_str = dt.strftime('%Y%m%d')
    return os.path.join(STORE_DIR, symbol, timeframe, f"{symbol}_{timeframe}_{date_str}.parquet")

def _store_ohlcv_sync(symbol: str, timeframe: str, df: pd.DataFrame) -> None:
    if df.empty:
        return
        
    df = df.copy()
    # Ensure it's sorted and valid
    df.sort_values('timestamp', inplace=True)
    df.drop_duplicates(subset=['timestamp'], inplace=True)
    
    # Group by UTC date
    # timestamp is in ms
    df['date'] = pd.to_datetime(df['timestamp'], unit='ms').dt.date
    
    for date, group in df.groupby('date'):
        # Just use midnight UTC datetime for path generation
        dt = datetime.combine(date, datetime.min.time())
        path = _get_daily_path(symbol, timeframe, dt)
        
        os.makedirs(os.path.dirname(path), exist_ok=True)
        
        group = group.drop(columns=['date'])
        
        # If file exists, merge with existing data
        if os.path.exists(path):
            existing_df = pd.read_parquet(path, engine='fastparquet')
            combined = pd.concat([existing_df, group])
            combined.sort_values('timestamp', inplace=True)
            combined.drop_duplicates(subset=['timestamp'], keep='last', inplace=True)
            group = combined.reset_index(drop=True)
            
        group.to_parquet(path, engine='fastparquet', index=False)

async def store_ohlcv(symbol: str, timeframe: str, df: pd.DataFrame) -> None:
    await asyncio.to_thread(_store_ohlcv_sync, symbol, timeframe, df)

def _load_ohlcv_sync(symbol: str, timeframe: str, start_ms: int, end_ms: int) -> pd.DataFrame:
    start_dt = pd.to_datetime(start_ms, unit='ms', utc=True)
    end_dt = pd.to_datetime(end_ms, unit='ms', utc=True)
    
    # Generate list of dates between start and end
    # Use normalize() to get exactly the date part
    date_range = pd.date_range(start=start_dt.normalize(), end=end_dt.normalize(), freq='D')
    
    dfs = []
    for dt in date_range:
        path = _get_daily_path(symbol, timeframe, dt)
        if os.path.exists(path):
            dfs.append(pd.read_parquet(path, engine='fastparquet'))
            
    if not dfs:
        return pd.DataFrame()
        
    combined = pd.concat(dfs, ignore_index=True)
    # Filter bounds
    combined = combined[(combined['timestamp'] >= start_ms) & (combined['timestamp'] <= end_ms)]
    combined.sort_values('timestamp', inplace=True)
    combined.reset_index(drop=True, inplace=True)
    return combined

async def load_ohlcv(symbol: str, timeframe: str, start_ms: int, end_ms: int) -> pd.DataFrame:
    df = await asyncio.to_thread(_load_ohlcv_sync, symbol, timeframe, start_ms, end_ms)
    
    if df.empty:
        try:
            from database import AsyncSessionLocal
            from models import Candle
            from sqlalchemy import select
            
            async with AsyncSessionLocal() as session:
                stmt = select(Candle).where(
                    Candle.symbol == symbol.lower(),
                    Candle.interval == timeframe,
                    Candle.time >= start_ms,
                    Candle.time <= end_ms
                ).order_by(Candle.time)
                
                result = await session.execute(stmt)
                candles = result.scalars().all()
                
                if candles:
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
                    } for c in candles]
                    
                    df = pd.DataFrame(data)
                    await store_ohlcv(symbol, timeframe, df)
        except Exception as e:
            print(f"Fallback to DB failed: {e}")
            
    return df

def _get_available_range_sync(symbol: str, timeframe: str) -> Optional[tuple[int, int]]:
    dir_path = os.path.join(STORE_DIR, symbol, timeframe)
    if not os.path.exists(dir_path):
        return None
        
    files = [f for f in os.listdir(dir_path) if f.endswith('.parquet')]
    if not files:
        return None
        
    # Filename format: {symbol}_{timeframe}_{YYYYMMDD}.parquet
    # We can infer approximate bounds from filenames, but to be sure we should open first and last
    files.sort()
    
    first_file = os.path.join(dir_path, files[0])
    last_file = os.path.join(dir_path, files[-1])
    
    try:
        df_first = pd.read_parquet(first_file, engine='pyarrow')
        start_ms = df_first['timestamp'].min()
        
        df_last = pd.read_parquet(last_file, engine='pyarrow')
        end_ms = df_last['timestamp'].max()
        
        return (int(start_ms), int(end_ms))
    except Exception:
        return None

async def get_available_range(symbol: str, timeframe: str) -> Optional[tuple[int, int]]:
    return await asyncio.to_thread(_get_available_range_sync, symbol, timeframe)
