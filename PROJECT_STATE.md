# Breakora - Living Architecture & Project State

This document is the living state of the Breakora project. It is autonomously updated by the AI agent to reflect the current, exact implementation of the codebase.

## 1. Backend & Data Integration
- **Persistance Engine:** PostgreSQL (via `asyncpg`) running asynchronously with SQLAlchemy 2.0.
- **Data Models:** `WikiArticle` model for dynamic help content storage.
- **Sync Scripts:** Dedicated standalone Python utilities (e.g., `backend/add_scanner_article.py`, `backend/sync_wiki.py`, and specifically `backend/sync_user_manual.py`) to systematically parse markdown resources like the `USER_MANUAL.md` and upsert them as distinct articles in the database.
- **Financial Data Pipeline:** High-speed real-time aggregation from Binance WebSockets, merged systematically with deep historical REST backfills (via reverse proxy).
- **Backtesting Data Pipeline:** Hybrid storage model using local partitioned Parquet files for high-speed sequential OHLCV historical reads, alongside PostgreSQL for persisting backtest metadata, execution logs, and computed performance metrics.

## 2. API & Routing
- **Active Endpoints:**
  - `GET /api/wiki/index`: Retrieves table-of-contents metadata for the Wiki.
  - `GET /api/wiki/article/{slug}`: Pulls the specific markdown content for a requested article.
  - `GET /api/binance/klines`: Custom proxy endpoint to fetch deep historical data without CORS restrictions.
- **WebSocket Streaming:** Native async WebSockets in FastAPI serving raw, unfiltered tick data directly into the React client.

## 3. Frontend & Dynamic Layout
- **Current Stack:** React 19 (Vite), highly tailored Tailwind CSS v4, and `lucide-react` aesthetics.
- **FlexLayout Engine:** Full integration of `flexlayout-react` for complete draggability, custom window spawning, and pane management.
- **Singleton Tab Management:** The layout strictly enforces logic to keep the `WikiTab` as a globally unique, single instance tracking cross-component `open-wiki` dispatch events. Clicking contextual help dynamically focuses the tab or spawns it if closed.
- **Dynamic Headers:** `DashboardLayout.tsx` programmatically maps active tabs (Charts, Tape, Orderbook) to designated Wiki slugs and injects `ContextualHelp` `(?)` buttons seamlessly into their native FlexLayout tab headers.
- **Views:** Top-level application routing uses a strictly typed `View` union (`'DASHBOARD' | 'SCANNER' | 'BACKTESTER'`), rendering entirely isolated, dedicated full-screen workspaces for each domain.

## 4. Features & Modules
- **Market Scanner:**
  - Active real-time grid rendering market dynamics across hundreds of pairs simultaneously.
  - **Hex UI:** Strict adherence to Hexagon-themed filters and chips layout.
  - **API Protection:** Engineered a robust 400ms debounce on the symbol hover state. This isolates rapid-fire UI swiping from dispatching redundant historical data proxy requests, directly preventing HTTP 429 Rate Limits.
- **Candlestick & Footprint Charting:**
  - Dedicated engine (`CandlestickChart.tsx`) driven by the specialized `useBinanceStream` hook.
  - Generates volume footprints and utilizes ML integration (`@tensorflow/tfjs`) for Imbalance/Absorption detection.
  - **Volume Profile:** A dynamic 'Visible Range Volume Profile' overlay sporting a customizable `Resolution (Bins)` setting mapped to an asynchronous UI slider (scaling 10-300 increments).
- **Hive-Tech Wiki System:**
  - Embedded, high-tech `react-markdown` viewer populated dynamically from the backend database.
  - Implements an aesthetic `HexWikiNav.tsx` sidebar navigation.
  - Distributed `ContextualHelp.tsx` trigger buttons exist on multiple components, ensuring deep-linked jumps straight to domain-specific documentation (like the Market Scanner).
- **AI-Powered Quant Backtester:**
  - Dedicated full-screen `BACKTESTER` workspace utilizing `flexlayout-react` for configuration, Trade Logs, Results Dashboards, and IS/OOS Validation panels.
  - Driven by a custom event-driven, bar-by-bar matching engine (Python, pandas/numpy) ensuring strict temporal isolation and realistic execution.
  - Incorporates dynamic slippage modeling (ATR/Volume-based), exact maker/taker fee application, strict liquidity filters, and exact funding rate simulation for perpetual futures. Minimum 400ms debounce protection on execution triggers.

## 5. Deprecated / Removed
- **Redundant State UI (Vertical Resolution):** The explicit "Vertical Resolution (Bars)" native form input was removed from the `horizontal_volume_bars` explicit drawing tools menu. It was decoupled in favor of consolidating resolution control directly to the globally synced `Resolution (Bins)` slider for the Visible Range Volume Profile. This prevents severe state desyncs and duplicated visual inputs.
