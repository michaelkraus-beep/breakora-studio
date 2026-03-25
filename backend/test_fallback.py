import asyncio
from backtester.data.parquet_store import load_ohlcv
from datetime import datetime

async def main():
    start = int(datetime(2024, 1, 1).timestamp() * 1000)
    end = int(datetime(2024, 1, 5).timestamp() * 1000)
    
    print("Testing load_ohlcv...")
    df = await load_ohlcv("btcusdt", "1m", start, end)
    print(f"Loaded {len(df)} rows.")
    if not df.empty:
        print(df.head())

if __name__ == "__main__":
    asyncio.run(main())
