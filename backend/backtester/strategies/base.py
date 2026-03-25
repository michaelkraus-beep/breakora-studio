from abc import ABC, abstractmethod
import pandas as pd
from dataclasses import dataclass
from enum import Enum

class Signal(Enum):
    HOLD = 0
    BUY = 1
    SELL = -1

@dataclass
class StrategyConfig:
    """User-configurable parameters for a strategy."""
    name: str
    params: dict  # Strategy-specific parameters

class BaseStrategy(ABC):
    def __init__(self, config: StrategyConfig):
        self.config = config
    
    @abstractmethod
    def calculate_indicators(self, historical_data: pd.DataFrame) -> pd.DataFrame:
        """Calculate indicators using ONLY data up to and including the last row.
        CRITICAL: This receives data[:current_bar+1]. Never access future data."""
        pass
    
    @abstractmethod
    def generate_signal(self, indicators: pd.DataFrame, current_bar_index: int) -> Signal:
        """Generate a trading signal based on indicators at current_bar_index.
        CRITICAL: Must only use indicators.iloc[:current_bar_index+1]."""
        pass
    
    @classmethod
    @abstractmethod
    def default_params(cls) -> dict:
        """Return default parameter values for UI display."""
        pass
    
    @classmethod
    @abstractmethod
    def param_schema(cls) -> list[dict]:
        """Return parameter schema for UI rendering.
        Format: [{"name": "fast_period", "type": "int", "min": 2, "max": 200, "default": 10}, ...]"""
        pass
