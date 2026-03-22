import asyncio
import pandas as pd
from database import AsyncSessionLocal
from models import Candle
from sqlalchemy import select, func

async def check_stats():
    async with AsyncSessionLocal() as session:
        # Get latest 100 candles for BTCUSDT
        stmt = select(Candle).where(Candle.symbol == 'btcusdt', Candle.interval == '1m').order_by(Candle.time.desc()).limit(100)
        res = await session.execute(stmt)
        candles = res.scalars().all()
        
        if not candles:
            print("No candles found for btcusdt")
            return

        df = pd.DataFrame([{
            'time': c.time, 'open': c.open, 'high': c.high, 'low': c.low, 'close': c.close, 'volume': c.volume
        } for c in candles[::-1]])
        
        last_c = df.iloc[-1]
        prev_5m = df.iloc[-6] if len(df) >= 6 else df.iloc[0]
        
        pc_5m = (last_c['close'] - prev_5m['close']) / prev_5m['close'] * 100
        rv = df['volume'].iloc[-5:].sum()
        av = df['volume'].iloc[-25:-5].mean() * 5 if len(df) >= 25 else 1.0
        rvol = rv / av if av > 0 else 1.0
        
        print(f"BTCUSDT Stats:")
        print(f"  Price: {last_c['close']}")
        print(f"  5m Change: {pc_5m:.2f}%")
        print(f"  RVOL: {rvol:.2f}")
        print(f"  Volume (5m): {rv:.2f}")

        # Check total symbol count
        stmt = select(func.count(func.distinct(Candle.symbol)))
        res = await session.execute(stmt)
        count = res.scalar()
        print(f"Total symbols in DB: {count}")

if __name__ == "__main__":
    asyncio.run(check_stats())
