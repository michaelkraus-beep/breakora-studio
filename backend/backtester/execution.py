from dataclasses import dataclass

@dataclass
class ExecutionConfig:
    maker_fee: float = 0.001       # 0.1% for spot
    taker_fee: float = 0.001       # 0.1% for spot
    maker_fee_perp: float = 0.0002 # 0.02% for USDT-M
    taker_fee_perp: float = 0.0004 # 0.04% for USDT-M
    slippage_base_bps: float = 1.0 # Base slippage in basis points
    liquidity_threshold: float = 0.05  # 5% of bar volume max
    market_type: str = 'spot'      # 'spot' or 'perp'

def calculate_dynamic_slippage(
    order_size_usd: float,
    bar_volume_usd: float,
    atr: float,
    current_price: float,
    base_slippage_bps: float = 1.0
) -> float:
    """
    Returns slippage as a fraction of price (e.g., 0.001 = 0.1%).
    Formula: base_bps * (1 + order_size/bar_volume) * (1 + atr/price)
    """
    if bar_volume_usd <= 0:
        return base_slippage_bps / 10000.0  # Fallback if volume is 0
        
    vol_ratio = order_size_usd / bar_volume_usd
    
    if current_price <= 0:
        atr_ratio = 0
    else:
        atr_ratio = atr / current_price
        
    slippage_bps = base_slippage_bps * (1 + vol_ratio) * (1 + atr_ratio)
    
    # Convert basis points to fraction (1 bps = 0.0001)
    return slippage_bps / 10000.0

def check_liquidity(order_size_usd: float, bar_volume_usd: float, threshold: float = 0.05) -> tuple[bool, str]:
    """Returns (is_valid, reason). Rejects if order_size > threshold * bar_volume."""
    if bar_volume_usd <= 0:
        return False, "Zero volume in bar"
        
    ratio = order_size_usd / bar_volume_usd
    if ratio > threshold:
        return False, f"Order size ({order_size_usd:.2f}) exceeds {threshold*100}% of bar volume ({bar_volume_usd:.2f})"
        
    return True, "Valid"

def calculate_fill_price(
    order_side: str,  # 'buy' or 'sell'
    bar_open: float,
    slippage_fraction: float
) -> float:
    """
    Fill price for market orders. Orders placed on bar N execute at bar N+1 OPEN.
    Buy: open * (1 + slippage). Sell: open * (1 - slippage).
    NEVER use mid-price, close, or any intra-bar price.
    """
    if order_side.lower() == 'buy':
        return bar_open * (1 + slippage_fraction)
    elif order_side.lower() == 'sell':
        return bar_open * (1 - slippage_fraction)
    else:
        raise ValueError(f"Unknown order side: {order_side}")
