import pandas as pd
import os

path = r"f:\breakora-new\backend\backend\data\parquet\btcusdt\1m\btcusdt_1m_20260322.parquet"
if os.path.exists(path):
    df = pd.read_parquet(path, engine='fastparquet')
    print(f"File: {path}")
    print(f"Rows: {len(df)}")
    if not df.empty:
        print(f"Start: {pd.to_datetime(df['timestamp'].min(), unit='ms')}")
        print(f"End:   {pd.to_datetime(df['timestamp'].max(), unit='ms')}")
        print(df.head())
else:
    print(f"File NOT found: {path}")
