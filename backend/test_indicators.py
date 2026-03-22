import pandas as pd
import pandas_ta as ta
import numpy as np

def test_indicators():
    # Mock data
    np.random.seed(42)
    closes = np.random.uniform(100, 110, 100)
    highs = closes + np.random.uniform(0, 2, 100)
    lows = closes - np.random.uniform(0, 2, 100)
    volumes = np.random.uniform(1000, 5000, 100)
    
    df = pd.DataFrame({
        'high': highs,
        'low': lows,
        'close': closes,
        'volume': volumes
    })
    
    # RVOL
    df['avg_vol_20'] = df['volume'].rolling(window=20).mean()
    df['rvol'] = df['volume'] / df['avg_vol_20']
    
    # RSI
    df.ta.rsi(length=14, append=True)
    
    # MACD
    df.ta.macd(fast=12, slow=26, signal=9, append=True)
    
    # Squeeze
    df.ta.squeeze(append=True)
    
    print("Columns:", df.columns.tolist())
    print("Last row samples:")
    print(df.iloc[-1])

if __name__ == "__main__":
    test_indicators()
