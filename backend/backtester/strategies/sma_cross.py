import pandas as pd
from .base import BaseStrategy, StrategyConfig, Signal

class SMACrossover(BaseStrategy):
    def __init__(self, config: StrategyConfig):
        super().__init__(config)
        self.fast_period = int(self.config.params.get('fast_period', 10))
        self.slow_period = int(self.config.params.get('slow_period', 30))

    def calculate_indicators(self, historical_data: pd.DataFrame) -> pd.DataFrame:
        df = historical_data.copy()
        
        # Calculate SMAs manually using rolling
        df['sma_fast'] = df['close'].rolling(window=self.fast_period).mean()
        df['sma_slow'] = df['close'].rolling(window=self.slow_period).mean()
        
        return df

    def generate_signal(self, indicators: pd.DataFrame, current_bar_index: int) -> Signal:
        # Need at least two bars to find a crossover
        if current_bar_index < 1:
            return Signal.HOLD
            
        current = indicators.iloc[current_bar_index]
        prev = indicators.iloc[current_bar_index - 1]
        
        # Avoid NaN values at the beginning of the series
        if pd.isna(current['sma_fast']) or pd.isna(current['sma_slow']) or pd.isna(prev['sma_fast']) or pd.isna(prev['sma_slow']):
            return Signal.HOLD
            
        # Fast crosses above slow -> BUY
        if prev['sma_fast'] <= prev['sma_slow'] and current['sma_fast'] > current['sma_slow']:
            return Signal.BUY
            
        # Fast crosses below slow -> SELL
        if prev['sma_fast'] >= prev['sma_slow'] and current['sma_fast'] < current['sma_slow']:
            return Signal.SELL
            
        return Signal.HOLD

    @classmethod
    def default_params(cls) -> dict:
        return {
            "fast_period": 10,
            "slow_period": 30
        }

    @classmethod
    def param_schema(cls) -> list[dict]:
        return [
            {"name": "fast_period", "type": "int", "min": 2, "max": 200, "default": 10},
            {"name": "slow_period", "type": "int", "min": 5, "max": 500, "default": 30}
        ]
