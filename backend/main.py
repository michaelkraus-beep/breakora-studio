from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import asyncio
import json
import sys
import httpx
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from collections import defaultdict, deque

# Fix Windows console encoding (cp1252 can't handle Unicode symbol names)
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

app = FastAPI(title="Breakora Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from market_engine import MarketEngine, INTERVAL_MS

# ---------------------------------------------------------------------------
# Connection manager for WebSocket broadcasts
# ---------------------------------------------------------------------------
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"Client connected. Total clients: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"Client disconnected. Total clients: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_text(json.dumps(message))
            except Exception as e:
                print(f"Error broadcasting to client: {e}")
                dead_connections.append(connection)
        for dead in dead_connections:
            self.disconnect(dead)

manager = ConnectionManager()

# The engine always records 1m candles + footprint as the base resolution
# Symbols are loaded from the database in the lifespan context
engine_instance = MarketEngine([], market_type='spot', ws_manager=manager)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load previously monitored symbols from DB
    from models import MonitoredSymbol
    from backtester.models import BacktestRun, BacktestTrade  # Ensure tables exist
    
    async with AsyncSessionLocal() as session:
        stmt = select(MonitoredSymbol).where(MonitoredSymbol.active == True)
        res = await session.execute(stmt)
        monitored = res.scalars().all()
        # Ensure we always have at least some defaults if DB is empty
        initial_symbols = [m.symbol for m in monitored] or ['btcusdt', 'ethusdt', 'solusdt', 'bnbusdt']
        print(f"[Lifespan] Initializing engine with {len(initial_symbols)} symbols: {initial_symbols}")
        await engine_instance.update_symbols(initial_symbols)

    # Start the live stream in the background
    stream_task = asyncio.create_task(engine_instance.start_stream())

    # Run historical backfill in the background
    from historical_backfill import run_backfill
    initial_pairs = [(sym, 'spot') for sym in initial_symbols]
    backfill_task = asyncio.create_task(run_backfill(initial_pairs))

    yield

    stream_task.cancel()
    backfill_task.cancel()

app.router.lifespan_context = lifespan

from backtester.router import router as backtester_router
app.include_router(backtester_router)

# ---------------------------------------------------------------------------
# DB imports
# ---------------------------------------------------------------------------
from database import AsyncSessionLocal
from models import Candle
from sqlalchemy import select
# Helper: aggregate 1m DB rows into a higher timeframe
# ---------------------------------------------------------------------------
def aggregate_1m_to_interval(rows_1m: list, interval_ms: int) -> list[dict]:
    """
    Group rows by bucket (floor of time / interval_ms) and merge OHLCV + footprint.
    Returns list of candle dicts sorted by time asc.
    """
    buckets: dict[int, dict] = {}

    for row in rows_1m:
        bucket_time = (row.time // interval_ms) * interval_ms
        if bucket_time not in buckets:
            buckets[bucket_time] = {
                "time": bucket_time,
                "open": row.open,
                "high": row.high,
                "low": row.low,
                "close": row.close,
                "volume": row.volume,
                "isClosed": row.is_closed,
                "footprint": {}
            }
            # Merge initial footprint
            if row.footprint:
                for price_str, level in row.footprint.items():
                    buckets[bucket_time]["footprint"][price_str] = {
                        "price": level.get("price", float(price_str)),
                        "buyVolume": level.get("buyVolume", 0),
                        "sellVolume": level.get("sellVolume", 0),
                        "delta": level.get("delta", 0),
                    }
        else:
            b = buckets[bucket_time]
            b["high"] = max(b["high"], row.high)
            b["low"] = min(b["low"], row.low)
            b["close"] = row.close
            b["volume"] += row.volume
            b["isClosed"] = row.is_closed

            # Merge footprint
            if row.footprint:
                for price_str, level in row.footprint.items():
                    if price_str not in b["footprint"]:
                        b["footprint"][price_str] = {
                            "price": level.get("price", float(price_str)),
                            "buyVolume": level.get("buyVolume", 0),
                            "sellVolume": level.get("sellVolume", 0),
                            "delta": level.get("delta", 0),
                        }
                    else:
                        existing = b["footprint"][price_str]
                        existing["buyVolume"] += level.get("buyVolume", 0)
                        existing["sellVolume"] += level.get("sellVolume", 0)
                        existing["delta"] += level.get("delta", 0)

    return sorted(buckets.values(), key=lambda c: c["time"])


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    return {"status": "ok", "message": "Breakora Backend is running."}


@app.post("/api/engine/subscribe")
async def subscribe_symbols(symbols: list[str]):
    """Dynamically add new symbols to the live recording engine and persist them."""
    await engine_instance.update_symbols(symbols)
    
    # Persist to DB
    from models import MonitoredSymbol
    from sqlalchemy.dialects.postgresql import insert as pg_insert 
    # Check if we are using postgres or sqlite for the correct 'upsert'
    async with AsyncSessionLocal() as session:
        for sym in symbols:
            s_low = sym.lower()
            # Try to handle upsert generically or just check existence
            stmt = select(MonitoredSymbol).where(MonitoredSymbol.symbol == s_low)
            res = await session.execute(stmt)
            existing = res.scalar_one_or_none()
            if not existing:
                session.add(MonitoredSymbol(symbol=s_low, active=True))
        await session.commit()

    return {"status": "subscribed", "total_symbols": list(engine_instance.symbols)}

@app.get("/api/history")
async def get_history(symbol: str, interval: str, limit: int = 500):
    """
    Returns up to `limit` candles of the requested interval.
    For 1m: serves directly from DB.
    For all higher timeframes: fetches 1m rows from DB and aggregates on the fly.
    Footprint data (buyVolume/sellVolume/delta per price level) is included where
    the live stream has captured real trade flow. Historical candles fetched via
    the backfill service will have empty footprint dicts.
    """
    interval_ms = INTERVAL_MS.get(interval)
    if not interval_ms:
        return {"error": f"Unknown interval: {interval}"}

    sym = symbol.lower()

    async with AsyncSessionLocal() as session:
        if interval == '1m':
            # Direct query — no aggregation needed
            stmt = (
                select(Candle)
                .where(Candle.symbol == sym, Candle.interval == '1m')
                .order_by(Candle.time.desc())
                .limit(limit)
            )
            result = await session.execute(stmt)
            rows = sorted(result.scalars().all(), key=lambda c: c.time)

            return {
                "symbol": symbol,
                "interval": interval,
                "data": [
                    {
                        "time": c.time,
                        "open": c.open,
                        "high": c.high,
                        "low": c.low,
                        "close": c.close,
                        "volume": c.volume,
                        "isClosed": c.is_closed,
                        "footprint": c.footprint or {}
                    } for c in rows
                ]
            }
        else:
            # Aggregate from 1m rows.
            # We need `limit` target-interval candles; each target candle
            # consists of (interval_ms / 60000) 1m candles.
            mins_per_candle = interval_ms // 60_000
            # Fetch enough 1m rows: limit * mins_per_candle + 1 extra interval for safety
            fetch_1m_limit = (limit + 1) * mins_per_candle

            stmt = (
                select(Candle)
                .where(Candle.symbol == sym, Candle.interval == '1m')
                .order_by(Candle.time.desc())
                .limit(fetch_1m_limit)
            )
            result = await session.execute(stmt)
            rows_1m = sorted(result.scalars().all(), key=lambda c: c.time)

            aggregated = aggregate_1m_to_interval(rows_1m, interval_ms)

            # Trim to at most `limit` candles (keep the most recent ones) using deque to avoid linter slicing issues
            aggregated = list(deque(aggregated, maxlen=limit))

            return {
                "symbol": symbol,
                "interval": interval,
                "data": aggregated
            }


@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}


@app.websocket("/ws/market")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            print(f"Received from client: {data}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.get("/api/binance/exchangeInfo")
async def get_exchange_info(type: str = 'spot'):
    base_url = "https://fapi.binance.com" if type == 'perp' else "https://api.binance.com"
    endpoint = "/fapi/v1/exchangeInfo" if type == 'perp' else "/api/v3/exchangeInfo"
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(f"{base_url}{endpoint}")
        return JSONResponse(content=response.json())


@app.get("/api/binance/klines")
async def get_binance_klines(symbol: str, interval: str, limit: int = 1000, type: str = 'spot', endTime: int | None = None):
    base_url = "https://fapi.binance.com" if type == 'perp' else "https://api.binance.com"
    endpoint = "/fapi/v1/klines" if type == 'perp' else "/api/v3/klines"

    params = {
        "symbol": symbol.upper(),
        "interval": interval,
        "limit": limit
    }
    if endTime:
        params["endTime"] = endTime

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(f"{base_url}{endpoint}", params=params)
        return JSONResponse(content=response.json())


@app.get("/api/binance/ticker24")
async def get_ticker_24h(type: str = 'spot'):
    base_url = "https://fapi.binance.com" if type == 'perp' else "https://api.binance.com"
    endpoint = "/fapi/v1/ticker/24hr" if type == 'perp' else "/api/v3/ticker/24hr"
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(f"{base_url}{endpoint}")
        return JSONResponse(content=response.json())


# ---------------------------------------------------------------------------
# Scanner endpoints
# ---------------------------------------------------------------------------
import scanner_service

@app.get("/api/scanner/scan")
async def scanner_scan(market_type: str = 'spot', lookback: int = 120):
    """Run a full market scan across all ingested symbols."""
    try:
        print(f"[API] Starting scanner_scan: market_type={market_type}, lookback={lookback}")
        results = await scanner_service.scan(market_type=market_type, lookback_1m=lookback)
        
        # Proactive discovery: auto-subscribe symbols found by discovery (Limit to top 3 per scan)
        discovery_results = [r for r in results if r.get('discovery')]
        discovery_results.sort(key=lambda x: x.get('score', 0), reverse=True)
        discovered_symbols = [r['symbol'] for r in discovery_results[:3]]
        
        if discovered_symbols:
            print(f"[Scanner] Auto-subscribing top 3 discovered symbols: {discovered_symbols}")
            await engine_instance.update_symbols(discovered_symbols)
            # Also trigger backfill
            from historical_backfill import schedule_backfill
            for sym in discovered_symbols:
                schedule_backfill(sym, market_type)

        return {"results": results, "count": len(results)}
    except Exception as e:
        import traceback
        print(f"[API] Scanner error: {e}")
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/scanner/symbols")
async def scanner_symbols():
    """List all symbols the engine is currently monitoring."""
    return {"symbols": list(engine_instance.symbols)}


# ---------------------------------------------------------------------------
# ML endpoints (unchanged)
# ---------------------------------------------------------------------------
from models import SqueezeEvent
from pydantic import BaseModel
from typing import List


class SqueezePayload(BaseModel):
    symbol: str
    interval: str
    timestamp: int
    features: List[float]
    label: int


@app.get("/api/ml/data")
async def get_ml_data(symbol: str, interval: str):
    async with AsyncSessionLocal() as session:
        stmt = select(SqueezeEvent).where(
            SqueezeEvent.symbol == symbol.lower(),
            SqueezeEvent.interval == interval
        ).order_by(SqueezeEvent.timestamp.asc())
        result = await session.execute(stmt)
        events = result.scalars().all()
        return {
            "symbol": symbol,
            "interval": interval,
            "count": len(events),
            "features": [e.features for e in events],
            "labels": [e.label for e in events]
        }


@app.post("/api/ml/data")
async def post_ml_data(payload: SqueezePayload):
    async with AsyncSessionLocal() as session:
        new_event = SqueezeEvent(
            symbol=payload.symbol.lower(),
            interval=payload.interval,
            timestamp=payload.timestamp,
            features=payload.features,
            label=payload.label
        )
        session.add(new_event)
        await session.commit()
        return {"status": "saved", "id": new_event.id}


@app.get("/api/ml/status")
async def get_ml_status(symbol: str):
    async with AsyncSessionLocal() as session:
        stmt = select(SqueezeEvent).where(SqueezeEvent.symbol == symbol.lower())
        result = await session.execute(stmt)
        events = result.scalars().all()
        return {
            "status": "ready",
            "modelExists": len(events) > 0,
            "symbol": symbol,
            "trainingSamples": len(events)
        }


# ---------------------------------------------------------------------------
# Wiki endpoints
# ---------------------------------------------------------------------------
from models import WikiArticle

@app.get("/api/wiki/index")
async def get_wiki_index():
    async with AsyncSessionLocal() as session:
        stmt = select(WikiArticle.slug, WikiArticle.title, WikiArticle.category)
        result = await session.execute(stmt)
        articles = result.all()
        return [{"slug": row[0], "title": row[1], "category": row[2]} for row in articles]

@app.get("/api/wiki/articles/{slug}")
async def get_wiki_article(slug: str):
    async with AsyncSessionLocal() as session:
        stmt = select(WikiArticle).where(WikiArticle.slug == slug)
        result = await session.execute(stmt)
        article = result.scalar_one_or_none()
        if not article:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Article not found")
        return {
            "slug": article.slug,
            "title": article.title,
            "category": article.category,
            "content": article.content
        }


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
