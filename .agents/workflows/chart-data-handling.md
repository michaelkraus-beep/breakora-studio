# Chart Data Handling Workflow

This workflow defines the standard process for ingesting, persisting, and synchronizing market data (candles and footprints) in the Breakora application.

## Core Principles
- **IDB is Source of Truth**: IndexedDB (via `PersistenceService`) is the primary source of truth for historical data with footprints.
- **API is Gap-Filler**: Exchange APIs (e.g., Binance) are used to fill gaps in OHLCV data but are considered "lossy" for footprints.
- **Sync, Don't Overwrite**: When merging API data with IDB data, always preserve existing footprint metadata.

## Steps

### 1. Data Ingestion (SharedStreamService)
- **Real-time**: Stream trades and 1m klines via WebSocket.
- **Aggregation**: Update footprints directly from trade ticks. Ensure the `currentCandle` reference is updated atomically.
- **Persistence**: Save the `candles` array to IDB periodically (e.g., every 10 seconds) or when a candle closes.

### 2. Historical Sync (Merging)
- When loading history:
    1. Fetch local data from IDB.
    2. Fetch missing gaps from the API.
    3. **Merge Step**:
        - Iterate through API candles.
        - If a candle exists in IDB with `footprint` data, keep the IDB version.
        - Update OHLCV values from API if they are more accurate, but do NOT clear the `footprint` object.

### 3. Component Rendering
- UI components (e.g., `CandlestickChart`) must NOT maintain independent long-term caches (like `useRef` for footprints).
- Components should subscribe to `SharedStreamService` and render the provided `data.candles`.
- Use `useMemo` for heavy rendering calculations (like footprint aggregation across rows) but clear them if the underlying data reference changes.

## Verification
- Verify that refreshing the page or switching tabs does not result in "blinking" or permanent loss of footprint data.
- Ensure IDB grows as new data arrives and remains consistent across sessions.
