import asyncio
from sqlalchemy import select, func
from database import AsyncSessionLocal
from models import Candle

async def check_stats():
    print("--- Breakora Database Stats ---")
    async with AsyncSessionLocal() as session:
        # 1. Total candles
        stmt_total = select(func.count()).select_from(Candle)
        total = (await session.execute(stmt_total)).scalar()
        print(f"Total candles in DB: {total}")

        # 2. Count per symbol
        stmt_symbols = select(Candle.symbol, func.count()).group_by(Candle.symbol)
        symbols = (await session.execute(stmt_symbols)).all()
        print("\nCandles per Symbol:")
        for sym, count in symbols:
            print(f"  - {sym.upper()}: {count} rows")

        # 3. Time range per symbol
        print("\nTime Ranges:")
        for sym, _ in symbols:
            stmt_range = select(func.min(Candle.time), func.max(Candle.time)).where(Candle.symbol == sym)
            res = (await session.execute(stmt_range)).one()
            import datetime
            min_date = datetime.datetime.fromtimestamp(res[0]/1000).strftime('%Y-%m-%d %H:%M') if res[0] else "N/A"
            max_date = datetime.datetime.fromtimestamp(res[1]/1000).strftime('%Y-%m-%d %H:%M') if res[1] else "N/A"
            print(f"  - {sym.upper()}: {min_date} TO {max_date}")

        # 4. Footprint availability
        stmt_fp = select(func.count()).where(Candle.footprint != None)
        fp_count = (await session.execute(stmt_fp)).scalar()
        print(f"\nCandles with Footprint data: {fp_count} / {total}")

if __name__ == "__main__":
    asyncio.run(check_stats())
