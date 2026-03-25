import asyncio
from backtester.data.fetcher import sync_data_to_db

async def main():
    try:
        # A tiny range that definitely exists in PostgreSQL to force the Parquet extraction
        start_ms = 1710979200000 # 2024-03-21
        end_ms   = 1711065600000 # 2024-03-22
        job_state = {}
        print("Running sync_data_to_db...")
        await sync_data_to_db('btcusdt', '1m', start_ms, end_ms, 'spot', job_state)
        print(f"Final state: {job_state}")
    except Exception as e:
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    asyncio.run(main())
