import pandas as pd
import numpy as np

def apply_funding(position_size: float, funding_rate: float, mark_price: float) -> float:
    """
    Returns the funding payment (negative = paid, positive = received).
    Long pays short when rate > 0; short pays long when rate < 0.
    Payment = position_size * funding_rate * mark_price.
    
    position_size: >0 for Long, <0 for Short
    Returns USD value of the funding applied to the account.
    """
    # Ex: Long (pos>0) and Rate>0 -> payment is positive? No, long pays short, so long loses money.
    # The formula position_size * funding_rate * mark_price calculates what Long owes Short
    # Since we want return to represent cash flow to OUR equity:
    # If we are long (pos>0) and rate>0, we pay, so cash flow should be negative.
    # Cash flow = -1 * position_size * funding_rate * mark_price
    
    cash_flow = -1.0 * position_size * funding_rate * mark_price
    return cash_flow

class FundingSimulator:
    def __init__(self, funding_df: pd.DataFrame):
        """
        funding_df should have ['timestamp', 'funding_rate', 'mark_price']
        timestamp in milliseconds
        """
        if not funding_df.empty:
            self.funding_data = funding_df.sort_values('timestamp').reset_index(drop=True)
            self.timestamps = self.funding_data['timestamp'].values
            self.rates = self.funding_data['funding_rate'].values
            self.prices = self.funding_data['mark_price'].values
            self.has_data = True
        else:
            self.has_data = False
            
    def get_funding_at(self, timestamp_ms: int) -> tuple[float, float]:
        """
        Returns (funding_rate, mark_price) for the exact 8h boundary.
        Uses the nearest known rate or linear interpolation.
        """
        if not self.has_data:
            return 0.0, 0.0
            
        # Find exactly where timestamp falls
        idx = np.searchsorted(self.timestamps, timestamp_ms)
        
        # If exact match
        if idx < len(self.timestamps) and self.timestamps[idx] == timestamp_ms:
            return float(self.rates[idx]), float(self.prices[idx])
            
        # Boundary checks
        if idx == 0:
            return float(self.rates[0]), float(self.prices[0])
            
        if idx == len(self.timestamps):
            return float(self.rates[-1]), float(self.prices[-1])
            
        # Interpolate between idx-1 and idx
        t1, t2 = self.timestamps[idx-1], self.timestamps[idx]
        r1, r2 = self.rates[idx-1], self.rates[idx]
        p1, p2 = self.prices[idx-1], self.prices[idx]
        
        ratio = (timestamp_ms - t1) / (t2 - t1) if t2 > t1 else 0
        
        interp_rate = r1 + ratio * (r2 - r1)
        interp_price = p1 + ratio * (p2 - p1)
        
        return float(interp_rate), float(interp_price)
