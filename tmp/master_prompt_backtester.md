# Master Execution Prompt: AI-Powered Quant Backtester (v1)

> **Thinktank-generated prompt. Steps 4+5 complete (verified by Sub-Agent Reviewer).**

---

```markdown
# TASK: Implement the AI-Powered Quant Backtester v1 for Breakora

You are implementing a new major feature for the Breakora trading terminal. Read `CLAUDE.md` fully before starting. Commit a Git rollback point before writing any code.

---

## PHASE 0: SYSTEM CONTEXT (Mandatory Pre-Read)

Before any code changes, read and internalize these files:
- `CLAUDE.md` / `.cursorrules` — All active project rules (Memory Sector rules are binding).
- `PROJECT_STATE.md` — Living architecture doc (you MUST update this after completion).
- `USER_MANUAL.md` — User-facing docs (you MUST update this and sync to Wiki after completion).
- `backend/main.py` — FastAPI app structure, lifespan pattern, router registration.
- `backend/models.py` — SQLAlchemy ORM pattern (Column-based, `Base` from `database.py`).
- `backend/database.py` — Async engine (`asyncpg`), `AsyncSessionLocal` session factory.
- `src/App.tsx` — View union type (`'DASHBOARD' | 'SCANNER'`), NavButton component, state management.
- `src/components/dashboard/DashboardLayout.tsx` — FlexLayout model, factory pattern, addTab spawning, ContextualHelp injection.
- `backend/requirements.txt` — Pinned Python dependencies.
- `package.json` — Frontend dependencies (React 19, Tailwind v4, flexlayout-react 0.8.18).

---

## PHASE 1: DATA PIPELINE (Backend)

### 1.1 Create `backend/backtester/` package

Create the directory `backend/backtester/` with an `__init__.py`.

### 1.2 Historical Data Fetcher — `backend/backtester/data/fetcher.py`

Build an async Binance historical data fetcher:
- Use `httpx.AsyncClient` (already in requirements) to hit Binance REST endpoints:
  - Spot: `GET https://api.binance.com/api/v3/klines`
  - USDT-M Perps: `GET https://fapi.binance.com/fapi/v1/klines`
  - Funding Rate History (perps only): `GET https://fapi.binance.com/fapi/v1/fundingRate`
- Fetch 1m OHLCV data in paginated chunks (max 1000 per request, use `startTime`/`endTime` pagination).
- Respect Binance rate limits: implement exponential backoff with a 400ms minimum delay between requests.
- Return data as a `pandas.DataFrame` with columns: `[timestamp, open, high, low, close, volume, quote_volume, trades_count]`.
- `timestamp` must be Unix milliseconds (int64), timezone-naive (UTC).
- For funding rates, return a separate DataFrame: `[timestamp, funding_rate, mark_price]`.
- Handle HTTP errors gracefully with retries (max 3).

### 1.3 Parquet Storage — `backend/backtester/data/parquet_store.py`

Build a local Parquet-based storage layer:
- Storage path: `backend/data/parquet/` directory (create if not exists).
- Partition scheme: `{symbol}/{timeframe}/{symbol}_{timeframe}_{YYYYMMDD}.parquet` (daily files for 1m data).
- Use `pandas.DataFrame.to_parquet()` and `pandas.read_parquet()` with `pyarrow` engine.
- Implement:
  - `async def store_ohlcv(symbol: str, timeframe: str, df: pd.DataFrame) -> None`
  - `async def load_ohlcv(symbol: str, timeframe: str, start_ms: int, end_ms: int) -> pd.DataFrame`
  - `async def get_available_range(symbol: str, timeframe: str) -> tuple[int, int] | None`
- Use `asyncio.to_thread()` for all file I/O to avoid blocking the event loop.
- Add `pyarrow` to `backend/requirements.txt`.

### 1.4 Gap Detection — `backend/backtester/data/gaps.py`

- `def detect_gaps(df: pd.DataFrame, expected_interval_ms: int = 60000) -> list[dict]`
  - Returns list of `{"start": int, "end": int, "missing_bars": int}` for each gap.
- `async def repair_gaps(symbol: str, timeframe: str, gaps: list[dict], fetcher) -> pd.DataFrame`
  - Fetches missing data and merges it into the existing dataset.

---

## PHASE 2: BACKTESTING ENGINE (Backend)

### 2.1 Strategy Interface — `backend/backtester/strategies/base.py`

```python
from abc import ABC, abstractmethod
import pandas as pd
from dataclasses import dataclass
from enum import Enum

class Signal(Enum):
    HOLD = 0
    BUY = 1
    SELL = -1

@dataclass
class StrategyConfig:
    """User-configurable parameters for a strategy."""
    name: str
    params: dict  # Strategy-specific parameters

class BaseStrategy(ABC):
    def __init__(self, config: StrategyConfig):
        self.config = config
    
    @abstractmethod
    def calculate_indicators(self, historical_data: pd.DataFrame) -> pd.DataFrame:
        """Calculate indicators using ONLY data up to and including the last row.
        CRITICAL: This receives data[:current_bar+1]. Never access future data."""
        pass
    
    @abstractmethod
    def generate_signal(self, indicators: pd.DataFrame, current_bar_index: int) -> Signal:
        """Generate a trading signal based on indicators at current_bar_index.
        CRITICAL: Must only use indicators.iloc[:current_bar_index+1]."""
        pass
    
    @classmethod
    @abstractmethod
    def default_params(cls) -> dict:
        """Return default parameter values for UI display."""
        pass
    
    @classmethod
    @abstractmethod
    def param_schema(cls) -> list[dict]:
        """Return parameter schema for UI rendering.
        Format: [{"name": "fast_period", "type": "int", "min": 2, "max": 200, "default": 10}, ...]"""
        pass
```

### 2.2 Predefined Strategies

Implement three strategies in `backend/backtester/strategies/`:

**`sma_cross.py`** — SMA Crossover:
- Params: `fast_period` (default 10), `slow_period` (default 30).
- BUY when fast SMA crosses above slow SMA. SELL when fast crosses below.
- Calculate SMAs using `df['close'].rolling(window=N).mean()` — NOT pandas_ta (avoid dependency issues).

**`rsi_revert.py`** — RSI Mean Reversion:
- Params: `rsi_period` (default 14), `oversold` (default 30), `overbought` (default 70).
- BUY when RSI crosses above `oversold` from below. SELL when RSI crosses below `overbought` from above.
- Implement RSI manually using Wilder's smoothing method (exponential moving average of gains/losses).

**`bband_break.py`** — Bollinger Bands Breakout:
- Params: `period` (default 20), `std_dev` (default 2.0).
- BUY when close breaks above upper band. SELL when close breaks below lower band.
- Bands = SMA ± (std_dev × rolling std).

### 2.3 Execution Engine — `backend/backtester/execution.py`

Model realistic order execution:

```python
@dataclass
class ExecutionConfig:
    maker_fee: float = 0.001       # 0.1% for spot
    taker_fee: float = 0.001       # 0.1% for spot
    maker_fee_perp: float = 0.0002 # 0.02% for USDT-M
    taker_fee_perp: float = 0.0004 # 0.04% for USDT-M
    slippage_base_bps: float = 1.0 # Base slippage in basis points
    liquidity_threshold: float = 0.05  # 5% of bar volume max
    market_type: str = 'spot'      # 'spot' or 'perp'

def calculate_dynamic_slippage(
    order_size_usd: float,
    bar_volume_usd: float,
    atr: float,
    current_price: float,
    base_slippage_bps: float = 1.0
) -> float:
    """
    Returns slippage as a fraction of price (e.g., 0.001 = 0.1%).
    Formula: base_bps * (1 + order_size/bar_volume) * (1 + atr/price)
    """
    pass

def check_liquidity(order_size_usd: float, bar_volume_usd: float, threshold: float = 0.05) -> tuple[bool, str]:
    """Returns (is_valid, reason). Rejects if order_size > threshold * bar_volume."""
    pass

def calculate_fill_price(
    order_side: str,  # 'buy' or 'sell'
    bar_open: float,
    slippage_fraction: float
) -> float:
    """
    Fill price for market orders. Orders placed on bar N execute at bar N+1 OPEN.
    Buy: open * (1 + slippage). Sell: open * (1 - slippage).
    NEVER use mid-price, close, or any intra-bar price.
    """
    pass
```

### 2.4 Funding Rate Simulator — `backend/backtester/funding.py`

For perpetuals backtesting:
- Track cumulative funding payments/receipts.
- Binance funding intervals: every 8 hours (00:00, 08:00, 16:00 UTC).
- `def apply_funding(position_size: float, funding_rate: float, mark_price: float) -> float:`
  - Returns the funding payment (negative = paid, positive = received).
  - Long pays short when rate > 0; short pays long when rate < 0.
  - Payment = position_size * funding_rate * mark_price.
- When a bar's timestamp crosses an 8h boundary, apply the nearest historical funding rate.
- If no historical funding rate data is available for the exact timestamp, use linear interpolation between the two nearest known rates.

### 2.5 Liquidity Filter — `backend/backtester/liquidity.py`

- `def evaluate_liquidity(order_size_usd: float, bar: dict, threshold_pct: float = 5.0) -> dict:`
  - Returns `{"allowed": bool, "penalty_slippage": float, "reason": str}`.
  - If `order_size_usd > threshold_pct/100 * bar_volume_usd`: `allowed = False`.
  - If `order_size_usd > (threshold_pct/2)/100 * bar_volume_usd`: add penalty slippage proportional to the excess.

### 2.6 Core Engine — `backend/backtester/engine.py`

The main backtest loop. This is the most critical file:

```python
@dataclass
class BacktestConfig:
    symbol: str
    timeframe: str           # '1m'
    market_type: str         # 'spot' or 'perp'
    strategy: StrategyConfig
    execution: ExecutionConfig
    initial_capital: float
    start_date: str          # ISO format 'YYYY-MM-DD'
    end_date: str            # ISO format 'YYYY-MM-DD'
    position_size_pct: float # % of equity per trade (e.g., 0.1 = 10%)

@dataclass
class BacktestResult:
    trades: list[dict]
    equity_curve: list[dict]  # [{"timestamp": int, "equity": float, "drawdown": float}]
    metrics: dict
    config: dict
    warnings: list[str]

async def run_backtest(config: BacktestConfig) -> BacktestResult:
    """
    EXECUTION MODEL (bar-by-bar, strictly chronological):
    
    For each bar at index `i`:
      1. INDICATORS: Calculate using data[:i+1] ONLY (strict temporal isolation).
         The strategy NEVER sees bar i+1 or beyond.
      2. FUNDING (perps only): If bar[i].timestamp crosses an 8h UTC boundary,
         settle funding on the open position using historical funding rate data.
      3. PENDING ORDERS: Process any pending orders against bar[i].open:
         a. Calculate dynamic slippage = f(order_size, bar[i].volume, ATR_at_i)
         b. Apply maker/taker fee to fill price
         c. Run liquidity filter: reject if size > threshold% of bar[i].volume
         d. If accepted: update position, cash, realized PnL
         e. If rejected: log warning, do NOT fill the order
      4. SIGNALS: Evaluate strategy.generate_signal(indicators, i)
         If signal != HOLD: create a NEW pending order (executes on bar i+1)
      5. MARK-TO-MARKET: Update equity = cash + position_value_at_bar[i].close
         Record equity, drawdown, exposure for this bar.
    
    After loop completes, calculate aggregate metrics.
    """
    pass
```

**Required Metrics Calculation:**
- Total Return: `(final_equity - initial_capital) / initial_capital`
- CAGR: Annualized compound growth rate
- Sharpe Ratio: `mean(daily_returns) / std(daily_returns) * sqrt(365)` (crypto = 365 days)
- Sortino Ratio: Like Sharpe but only downside deviation
- Max Drawdown: Maximum peak-to-trough decline
- Calmar Ratio: `CAGR / abs(max_drawdown)`
- Win Rate: `winning_trades / total_trades`
- Profit Factor: `sum(winning_pnl) / abs(sum(losing_pnl))`
- Average Win/Loss: Mean of winning trades / mean of losing trades
- Total Trades: Count

### 2.7 Validation (IS/OOS & Walk-Forward) — `backend/backtester/validation.py`

```python
@dataclass
class ValidationConfig:
    total_start: str   # ISO date
    total_end: str     # ISO date
    is_ratio: float    # In-sample ratio (e.g., 0.7 = 70% IS, 30% OOS)
    walk_forward_windows: int  # Number of rolling windows (0 = simple IS/OOS split)

def split_is_oos(total_start_ms: int, total_end_ms: int, is_ratio: float) -> tuple[tuple[int,int], tuple[int,int]]:
    """Returns ((is_start, is_end), (oos_start, oos_end)) in milliseconds."""
    pass

def generate_walk_forward_windows(total_start_ms: int, total_end_ms: int, n_windows: int, is_ratio: float) -> list[dict]:
    """Returns list of {"is_start", "is_end", "oos_start", "oos_end"} windows."""
    pass
```

### 2.8 Pydantic Schemas — `backend/backtester/schemas.py`

```python
from pydantic import BaseModel, Field
from typing import Optional

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
    status: str  # 'completed', 'failed', 'running'
    # ... result fields
```

### 2.9 SQLAlchemy Models — `backend/backtester/models.py`

Follow the exact pattern from `backend/models.py` (Column-based, import `Base` from `database`):

```python
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
```

### 2.10 FastAPI Router — `backend/backtester/router.py`

Create a router with prefix `/api/backtester`:

```
POST /api/backtester/run          — Start a new backtest (returns run_id immediately)
GET  /api/backtester/status/{id}  — Poll backtest status and partial results
GET  /api/backtester/result/{id}  — Get completed backtest results
GET  /api/backtester/history      — List past backtest runs
GET  /api/backtester/strategies   — List available strategies with param schemas
POST /api/backtester/data/fetch   — Trigger historical data download for a symbol
GET  /api/backtester/data/status  — Check available data ranges per symbol
```

Register this router in `backend/main.py`:
```python
from backtester.router import router as backtester_router
app.include_router(backtester_router)
```

Also import the new models in the lifespan to ensure table creation:
```python
from backtester.models import BacktestRun, BacktestTrade  # Ensure tables exist
```

Run backtests as background tasks using `asyncio.create_task()` so the API returns the `run_id` immediately. The frontend polls `/status/{id}`.

---

## PHASE 3: FRONTEND

### 3.1 Add `BACKTESTER` to the View Union — `src/App.tsx`

Modify the `View` type:
```typescript
type View = 'DASHBOARD' | 'SCANNER' | 'BACKTESTER';
```

Add a third NavButton in the header bar (between SCANNER and the System Status area), using the `FlaskConical` icon from `lucide-react`:
```tsx
<NavButton 
    active={currentView === 'BACKTESTER'} 
    onClick={() => setCurrentView('BACKTESTER')}
    icon={<FlaskConical size={14} />}
    label="BACKTESTER"
/>
```

Add the conditional render block:
```tsx
{currentView === 'BACKTESTER' && (
    <div className="flex-1 overflow-hidden">
        <BacktesterWorkspace />
    </div>
)}
```

### 3.2 Backtester Workspace — `src/components/backtester/BacktesterWorkspace.tsx`

This is a self-contained `flexlayout-react` workspace with its own `Model` and `factory`. It does NOT share the Dashboard's FlexLayout model.

Default layout:
- **Left panel (60% width):** Two vertical sections:
  - Top: `ResultsDashboard` (equity curve, drawdown chart, metrics cards)
  - Bottom: `TradeLog` (sortable trade table)
- **Right panel (40% width):** Two vertical sections:
  - Top: `ConfigPanel` (strategy config, pair, timeframe, fee/slippage settings, date range, run button)
  - Bottom: `ValidationPanel` (IS/OOS split config, walk-forward settings, comparison table)

Style the FlexLayout identically to the Dashboard (copy the `<style>` block from `DashboardLayout.tsx`).

### 3.3 Configuration Panel — `src/components/backtester/ConfigPanel.tsx`

A form with:
- **Symbol input** (text, lowercase, e.g. "btcusdt")
- **Market Type** toggle (spot / perp) — when "perp" is selected, show funding rate info
- **Timeframe** dropdown (1m only for v1, but show the selector for future expansion)
- **Strategy selector** dropdown — populated from `GET /api/backtester/strategies`
- **Strategy parameters** — dynamically rendered based on the strategy's `param_schema`
- **Date range** — start/end date pickers
- **Execution settings** (collapsible section):
  - Maker/Taker fee overrides
  - Slippage base (bps)
  - Liquidity threshold (%)
  - Position size (% of equity)
  - Initial capital (USD)
- **Validation settings** (collapsible section):
  - IS/OOS split ratio slider (50%-95%)
  - Walk-forward windows (0-10)
- **"RUN BACKTEST"** button — styled with cyan glow, `motion` animation on click
  - Debounce the submit action by 400ms (Memory Sector Rule #6).
  - On click: `POST /api/backtester/run`, then poll `/status/{run_id}` every 2 seconds.
- **"FETCH DATA"** button — to trigger data download before running

Design aesthetic: Dark glassmorphic panels matching the Dashboard style. Use `font-sci-fi` (Orbitron) for headers. Cyan accent color (`#22d3ee`). Subtle borders (`border-white/5`).

### 3.4 Results Dashboard — `src/components/backtester/ResultsDashboard.tsx`

Display backtest results:
- **Equity Curve** — Canvas-rendered line chart (use native Canvas API, no chart libraries needed for v1). Cyan line on dark background. Show drawdown as a filled red area below.
- **Metrics Grid** — 2x5 grid of metric cards:
  - Total Return, CAGR, Sharpe, Sortino, Max Drawdown
  - Calmar, Win Rate, Profit Factor, Avg Win/Loss, Total Trades
  - Each card: dark bg, cyan accent for positive values, red for negative.
- **Monthly Returns Heatmap** — Grid of months × years, color-coded green/red by return.

Show a loading skeleton while the backtest is running.

### 3.5 Trade Log — `src/components/backtester/TradeLog.tsx`

Sortable table with columns:
- Entry Time, Exit Time, Side, Entry Price, Exit Price, Size, PnL ($), PnL (%), Fee, Slippage, Funding
- Color-code rows: green for winning trades, red for losing.
- Virtual scrolling for large trade lists (use a simple windowed rendering approach).

### 3.6 Validation Panel — `src/components/backtester/ValidationPanel.tsx`

- Show IS vs. OOS metrics side-by-side in a comparison table.
- Color-code: if OOS Sharpe is significantly worse than IS Sharpe (>50% degradation), show a warning.
- For walk-forward: show a mini equity curve per window.

### 3.7 ContextualHelp Integration

Add a `ContextualHelp` button (`(?)`) to the backtester workspace header linking to a new wiki slug: `backtester-quant-engine`.

---

## PHASE 4: DOCUMENTATION & POST-COMPLETION (Mandatory)

### 4.1 Update `PROJECT_STATE.md`

Add to Section 1 (Backend):
- Document the new Parquet data structures and partition scheme.
- Document the backtester engine architecture.

Add to Section 2 (API):
- Document all new `/api/backtester/*` endpoints.

Add to Section 3 (Frontend):
- Document the new `BACKTESTER` view and FlexLayout workspace.

Add to Section 4 (Features):
- Add a "Quant Backtester" subsection documenting: predefined strategies, execution model, validation framework.

### 4.2 Update `USER_MANUAL.md`

Add a comprehensive section documenting the Backtester for end users.

### 4.3 Sync Wiki

Run `backend/sync_user_manual.py` to upsert the new backtester documentation into the Wiki database.

### 4.4 Update `CLAUDE.md` / `.cursorrules`

If any new architectural decisions or rules emerge during implementation, append them to Section 5 (Memory Sector) following the numbered format.

---

## ANTI-GOALS (Hard Failures — Violation = Rejected Implementation)

1. **NO MID-PRICE FILLS.** All fills use bar OPEN with slippage, never mid/close/VWAP.
2. **NO ZERO-COST EXECUTION.** Every trade applies maker/taker fees.
3. **NO STATIC SLIPPAGE.** Slippage is dynamic: `f(order_size, bar_volume, ATR)`.
4. **NO LOOK-AHEAD BIAS.** Indicators see `data[:current_bar+1]` only. Signals on bar N create orders that fill on bar N+1.
5. **NO FUNDING RATE OMISSION.** Perps positions crossing 8h UTC boundaries must settle funding.
6. **NO LIQUIDITY-BLIND EXECUTION.** Orders > 5% of bar volume are rejected.
7. **NO SURVIVORSHIP BIAS.** Data pipeline must not skip delisted pairs.
8. **NO SINGLE-WINDOW VALIDATION.** IS/OOS splits are enforced. No "test on train" without warning.
9. **NO DEPRECATED LIBRARIES.** Do not use backtrader, vectorbt, zipline, or any unmaintained package.
10. **NO SYNCHRONOUS BLOCKING.** All I/O (file, network, DB) must be async. No `time.sleep()`, no sync `requests`.
11. **NO `pandas_ta` FOR INDICATORS.** Implement all indicators (SMA, RSI, Bollinger) manually using pandas/numpy rolling operations to avoid the known pandas_ta installation issues in this project.

---

## DEPENDENCY ADDITIONS

**Backend (`backend/requirements.txt`)** — Add:
```
pyarrow==15.0.0
```

**Frontend (`package.json`)** — No new dependencies required. Use existing: React 19, Tailwind v4, flexlayout-react, lucide-react, motion, date-fns.

---

## VERIFICATION CHECKLIST

After implementation, verify the following:

1. [ ] `python -c "from backtester.engine import run_backtest"` succeeds (imports work).
2. [ ] Start FastAPI (`uvicorn main:app`), hit `GET /api/backtester/strategies` — returns 3 strategies with param schemas.
3. [ ] `POST /api/backtester/data/fetch` with `{"symbol": "btcusdt", "timeframe": "1m", "start_date": "2024-01-01", "end_date": "2024-01-02"}` — downloads and stores Parquet data.
4. [ ] `POST /api/backtester/run` with SMA Crossover on BTCUSDT — returns `run_id`, completes within 30s for 1 day of 1m data.
5. [ ] Result metrics include non-zero fees and slippage costs.
6. [ ] Frontend: Click "BACKTESTER" nav button — workspace renders with all 4 panels.
7. [ ] Run a backtest from the UI — equity curve, trade log, and metrics all display.
8. [ ] `(?)` help button links to `backtester-quant-engine` wiki article.
9. [ ] `PROJECT_STATE.md` is updated with new architecture.
10. [ ] `USER_MANUAL.md` is updated with backtester documentation.
```
