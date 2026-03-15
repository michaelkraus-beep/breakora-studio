import asyncio
import json
import websockets
from sqlalchemy.ext.asyncio import AsyncSession
from database import engine, Base, AsyncSessionLocal
from models import Candle
import time

# Create all tables on startup
async def init_models():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def binance_spot_stream(symbol: str, interval: str):
    # E.g. symbol='btcusdt', interval='1m'
    url = f"wss://stream.binance.com:9443/ws/{symbol}@kline_{interval}"
    
    while True:
        try:
            async with websockets.connect(url) as ws:
                print(f"Connected to Binance Spot {symbol} {interval}")
                while True:
                    data = await ws.recv()
                    msg = json.loads(data)
                    
                    if "k" in msg:
                        k = msg["k"]
                        # Save closed candles
                        if k["x"]: 
                            async with AsyncSessionLocal() as session:
                                new_candle = Candle(
                                    symbol=k['s'],
                                    market_type='spot',
                                    interval=k['i'],
                                    time=k['t'],
                                    open=float(k['o']),
                                    high=float(k['h']),
                                    low=float(k['l']),
                                    close=float(k['c']),
                                    volume=float(k['v']),
                                    is_closed=True,
                                    footprint={} # Placeholder for now
                                )
                                session.add(new_candle)
                                await session.commit()
                                print(f"Saved closed candle for {k['s']} at {k['t']}")
                                
        except Exception as e:
            print(f"WebSocket Error: {e}")
            await asyncio.sleep(5)

async def main():
    await init_models()
    # Testing with a single pair for now
    await binance_spot_stream('btcusdt', '1m')

if __name__ == "__main__":
    asyncio.run(main())
