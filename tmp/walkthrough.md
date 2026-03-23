# Walkthrough: Thinktank – AI-Powered Quant Backtester

## Overview
Successfully executed the `thinktank` workflow to design and define the implementation plan for the **AI-Powered Quant Backtester (v1)**. 

The workflow transformed a high-level request into a precise, constraint-driven master prompt ready for execution in a fresh session.

## Key Decisions (Reverse Prompting)
1. **Navigation:** Opted for a dedicated, full-screen `BACKTESTER` view using its own `flexlayout-react` instance, rather than crowding the main dashboard.
2. **Engine:** Selected a custom `pandas`/`numpy` event-driven engine over frameworks like `vectorbt` or `backtrader` to ensure absolute control over quantitative constraints (dynamic slippage, funding rates).
3. **Data Storage:** Chose a hybrid approach: local Parquet files partitioned by symbol/timeframe for blazing-fast OHLCV sequential reads, and PostgreSQL for persisting backtest metadata and results.
4. **Exchange Scope:** Restricted v1 to Binance only (Spot + USDT-M Perps) to reduce complexity while maintaining strict execution realism modeling. Built with a pluggable architecture for Bybit in v2.
5. **Strategy Interface:** Decided on predefined strategies only for v1 (SMA Crossover, RSI Reversion, Bollinger Breakout) with user-configurable parameters, avoiding the complexity and security risks of arbitrary code execution.

## Artifacts Generated
- **[Prompt Contract](file:///f:/breakora-new/tmp/prompt_contract.md)**: The negotiated agreement defining the Goal, Constraints, Anti-Goals, Engine Spec, and Verification Plan.
- **[Master Execution Prompt](file:///f:/breakora-new/tmp/master_prompt_backtester.md)**: The final instructions for the execution agent, checked against `CLAUDE.md` and `.cursorrules`.

## Documentation Updates
In accordance with global rules, the planned architecture has been preemptively documented:
- `PROJECT_STATE.md`: Updated to include the planned `BACKTESTER` view, the Parquet data pipeline, and the custom execution engine.
- `USER_MANUAL.md`: Added a new section for the Backtester to serve as the source of truth for the Wiki subsystem.

## Next Steps
In a new session, supply the **[Master Execution Prompt](file:///f:/breakora-new/tmp/master_prompt_backtester.md)** to the agent to begin writing the code for the v1 implementation.
