import asyncio
import time
from sqlalchemy import select
from database import AsyncSessionLocal
from models import Candle

async def test_db_query():
    # Use same logic as scanner for start_ms calculation
    lookback_1m = 240  # Same default as scanner
    start_ms = int(time.time() * 1000) - (lookback_1m + 60) * 60_000

    print(f"Querying candles for time >= {start_ms} ({time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(start_ms/1000))})")

    async with AsyncSessionLocal() as session:
        stmt = select(Candle).where(
            Candle.interval == '1m',
            Candle.time >= start_ms,
            Candle.market_type == 'spot'
        )
        result = await session.execute(stmt)
        all_c = result.scalars().all()

        print(f"Found {len(all_c)} candles in DB")

        if all_c:
            print("Sample candles:")
            for i, candle in enumerate(all_c[:5]):
                print(f"  {i+1}. Symbol: {candle.symbol}, Time: {candle.time}, Close: {candle.close}")
        else:
            print("No candles found - this explains why scanner returns empty results!")

        # Check total candles in DB
        stmt_total = select(Candle)
        result_total = await session.execute(stmt_total)
        total_candles = result_total.scalars().all()
        print(f"\nTotal candles in DB: {len(total_candles)}")

        # Show latest candle time
        if total_candles:
            latest = max(total_candles, key=lambda x: x.time)
            print(f"Latest candle time: {latest.time} ({time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(latest.time/1000))})")

if __name__ == "__main__":
    asyncio.run(test_db_query())