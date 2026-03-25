import asyncio
import httpx
import time

async def main():
    req = {
        "symbol": "btcusdt",
        "timeframe": "1m",
        "start_date": "2026-03-20",
        "end_date": "2026-03-23",
        "market_type": "spot"
    }
    async with httpx.AsyncClient() as client:
        res = await client.post("http://localhost:8000/api/backtester/data/fetch", json=req)
        data = res.json()
        print("Started:", data)
        job_id = data.get("job_id")
        
        while True:
            s_res = await client.get(f"http://localhost:8000/api/backtester/data/fetch-status/{job_id}")
            s_data = s_res.json()
            prog = s_data["progress"]
            print(prog)
            if "Complete" in prog or "Error" in prog:
                break
            await asyncio.sleep(1)

if __name__ == "__main__":
    asyncio.run(main())
