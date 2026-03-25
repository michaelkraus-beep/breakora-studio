from sqlalchemy import Column, Integer, String, Float, BigInteger, JSON, Boolean
from database import Base
import time

class BacktestRun(Base):
    __tablename__ = "backtest_runs"
    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(String, unique=True, index=True, nullable=False)
    symbol = Column(String, index=True, nullable=False)
    timeframe = Column(String, nullable=False)
    market_type = Column(String, nullable=False)
    strategy_name = Column(String, index=True, nullable=False)
    strategy_params = Column(JSON, nullable=False)
    config = Column(JSON, nullable=False)  # Full BacktestConfig as JSON
    metrics = Column(JSON, nullable=True)  # Computed metrics
    equity_curve = Column(JSON, nullable=True)  # Array of {timestamp, equity, drawdown}
    trade_count = Column(Integer, default=0)
    status = Column(String, default='pending')  # pending, running, completed, failed
    warnings = Column(JSON, nullable=True)
    created_at = Column(BigInteger, default=lambda: int(time.time() * 1000))
    completed_at = Column(BigInteger, nullable=True)

class BacktestTrade(Base):
    __tablename__ = "backtest_trades"
    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(String, index=True, nullable=False)
    entry_time = Column(BigInteger, nullable=False)
    exit_time = Column(BigInteger, nullable=True)
    side = Column(String, nullable=False)  # 'long' or 'short'
    entry_price = Column(Float, nullable=False)
    exit_price = Column(Float, nullable=True)
    size = Column(Float, nullable=False)
    pnl = Column(Float, nullable=True)
    pnl_pct = Column(Float, nullable=True)
    fee_paid = Column(Float, default=0.0)
    slippage_cost = Column(Float, default=0.0)
    funding_paid = Column(Float, default=0.0)
