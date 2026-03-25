import asyncio
import os
import shutil
from database import AsyncSessionLocal
from models import Candle
from sqlalchemy import delete

async def main():
    # 1. Clear Parquet
    parquet_path = r"f:\breakora-new\backend\backend\data\parquet\btcusdt\1m"
    if os.path.exists(parquet_path):
        print(f"Deleting parquet files in {parquet_path}")
        shutil.rmtree(parquet_path)
        os.makedirs(parquet_path)
    
    # 2. Clear DB
    async with AsyncSessionLocal() as session:
        print("Deleting btcusdt candles from DB")
        await session.execute(delete(Candle).where(Candle.symbol == 'btcusdt'))
        await session.commit()
    
    print("Cleanup complete.")

if __name__ == "__main__":
    asyncio.run(main())
