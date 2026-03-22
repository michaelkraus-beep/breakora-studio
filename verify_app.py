import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath("backend"))
from backend.historical_backfill import backfill_pair
from backend.scanner_service import scan

async def main():
    print("Testing scanner empty DB fallback...")
    res = await scan('spot', 120)
    print("Scanner returned:", len(res), "results")
    if res:
        print("First result:", res[0])

    print("\nTesting backfill_pair (60m -> 24h)...")
    try:
        # We will test on a pair that might not have backfill yet or just re-run ethusdt
        # Re-running is idempotent and will skip existing chunks
        await backfill_pair('ethusdt', 'spot')
    except Exception as e:
        print("Backfill error:", e)

if __name__ == "__main__":
    asyncio.run(main())
