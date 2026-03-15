import asyncio
import json
import websockets
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from database import engine, Base, AsyncSessionLocal
from models import Candle
import time

INTERVAL_MS = {
    '1m': 60000,
    '3m': 180000,
    '5m': 300000,
    '15m': 900000,
    '30m': 1800000,
    '1h': 3600000,
    '2h': 7200000,
    '4h': 14400000,
    '6h': 21600000,
    '8h': 28800000,
    '12h': 43200000,
    '1d': 86400000,
    '3d': 259200000,
    '1w': 604800000,
    '1M': 2592000000
}

class MarketEngine:
    """
    Streams Binance trade + 1m kline data for a set of symbols and saves 1m candles 
    with footprint to the database as the base resolution.
    """

    def __init__(self, symbols: list[str], market_type: str = 'spot', ws_manager=None):
        self.symbols = {s.lower() for s in symbols}
        self.market_type = market_type
        self.ws_manager = ws_manager
        self.base_url = "wss://stream.binance.com:9443" if market_type == 'spot' else "wss://fstream.binance.com"
        
        # Track open 1m candles for each symbol
        # Mapping: symbol -> candle_data
        self.active_candles: dict[str, dict] = {}
        
        # For managing websocket connection
        self.ws = None
        self.reconnect_event = asyncio.Event()

    async def update_symbols(self, new_symbols: list[str]):
        """Dyanmically add symbols and restart the connection."""
        added = False
        for s in new_symbols:
            low_s = s.lower()
            if low_s not in self.symbols:
                self.symbols.add(low_s)
                added = True
        
        if added:
            print(f"[Engine] Symbols updated, now monitoring: {self.symbols}")
            # Signal the main loop to reconnect with new streams
            if self.ws:
                self.reconnect_event.set()

    def update_footprint(self, symbol: str, price: float, quantity: float, is_buyer_maker: bool):
        sym = symbol.lower()
        if sym not in self.active_candles:
            return

        candle = self.active_candles[sym]
        price_str = str(price)
        fp = candle.setdefault('footprint', {})

        if price_str not in fp:
            fp[price_str] = {
                'price': price,
                'buyVolume': 0,
                'sellVolume': 0,
                'delta': 0
            }

        level = fp[price_str]
        quote_volume = quantity * price  # in USDT

        if is_buyer_maker:   # seller initiated (market sell)
            level['sellVolume'] += quote_volume
            level['delta'] -= quote_volume
        else:                # buyer initiated (market buy)
            level['buyVolume'] += quote_volume
            level['delta'] += quote_volume

    async def process_kline_1m(self, k: dict, symbol: str):
        sym = symbol.lower()
        candle_time = k['t']   # start of this 1m window (ms)
        is_closed = k['x']

        # If we are on a new 1m candle for this symbol, finalize the previous one
        if sym in self.active_candles and self.active_candles[sym]['time'] != candle_time:
            old_candle = self.active_candles[sym]
            old_candle['is_closed'] = True
            await self.save_candle(old_candle)
            await self.broadcast_candle(old_candle)
            self.active_candles.pop(sym, None)

        # Create / update the current 1m candle
        if sym not in self.active_candles:
            self.active_candles[sym] = {
                'symbol': sym,
                'market_type': self.market_type,
                'interval': '1m',
                'time': candle_time,
                'open': float(k['o']),
                'high': float(k['h']),
                'low': float(k['l']),
                'close': float(k['c']),
                'volume': float(k['v']),
                'footprint': {},
                'is_closed': False,
            }
        else:
            c = self.active_candles[sym]
            c['high'] = max(c['high'], float(k['h']))
            c['low'] = min(c['low'], float(k['l']))
            c['close'] = float(k['c'])
            c['volume'] = float(k['v'])

        current_candle = self.active_candles[sym]
        if is_closed:
            current_candle['is_closed'] = True
            await self.save_candle(current_candle)
            await self.broadcast_candle(current_candle)
            self.active_candles.pop(sym, None)
        else:
            # Broadcast live (open) candle every update
            await self.broadcast_candle(current_candle)

    async def broadcast_candle(self, candle: dict):
        if self.ws_manager and candle:
            await self.ws_manager.broadcast({
                'type': 'candle_update',
                'data': candle
            })

    # ------------------------------------------------------------------ #
    # Upsert candle to DB                                                 #
    # ------------------------------------------------------------------ #
    async def save_candle(self, c: dict):
        async with AsyncSessionLocal() as session:
            stmt = select(Candle).where(
                Candle.symbol == c['symbol'],
                Candle.interval == c['interval'],
                Candle.time == c['time']
            )
            result = await session.execute(stmt)
            existing = result.scalar_one_or_none()

            if existing:
                existing.high = c['high']
                existing.low = c['low']
                existing.close = c['close']
                existing.volume = c['volume']
                existing.is_closed = c['is_closed']
                existing.footprint = c['footprint']
            else:
                new_candle = Candle(
                    symbol=c['symbol'],
                    market_type=c['market_type'],
                    interval=c['interval'],
                    time=c['time'],
                    open=c['open'],
                    high=c['high'],
                    low=c['low'],
                    close=c['close'],
                    volume=c['volume'],
                    is_closed=c['is_closed'],
                    footprint=c['footprint'],
                )
                session.add(new_candle)

            await session.commit()
            status = "closed" if c['is_closed'] else "live"
            print(f"[DB] Saved {status} 1m candle for {c['symbol']} @ {c['time']}")

    # ------------------------------------------------------------------ #
    # Main streaming loop                                                 #
    # ------------------------------------------------------------------ #
    async def start_stream(self):
        while True:
            # 1. Build stream URL for current symbols
            stream_list = []
            for s in self.symbols:
                stream_list.append(f"{s}@trade")
                stream_list.append(f"{s}@kline_1m")
            
            streams = "/".join(stream_list)
            url = f"{self.base_url}/stream?streams={streams}"
            self.reconnect_event.clear()

            print(f"[Engine] Connecting to {url}")
            
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=30) as ws:
                    self.ws = ws
                    print(f"[Engine] Connected to {len(self.symbols)} assets")
                    
                    while not self.reconnect_event.is_set():
                        # Use a timeout so we can check for reconnection signals
                        try:
                            msg_str = await asyncio.wait_for(ws.recv(), timeout=1.0)
                            msg = json.loads(msg_str)
                            
                            if 'data' not in msg or 'stream' not in msg:
                                continue
                                
                            data = msg['data']
                            stream = msg['stream']
                            symbol = stream.split('@')[0]
                            event_type = data.get('e')

                            if event_type == 'trade':
                                price = float(data['p'])
                                qty = float(data['q'])
                                is_maker = data['m']
                                self.update_footprint(symbol, price, qty, is_maker)

                            elif event_type == 'kline':
                                await self.process_kline_1m(data['k'], symbol)
                                
                        except asyncio.TimeoutError:
                            continue
                        except websockets.exceptions.ConnectionClosed:
                            print("[Engine] Connection closed. Reconnecting...")
                            break

                    if self.reconnect_event.is_set():
                        print("[Engine] Reconnection requested for new symbols...")
                        await ws.close()
                        self.ws = None

            except Exception as e:
                print(f"[Engine] Stream error: {e}. Reconnecting in 5s...")
                await asyncio.sleep(5)


# For standalone testing
if __name__ == "__main__":
    import json
    engine_sim = MarketEngine(['btcusdt', 'ethusdt'])
    asyncio.run(engine_sim.start_stream())
