import pandas as pd
from .base import BaseStrategy, StrategyConfig, Signal

class BollingerBreakout(BaseStrategy):
    def __init__(self, config: StrategyConfig):
        super().__init__(config)
        self.period = int(self.config.params.get('period', 20))
        self.std_dev = float(self.config.params.get('std_dev', 2.0))

    def calculate_indicators(self, historical_data: pd.DataFrame) -> pd.DataFrame:
        df = historical_data.copy()
        
        # Calculate Bollinger Bands manually
        df['sma'] = df['close'].rolling(window=self.period).mean()
        df['std'] = df['close'].rolling(window=self.period).std(ddof=0)
        
        df['upper_band'] = df['sma'] + (self.std_dev * df['std'])
        df['lower_band'] = df['sma'] - (self.std_dev * df['std'])
        
        return df

    def generate_signal(self, indicators: pd.DataFrame, current_bar_index: int) -> Signal:
        if current_bar_index < 1:
            return Signal.HOLD
            
        current = indicators.iloc[current_bar_index]
        prev = indicators.iloc[current_bar_index - 1]
        
        if pd.isna(current['upper_band']) or pd.isna(current['lower_band']):
            return Signal.HOLD
            
        # Close breaks above upper band -> BUY
        if prev['close'] <= prev['upper_band'] and current['close'] > current['upper_band']:
            return Signal.BUY
            
        # Close breaks below lower band -> SELL
        if prev['close'] >= prev['lower_band'] and current['close'] < current['lower_band']:
            return Signal.SELL
            
        return Signal.HOLD

    @classmethod
    def default_params(cls) -> dict:
        return {
            "period": 20,
            "std_dev": 2.0
        }

    @classmethod
    def param_schema(cls) -> list[dict]:
        return [
            {"name": "period", "type": "int", "min": 5, "max": 200, "default": 20},
            {"name": "std_dev", "type": "float", "min": 0.1, "max": 5.0, "default": 2.0}
        ]
