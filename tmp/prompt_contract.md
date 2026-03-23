# Thinktank — Prompt Contract: AI-Powered Quant Backtester (v1)

## Goal

Build an institutional-grade, AI-Powered Quant Backtester integrated into the Breakora trading terminal:

1. **New full-screen `BACKTESTER` view** in `App.tsx` (alongside `DASHBOARD` and `SCANNER`), with its own `flexlayout-react` workspace.
2. **Custom event-driven backtesting engine** (Python, pandas/numpy) in FastAPI backend with strict quantitative execution modeling.
3. **Hybrid Parquet + PostgreSQL data pipeline** — Parquet for OHLCV hot-path reads, PostgreSQL for backtest metadata/results.
4. **Binance-only** (Spot + USDT-M Perps), exchange-pluggable architecture for v2.
5. **Predefined strategies** (SMA Crossover, RSI Mean Reversion, Bollinger Bands Breakout) with configurable parameters.

---

## Constraints

| # | Constraint | Rationale |
|---|-----------|-----------|
| C1 | Binance-only v1. Exchange-pluggable architecture. | Bybit in v2. |
| C2 | Custom engine — no vectorbt, backtrader. Pure pandas/numpy. | Full execution control. |
| C3 | Parquet for OHLCV hot-path. PostgreSQL for metadata/results. | Optimized I/O + queryable results. |
| C4 | Predefined strategies only — no user code execution. | Avoids sandboxing. |
| C5 | All backend code fully async (FastAPI, asyncpg, httpx). | Existing mandate. |
| C6 | Frontend: React 19, Tailwind v4, flexlayout-react, lucide-react, motion. | Existing stack. |
| C7 | ContextualHelp `(?)` button on all new components. | Rule #10. |
| C8 | Implementation plan approval before code. | Rule #1. |
| C9 | Git commit rollback point before execution. | Rule #5. |
| C10 | 400ms debounce on rapid UI→API interactions. | Rule #6. |

---

## Format (Expected File Structure)

### Backend
```
backend/backtester/
├── __init__.py
├── engine.py           # Core bar-by-bar backtest loop
├── execution.py        # Order matching, slippage, fee simulation
├── funding.py          # Perpetual funding rate simulation
├── liquidity.py        # Volume-based liquidity filters
├── strategies/
│   ├── __init__.py
│   ├── base.py         # Abstract strategy interface
│   ├── sma_cross.py
│   ├── rsi_revert.py
│   └── bband_break.py
├── data/
│   ├── __init__.py
│   ├── fetcher.py      # Async Binance historical data fetcher
│   ├── parquet_store.py # Parquet read/write (partitioned by symbol/tf)
│   └── gaps.py         # Gap detection & repair
├── models.py           # SQLAlchemy: BacktestRun, Trade, etc.
├── schemas.py          # Pydantic request/response
├── router.py           # FastAPI router (/api/backtester/*)
└── validation.py       # Walk-forward & IS/OOS split logic
```

### Frontend
```
src/components/backtester/
├── BacktesterWorkspace.tsx   # FlexLayout container
├── ConfigPanel.tsx           # Strategy params, pair, timeframe, fees
├── ResultsDashboard.tsx      # Equity curve, drawdown, metrics
├── TradeLog.tsx              # Individual trade table
└── ValidationPanel.tsx       # IS/OOS splits, walk-forward results
```

---

## Failure Modes (Anti-Goals)

> [!CAUTION]
> Hard failures — the engine MUST NOT do any of these.

| # | Anti-Goal |
|---|----------|
| F1 | **No mid-price fills** — Buys fill at ask-adjusted; sells at bid-adjusted. |
| F2 | **No zero-cost execution** — Apply maker/taker fees on every trade. |
| F3 | **No static slippage** — Dynamic slippage = f(position_size, bar_volume, ATR). |
| F4 | **No look-ahead bias** — Indicators on `data[:current_bar]` only. Orders on bar N execute at bar N+1 open. |
| F5 | **No funding rate omission** — 8h funding payments simulated for perps. |
| F6 | **No liquidity-blind execution** — Flag/reject trades where size > 5% of bar volume. |
| F7 | **No survivorship bias** — Don't silently skip delisted pairs. |
| F8 | **No single-window validation** — Enforce IS/OOS splits; warn if testing on training data. |
| F9 | **No deprecated libraries** — No backtrader, vectorbt, zipline. |
| F10 | **No synchronous blocking** — All I/O must be async. |

---

## Quantitative Engine Specification

### Execution Model (Bar-by-Bar)
```
For each bar (chronological):
  1. Calculate indicators on data[:current_bar] ONLY (temporal isolation)
  2. Settle funding rate if 8h boundary crossed (perps)
  3. Process pending orders against bar OPEN:
     a. Dynamic slippage = f(order_size, bar_volume, ATR)
     b. Apply maker/taker fee
     c. Liquidity filter: reject if size > threshold% of volume
     d. Update position, cash, PnL
  4. Evaluate strategy → generate NEW pending orders
  5. Record equity, drawdown, exposure
```

### Required Performance Metrics
- Total Return, CAGR, Sharpe, Sortino, Max Drawdown, Calmar
- Win Rate, Profit Factor, Avg Win/Loss, Total Trades
- Equity curve, Drawdown curve, Monthly returns heatmap
- IS vs. OOS comparison table

---

## Verification Plan

### Automated Tests
1. **Temporal isolation**: Inject foresight strategy → assert rejection or differing results vs. compliant strategy.
2. **Fee/slippage**: Same strategy, fees=0 vs. realistic → assert materially different PnL.
3. **Funding rate**: Long perps across funding interval → assert PnL includes funding.
4. **Liquidity filter**: Massive order on low-volume bar → assert rejection/penalty.
5. **Data gaps**: Artificial gaps in Parquet → assert engine detects and reports.

### Manual Verification
1. Click Backtester nav button → confirm FlexLayout workspace renders correctly.
2. Run SMA Crossover on BTCUSDT 1m → verify equity curve, trade log, metrics.
3. Confirm `(?)` help button links to correct Wiki article.
