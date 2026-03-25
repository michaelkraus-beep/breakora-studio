import pandas as pd
from backtester.data.fetcher import BinanceFetcher

def detect_gaps(df: pd.DataFrame, expected_interval_ms: int = 60000) -> list[dict]:
    if df.empty or len(df) < 2:
        return []
        
    # Calculate difference between consecutive timestamps
    df_sorted = df.sort_values('timestamp')
    diffs = df_sorted['timestamp'].diff()
    
    # Find where difference is greater than the expected interval
    # Use greater than 1.5x expected interval to account for slight precision errors (though crypto timestamps are exact)
    gap_indices = diffs[diffs > expected_interval_ms * 1.5].index
    
    gaps = []
    for idx in gap_indices:
        start_ts = df_sorted.loc[idx - 1, 'timestamp']
        end_ts = df_sorted.loc[idx, 'timestamp']
        
        # Calculate how many bars are missing
        missing_bars = int((end_ts - start_ts) // expected_interval_ms) - 1
        
        if missing_bars > 0:
            gaps.append({
                "start": int(start_ts),
                "end": int(end_ts),
                "missing_bars": missing_bars
            })
            
    return gaps

async def repair_gaps(symbol: str, timeframe: str, gaps: list[dict], fetcher: BinanceFetcher, market_type: str = 'spot') -> pd.DataFrame:
    # This function fetches missing data based on gaps, but note:
    # A gap in Binance data might mean NO trades occurred, or actual missing data.
    # Usually Binance returns empty candles if no trades, but we fetch anyway to be sure.
    
    dfs_to_append = []
    for gap in gaps:
        # Fetch from after the start to before the end
        fetch_start = gap["start"] + 1
        fetch_end = gap["end"] - 1
        
        gap_data = await fetcher.fetch_ohlcv(symbol, timeframe, fetch_start, fetch_end, market_type)
        if not gap_data.empty:
            dfs_to_append.append(gap_data)
            
    if not dfs_to_append:
        return pd.DataFrame()
        
    return pd.concat(dfs_to_append, ignore_index=True)
