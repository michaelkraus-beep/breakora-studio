# Breakora User Manual: Complete Component Guide

Welcome to the Breakora Trading Station. The dashboard is powered by a dynamic window-management system (`flexlayout-react`) allowing you to freely drag, drop, minimize, and tab any of the components listed below to create your ultimate trading workspace.

---

## 1. Market Scanner
**Description:** A high-performance, real-time asset screener visualizing hundreds of cryptocurrency pairs simultaneously in a futuristic honeycomb-grid layout. 
**Usage:**
- **Filtering:** Click the "FILTERS" button to open the categorized hexagonal filter chips (Core, Technical, Order Flow, Volatility).
- **Sorting:** Use the top bar dropdown to sort the grid by Score, RVOL, Price Change, 24h Vol, Market Cap, RSI, or ATR%.
- **Preview:** Hover your mouse over any glowing hex tile for 400ms to preview the asset's 60-minute historical candlestick data behind the grid.
- **Selection:** Click a hex tile to instantly spawn a new Candlestick Chart tab for that asset in your main workspace.
**Settings:**
- Active Filters Counter and "RESET HIVE" global reset button.

---

## 2. Advanced Candlestick & Footprint Chart
**Description:** The core charting engine. It seamlessly blends traditional candlestick OHLC data with deep volumetric footprint data directly onto the price scale.
**Usage:**
- **Zoom & Pan:** Use the mouse wheel to scroll history. Pinch-zoom or hold `Ctrl`+wheel to zoom vertically/horizontally. Click and drag the price axis to pan vertically.
- **Drawing Tools (Left Toolbar):** Select tools like Measurement Ruler, Trend Lines, or custom Horizontal Volume Bars.
- **Quick Actions (Top Right):** Toggle footprint mode (Overlay/Side), Footprint info popups, ML Zone info, and lock zoom.
**Settings (Gear Icon on Chart):**
- **Analysis Period:** Define lookback bounds (e.g., last 233 candles, or Since US_OPEN).
- **Absorption & Imbalance Detection:** Toggle structural market detections. Configurable volume multipliers and sizes.
- **Persistent ML Zones:** Toggle automated Support/Resistance detection (`Auto-Retrain` features and ML Threshold bounds).
- **Visible Range Volume Profile:** Paints real-time horizontal volume data on the right edge. Includes a dedicated `Resolution (Bins)` slider (10-300) to adjust profile granularity.
- **Footprint Aggregation:** Controls for chart rendering density.

---

## 3. Tape & Order Flow Tools (FootTape / NuTape)
**Description:** High-speed visualizations of real-time executed trades.
**Usage:**
- Watches the pure, unfiltered WebSocket stream for the selected symbol.
- Groups rapid successive orders by the same market actor to reveal true execution size (Iceberg detection approximations).
- Visually distinguishes aggressive market buying (green) from aggressive market selling (red) using intensity grading.
- Usually docked on the right-hand panel of the workspace.

---

## 4. Order Book View (DOM)
**Description:** Depth of Market (DOM) rendering the limit order book context.
**Usage:**
- Shows resting liquidity above and below the current price. 
- Allows the user to spot "walls" of resting supply or demand. Used in conjunction with the Tape to see where aggressive market orders hit passive limit walls.

---

## 5. Phase Squeezer Oscillator
**Description:** An adaptive momentum and phase detection sub-chart attached to the bottom of the main candlestick chart.
**Usage:**
- Uses a proprietary algorithm to detect compression (price squeezing) and expansion (breakout) cycles.
- **Visuals:** Shows a histogram with color-coded momentum bars (e.g., Red for selling pressure, Cyan for buying pressure) alongside a signal line to indicate phase shifts.

---

## 6. Adaptive Phase Squeezer

The Squeezer is an advanced, machine-learning-augmented oscillator designed to detect explosive momentum phases (squeezes) before they resolve.

*   **Machine Learning Integration**: The engine trains on historical data to classify 'bull successes', 'bear successes', and 'failures' based on pre-breakout feature patterns.
*   **Reading the Oscillator**: Look for periods where the oscillator compresses near the zero line, indicating dropping volatility (the squeeze). A color change and expansion indicate the release phase.

<br>---

## 7. AI-Powered Quant Backtester

The Backtester is an institutional-grade simulation environment accessible via the main navigation bar. It is designed to rigorously test trading strategies against historical data while strictly enforcing realistic market constraints.

### Core Philosophy: Realistic Execution
The engine explicitly models factors that basic backtesters ignore, preventing "curve-fit" illusions:
*   **Dynamic Slippage**: Fills are never guaranteed at the mid-price. Slippage is modeled dynamically based on the size of your order relative to the historical volume of the candle and current volatility (ATR).
*   **Fees & Funding**: All trades incur exact maker/taker fees (e.g., 0.1% Spot, 0.02/0.04% Perps). If backtesting perpetuals, the system exactly simulates 8-hour funding rate payments, which can drastically alter long-term PnL.
*   **Liquidity Filters**: The engine will reject or heavily penalize trades where the intended position size exceeds a safe threshold (e.g., >5%) of the candle's historical volume.

### Workspace Panels
The dedicated Backtester workspace is divided into several panels:
*   **Configuration Panel**: Select your asset, timeframe, and configure the parameters of predefined strategies (e.g., SMA Crossover, RSI Mean Reversion). Set your initial capital, position sizing rules, and fee overlays.
*   **Results Dashboard**: Visualizes your Equity Curve and Drawdown over time, accompanied by a comprehensive grid of performance metrics (Sharpe Ratio, Max Drawdown, Profit Factor, Win Rate).
*   **Trade Log**: A detailed, chronological ledger of every simulated entry and exit, including the exact fees, slippage costs, and funding rate adjustments applied to that specific trade.
*   **Validation Panel**: Crucial for preventing overfitting. Enforces In-Sample / Out-of-Sample (IS/OOS) date splits and supports Walk-Forward analysis, ensuring your strategy works on unseen data, not just the data it was optimized for.

---

## 8. Volume Foot Oscillator
**Description:** A secondary sub-chart analyzing net market delta and volume clusters.
**Usage:**
- Plots the relative difference between Buying Volume and Selling Volume within the footprint of each candle.
- **Settings:** Can be configured to show the "Strongest Stack" or the absolute "Total Delta". Includes a normalizer mode to cap bar heights for easier relative visual comparison.

---

## 9. Hive-Tech Wiki System
**Description:** The centralized contextual help platform.
**Usage:**
- **Navigation:** Click the `(?)` contextual help buttons scattered throughout the app (e.g., on the title bar of the Market Scanner). This summons the Wiki Tab directly to your screen.
- **HexWikiNav:** Use the hexagonal side-navigation panel within the Wiki tab to click through various architectural articles and component guides. Matches the platform's glassmorphic, dark aesthetic.
- **Singleton Rule:** Only one Wiki can be open at a time; clicking help anywhere always brings the active Wiki into focus.

---

## 10. Dashboard Layout Engine
**Description:** The structural backbone of the UI.
**Usage:**
- **Tab Spawning:** Use the global `(+)` button in the top left header to manually add new charts, tapes, or scanners to the view.
- **Window Management:** Click and drag the tab headers (e.g., "BTCUSDT Chart") to tear them off and drop them onto edges or over other windows to split the screen vertically or horizontally.

***Note:** This document acts as the definitive user manual for Breakora. All components are deeply integrated and synchronized via global state managers, ensuring that a symbol switch on a chart immediately routes WebSocket data dynamically without manual reloading.*
