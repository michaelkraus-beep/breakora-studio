import uuid
import os
import asyncio
from datetime import datetime

def debug_log(msg: str):
    try:
        with open(r"f:\breakora-new\backend\backtest_debug.log", "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now().isoformat()}] {msg}\n")
    except: pass
from typing import List
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from .schemas import BacktestRequest, BacktestResponse, StrategySchemaResponse
from .engine import run_backtest, BacktestConfig
from .strategies.base import StrategyConfig
from .strategies.sma_cross import SMACrossover
from .strategies.rsi_revert import RSIReversion
from .strategies.bband_break import BollingerBreakout
from .execution import ExecutionConfig
from .data.fetcher import BinanceFetcher
from .data.parquet_store import store_ohlcv, get_available_range
from database import AsyncSessionLocal
from sqlalchemy import select
from .models import BacktestRun, BacktestTrade

router = APIRouter(prefix="/api/backtester", tags=["Backtester"])

AVAILABLE_STRATEGIES = {
    "sma_cross": SMACrossover,
    "rsi_revert": RSIReversion,
    "bband_break": BollingerBreakout
}

@router.get("/strategies", response_model=List[StrategySchemaResponse])
async def get_strategies():
    return [
        {
            "name": name,
            "params": cls.param_schema(),
            "defaults": cls.default_params()
        }
        for name, cls in AVAILABLE_STRATEGIES.items()
    ]

class FetchRequest(BaseModel):
    symbol: str
    timeframe: str
    start_date: str
    end_date: str
    market_type: str = 'spot'

FETCH_JOBS = {}

@router.post("/data/fetch")
async def data_fetch(req: FetchRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    FETCH_JOBS[job_id] = {"progress": "Starting fetch job..."}
    
    async def fetch_job(req: FetchRequest, job_id: str):
        try:
            from .data.fetcher import sync_data_to_db
            start_ms = int(datetime.fromisoformat(req.start_date).timestamp() * 1000)
            end_ms = int(datetime.fromisoformat(req.end_date).timestamp() * 1000)
            
            await sync_data_to_db(req.symbol, req.timeframe, start_ms, end_ms, req.market_type, FETCH_JOBS[job_id])
            
        except Exception as e:
            FETCH_JOBS[job_id]["progress"] = f"Error: {str(e)}"
            import traceback
            traceback.print_exc()

    background_tasks.add_task(fetch_job, req, job_id)
    return {"status": "fetching", "job_id": job_id}

@router.get("/data/fetch-status/{job_id}")
async def data_fetch_status(job_id: str):
    if job_id not in FETCH_JOBS:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "progress": FETCH_JOBS[job_id]["progress"]}

@router.get("/data/status")
async def data_status(symbol: str, timeframe: str = '1m'):
    rng = await get_available_range(symbol, timeframe)
    if not rng:
        return {"symbol": symbol, "timeframe": timeframe, "available": False}
    return {
        "symbol": symbol, 
        "timeframe": timeframe, 
        "available": True,
        "start_ms": rng[0],
        "end_ms": rng[1]
    }

async def _run_backtest_task(run_id: str, req: BacktestRequest):
    # Set up config
    strategy_config = StrategyConfig(name=req.strategy_name, params=req.strategy_params)
    
    # Merge execution configs
    kwargs = {}
    kwargs['market_type'] = req.market_type
    
    # Correctly assign fees based on whether it is spot or perp
    fee_key_maker = 'maker_fee' if req.market_type == 'spot' else 'maker_fee_perp'
    fee_key_taker = 'taker_fee' if req.market_type == 'spot' else 'taker_fee_perp'
    
    if req.maker_fee is not None: kwargs[fee_key_maker] = req.maker_fee
    if req.taker_fee is not None: kwargs[fee_key_taker] = req.taker_fee
    
    if req.slippage_bps is not None: kwargs['slippage_base_bps'] = req.slippage_bps
    if req.liquidity_threshold is not None: kwargs['liquidity_threshold'] = req.liquidity_threshold
    
    execution_config = ExecutionConfig(**kwargs)
    
    config = BacktestConfig(
        symbol=req.symbol,
        timeframe=req.timeframe,
        market_type=req.market_type,
        strategy=strategy_config,
        execution=execution_config,
        initial_capital=req.initial_capital,
        start_date=req.start_date,
        end_date=req.end_date,
        position_size_pct=req.position_size_pct
    )
    
    try:
        result = await run_backtest(config)
        
        # Save results to DB
        async with AsyncSessionLocal() as session:
            stmt = select(BacktestRun).where(BacktestRun.run_id == run_id)
            res = await session.execute(stmt)
            run_obj = res.scalar_one_or_none()
            if run_obj:
                run_obj.status = 'completed'
                run_obj.metrics = result.metrics
                run_obj.equity_curve = result.equity_curve
                run_obj.warnings = result.warnings
                run_obj.trade_count = len(result.trades)
                run_obj.completed_at = int(datetime.utcnow().timestamp() * 1000)
                
                # Bulk insert trades
                trades_to_insert = []
                for t in result.trades:
                    trades_to_insert.append(BacktestTrade(
                        run_id=run_id,
                        entry_time=t['entry_time'],
                        exit_time=t['exit_time'],
                        side=t['side'],
                        entry_price=t['entry_price'],
                        exit_price=t['exit_price'],
                        size=t['size'],
                        pnl=t['pnl'],
                        pnl_pct=t['pnl_pct'],
                        fee_paid=t['fee_paid'],
                        slippage_cost=t['slippage_cost'],
                        funding_paid=t['funding_paid']
                    ))
                
                session.add_all(trades_to_insert)
                await session.commit()
                debug_log(f"Run {run_id} COMPLETED. Trades: {len(result.trades)}")
    except Exception as e:
        import traceback
        err_msg = traceback.format_exc()
        debug_log(f"Run {run_id} FAILED: {str(e)}\n{err_msg}")
        async with AsyncSessionLocal() as session:
            stmt = select(BacktestRun).where(BacktestRun.run_id == run_id)
            res = await session.execute(stmt)
            run_obj = res.scalar_one_or_none()
            if run_obj:
                run_obj.status = 'failed'
                run_obj.warnings = [str(e)]
                await session.commit()

@router.post("/run", response_model=BacktestResponse)
async def start_backtest(req: BacktestRequest, background_tasks: BackgroundTasks):
    print(f"\n[API] START_BACKTEST CALLED for {req.symbol} ({req.strategy_name})", flush=True)
    run_id = str(uuid.uuid4())
    
    async with AsyncSessionLocal() as session:
        new_run = BacktestRun(
            run_id=run_id,
            symbol=req.symbol,
            timeframe=req.timeframe,
            market_type=req.market_type,
            strategy_name=req.strategy_name,
            strategy_params=req.strategy_params,
            config=req.model_dump(),
            status='running'
        )
        session.add(new_run)
        await session.commit()
    
    background_tasks.add_task(_run_backtest_task, run_id, req)
    
    return BacktestResponse(run_id=run_id, status='running')

@router.get("/status/{run_id}", response_model=BacktestResponse)
async def get_status(run_id: str):
    async with AsyncSessionLocal() as session:
        stmt = select(BacktestRun).where(BacktestRun.run_id == run_id)
        res = await session.execute(stmt)
        run_obj = res.scalar_one_or_none()
        
        if not run_obj:
            raise HTTPException(status_code=404, detail="Run not found")
            
        return BacktestResponse(
            run_id=run_obj.run_id,
            status=run_obj.status,
            metrics=run_obj.metrics,
            warnings=run_obj.warnings
        )

@router.get("/result/{run_id}")
async def get_result(run_id: str):
    async with AsyncSessionLocal() as session:
        stmt = select(BacktestRun).where(BacktestRun.run_id == run_id)
        res = await session.execute(stmt)
        run_obj = res.scalar_one_or_none()
        
        if not run_obj:
            raise HTTPException(status_code=404, detail="Run not found")
            
        stmt_trades = select(BacktestTrade).where(BacktestTrade.run_id == run_id).order_by(BacktestTrade.entry_time.asc())
        res_trades = await session.execute(stmt_trades)
        trades = res_trades.scalars().all()
        
        return {
            "run": {
                "run_id": run_obj.run_id,
                "symbol": run_obj.symbol,
                "timeframe": run_obj.timeframe,
                "strategy_name": run_obj.strategy_name,
                "strategy_params": run_obj.strategy_params,
                "status": run_obj.status,
                "metrics": run_obj.metrics,
                "equity_curve": run_obj.equity_curve,
                "config": run_obj.config,
                "warnings": run_obj.warnings
            },
            "trades": [
                {
                    "entry_time": t.entry_time,
                    "exit_time": t.exit_time,
                    "side": t.side,
                    "entry_price": t.entry_price,
                    "exit_price": t.exit_price,
                    "size": t.size,
                    "pnl": t.pnl,
                    "pnl_pct": t.pnl_pct,
                    "fee_paid": t.fee_paid,
                    "slippage_cost": t.slippage_cost,
                    "funding_paid": t.funding_paid
                } for t in trades
            ]
        }

@router.get("/history")
async def get_history(limit: int = 50):
    async with AsyncSessionLocal() as session:
        stmt = select(BacktestRun).order_by(BacktestRun.created_at.desc()).limit(limit)
        res = await session.execute(stmt)
        runs = res.scalars().all()
        
        return [
            {
                "run_id": r.run_id,
                "symbol": r.symbol,
                "strategy_name": r.strategy_name,
                "status": r.status,
                "metrics": r.metrics,
                "created_at": r.created_at
            } for r in runs
        ]
