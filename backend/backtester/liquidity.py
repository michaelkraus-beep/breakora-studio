def evaluate_liquidity(order_size_usd: float, bar: dict, threshold_pct: float = 5.0) -> dict:
    """
    Evaluates order size against candle volume.
    Returns {"allowed": bool, "penalty_slippage": float, "reason": str}.
    If order_size_usd > threshold_pct/100 * bar_volume_usd: allowed = False
    If order_size_usd > (threshold_pct/2)/100 * bar_volume_usd: add penalty_slippage
    """
    bar_volume_usd = float(bar['quote_volume'])
    
    if bar_volume_usd <= 0:
        return {"allowed": False, "penalty_slippage": 0.0, "reason": "Zero bar volume"}
        
    max_allowed = bar_volume_usd * (threshold_pct / 100.0)
    warning_threshold = max_allowed / 2.0
    
    if order_size_usd > max_allowed:
        return {
            "allowed": False, 
            "penalty_slippage": 0.0, 
            "reason": f"Order size ({order_size_usd:.2f}) > {threshold_pct}% of vol ({max_allowed:.2f})"
        }
        
    penalty = 0.0
    if order_size_usd > warning_threshold:
        # Penalty slippage scales proportionally from warning to max
        # At max_allowed, penalty could be e.g. an extra 10 basis points (0.001)
        excess_ratio = (order_size_usd - warning_threshold) / warning_threshold
        penalty_bps = excess_ratio * 10.0 # up to 10 bps
        penalty = penalty_bps / 10000.0
        
        reason = f"Liquidity penalty applied: {penalty_bps:.1f} bps"
    else:
        reason = "Valid"
        
    return {
        "allowed": True,
        "penalty_slippage": penalty,
        "reason": reason
    }
