import pandas as pd
from .base import BaseStrategy, StrategyConfig, Signal

class RSIReversion(BaseStrategy):
    def __init__(self, config: StrategyConfig):
        super().__init__(config)
        self.rsi_period = int(self.config.params.get('rsi_period', 14))
        self.oversold = float(self.config.params.get('oversold', 30.0))
        self.overbought = float(self.config.params.get('overbought', 70.0))

    def calculate_indicators(self, historical_data: pd.DataFrame) -> pd.DataFrame:
        df = historical_data.copy()
        
        # Calculate Wilder's RSI manually
        delta = df['close'].diff()
        gain = (delta.where(delta > 0, 0)).fillna(0)
        loss = (-delta.where(delta < 0, 0)).fillna(0)
        
        # Wilder's smoothing (Exponential Moving Average)
        avg_gain = gain.ewm(alpha=1/self.rsi_period, min_periods=self.rsi_period, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1/self.rsi_period, min_periods=self.rsi_period, adjust=False).mean()
        
        rs = avg_gain / avg_loss
        df['rsi'] = 100 - (100 / (1 + rs))
        # Handle divide by zero if avg_loss is 0
        df.loc[avg_loss == 0, 'rsi'] = 100
        
        return df

    def generate_signal(self, indicators: pd.DataFrame, current_bar_index: int) -> Signal:
        if current_bar_index < 1:
            return Signal.HOLD
            
        current = indicators.iloc[current_bar_index]
        prev = indicators.iloc[current_bar_index - 1]
        
        if pd.isna(current['rsi']) or pd.isna(prev['rsi']):
            return Signal.HOLD
            
        # Crossing above oversold from below -> mean reversion BUY
        if prev['rsi'] <= self.oversold and current['rsi'] > self.oversold:
            return Signal.BUY
            
        # Crossing below overbought from above -> mean reversion SELL
        if prev['rsi'] >= self.overbought and current['rsi'] < self.overbought:
            return Signal.SELL
            
        return Signal.HOLD

    @classmethod
    def default_params(cls) -> dict:
        return {
            "rsi_period": 14,
            "oversold": 30,
            "overbought": 70
        }

    @classmethod
    def param_schema(cls) -> list[dict]:
        return [
            {"name": "rsi_period", "type": "int", "min": 2, "max": 100, "default": 14},
            {"name": "oversold", "type": "float", "min": 1.0, "max": 50.0, "default": 30.0},
            {"name": "overbought", "type": "float", "min": 50.0, "max": 99.0, "default": 70.0}
        ]
