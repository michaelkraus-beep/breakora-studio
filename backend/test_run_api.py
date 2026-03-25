import httpx
import asyncio
import json

async def main():
    payload = {
        "symbol": "btcusdt",
        "market_type": "spot",
        "timeframe": "1m",
        "strategy_name": "sma_cross",
        "start_date": "2026-03-21",
        "end_date": "2026-03-23",
        "initial_capital": 10000,
        "position_size_pct": 0.1,
        "maker_fee": 0.001,
        "taker_fee": 0.001,
        "slippage_bps": 1.0,
        "liquidity_threshold": 5.0,
        "strategy_params": {
            "fast_period": 10,
            "slow_period": 30
        }
    }
    async with httpx.AsyncClient() as client:
        try:
            res = await client.post("http://localhost:8000/api/backtester/run", json=payload)
            print("Status Code:", res.status_code)
            print("Response text:", res.text)
        except Exception as e:
            print("Error:", e)

if __name__ == "__main__":
    asyncio.run(main())
