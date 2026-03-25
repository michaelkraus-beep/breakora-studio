from pydantic import BaseModel, Field
from typing import Optional, Any

class BacktestRequest(BaseModel):
    symbol: str = Field(..., description="Trading pair, e.g. 'btcusdt'")
    timeframe: str = Field(default="1m", description="Candle interval")
    market_type: str = Field(default="spot", pattern="^(spot|perp)$")
    strategy_name: str = Field(..., description="Strategy identifier")
    strategy_params: dict = Field(default_factory=dict)
    initial_capital: float = Field(default=10000.0, gt=0)
    position_size_pct: float = Field(default=0.1, gt=0, le=1.0)
    start_date: str = Field(..., description="ISO date YYYY-MM-DD")
    end_date: str = Field(..., description="ISO date YYYY-MM-DD")
    maker_fee: Optional[float] = None
    taker_fee: Optional[float] = None
    slippage_bps: Optional[float] = None
    liquidity_threshold: Optional[float] = None
    # Validation
    is_oos_ratio: float = Field(default=0.7, ge=0.5, le=0.95)
    walk_forward_windows: int = Field(default=0, ge=0, le=10)

class BacktestResponse(BaseModel):
    run_id: str
    status: str
    metrics: Optional[dict] = None
    warnings: Optional[list[str]] = None
    
class StrategySchemaResponse(BaseModel):
    name: str
    params: list[dict]
    defaults: dict
