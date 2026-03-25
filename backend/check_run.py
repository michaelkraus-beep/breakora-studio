import asyncio
import os
import sys

# Ensure backend can be imported
sys.path.append(os.getcwd())

from database import AsyncSessionLocal
from backtester.models import BacktestRun
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as session:
        # Check specific run
        run_id = '5a11528a-b277-4fa0-b935-bb61749ede60'
        stmt = select(BacktestRun).where(BacktestRun.run_id == run_id)
        res = await session.execute(stmt)
        run = res.scalar_one_or_none()
        
        if run:
            print(f"Run {run_id}:")
            print(f"  Status: {run.status}")
            print(f"  Warnings: {run.warnings}")
            print(f"  Metrics: {run.metrics}")
            print(f"  Trade Count: {run.trade_count}")
        else:
            print(f"Run {run_id} NOT found.")

if __name__ == "__main__":
    asyncio.run(main())
