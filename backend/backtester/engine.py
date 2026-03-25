import math
import numpy as np
import pandas as pd
from dataclasses import dataclass
from typing import Optional
from datetime import datetime

from .strategies.base import StrategyConfig, Signal, BaseStrategy
from .strategies.sma_cross import SMACrossover
from .strategies.rsi_revert import RSIReversion
from .strategies.bband_break import BollingerBreakout
from .execution import ExecutionConfig, calculate_dynamic_slippage, check_liquidity, calculate_fill_price
from .funding import FundingSimulator, apply_funding
from .liquidity import evaluate_liquidity
from .data.parquet_store import load_ohlcv

def debug_log(msg: str):
    try:
        with open(r"f:\breakora-new\backend\backtest_debug.log", "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now().isoformat()}] [Engine] {msg}\n")
    except: pass
from .data.fetcher import BinanceFetcher

@dataclass
class BacktestConfig:
    symbol: str
    timeframe: str
    market_type: str
    strategy: StrategyConfig
    execution: ExecutionConfig
    initial_capital: float
    start_date: str
    end_date: str
    position_size_pct: float

@dataclass
class BacktestResult:
    trades: list[dict]
    equity_curve: list[dict]
    metrics: dict
    config: dict
    warnings: list[str]

def get_strategy_instance(config: StrategyConfig) -> BaseStrategy:
    if config.name == 'sma_cross':
        return SMACrossover(config)
    elif config.name == 'rsi_revert':
        return RSIReversion(config)
    elif config.name == 'bband_break':
        return BollingerBreakout(config)
    else:
        raise ValueError(f"Unknown strategy: {config.name}")

async def run_backtest(config: BacktestConfig) -> BacktestResult:
    warnings = []
    
    # Load Data
    start_ms = int(datetime.fromisoformat(config.start_date).timestamp() * 1000)
    end_ms = int(datetime.fromisoformat(config.end_date).timestamp() * 1000)
    
    debug_log(f"Starting {config.symbol} {config.timeframe} from {config.start_date} to {config.end_date}")
    df = await load_ohlcv(config.symbol, config.timeframe, start_ms, end_ms)
    debug_log(f"Data loaded: {len(df)} rows")
    
    if df.empty:
        debug_log("WARNING: Dataframe is empty!")
        warnings.append("No historical data available for the given range.")
        return BacktestResult(trades=[], equity_curve=[], metrics={}, config=config.__dict__, warnings=warnings)
        
    df['atr'] = df['high'] - df['low'] # Simplified ATR approximation for performance
    
    # Load funding if perp
    funding_sim = None
    if config.market_type == 'perp':
        fetcher = BinanceFetcher()
        funding_df = await fetcher.fetch_funding_history(config.symbol, start_ms, end_ms)
        funding_sim = FundingSimulator(funding_df)
        
    strategy = get_strategy_instance(config.strategy)
    indicators = strategy.calculate_indicators(df)
    
    # State
    cash = config.initial_capital
    position = 0.0 # Asset amount (positive = long, negative = short)
    entry_price = 0.0
    equity = config.initial_capital
    peak_equity = config.initial_capital
    
    trades = []
    equity_curve = []
    
    pending_order = None # {"side": str, "size": float}
    
    # Variables for trade tracking
    current_trade = None
    
    for i in range(len(df)):
        bar = df.iloc[i]
        bar_dict = bar.to_dict()
        current_ts = int(bar['timestamp'])
        
        # 2. FUNDING (perps only)
        if config.market_type == 'perp' and funding_sim and position != 0:
            # Check if we crossed an 8h boundary (00:00, 08:00, 16:00 UTC)
            if i > 0:
                prev_ts = int(df.iloc[i-1]['timestamp'])
                # 8h = 28800000 ms
                if (prev_ts // 28800000) != (current_ts // 28800000):
                    # Boundary crossed, apply funding
                    rate, mark_price = funding_sim.get_funding_at(current_ts)
                    # We use bar open as the proxy for mark price if we don't have it
                    price = mark_price if mark_price > 0 else bar['open']
                    
                    val_usd = position * price
                    cash_flow = apply_funding(val_usd, rate, price)
                    cash += cash_flow
                    if current_trade:
                        current_trade['funding_paid'] += -cash_flow # positive implies we paid
        
        # 3. PENDING ORDERS (execute on bar OPEN)
        if pending_order:
            side = pending_order['side']
            order_usd = pending_order['usd_size']
            
            # Liquidity check
            liq_res = evaluate_liquidity(order_usd, bar_dict, config.execution.liquidity_threshold * 100)
            if not liq_res['allowed']:
                warnings.append(f"Order rejected on {current_ts} due to liquidity constraints. {liq_res['reason']}")
            else:
                basis_slippage = config.execution.slippage_base_bps
                if liq_res['penalty_slippage'] > 0:
                    basis_slippage += (liq_res['penalty_slippage'] * 10000)
                    warnings.append(f"Penalty slippage applied on {current_ts}: {liq_res['reason']}")
                    
                slip_frac = calculate_dynamic_slippage(order_usd, bar['quote_volume'], bar['atr'], bar['open'], basis_slippage)
                fill_price = calculate_fill_price(side, bar['open'], slip_frac)
                
                # Fees
                fee_rate = config.execution.taker_fee if config.market_type == 'spot' else config.execution.taker_fee_perp
                fee_cost = order_usd * fee_rate
                
                # Update position
                if side == 'buy':
                    new_pos = order_usd / fill_price
                else:
                    new_pos = -(order_usd / fill_price)
                
                # If we had a position in the opposite direction, we are closing it
                if position != 0 and np.sign(position) != np.sign(new_pos):
                    # Close current trade
                    exit_price = fill_price
                    pnl = (exit_price - current_trade['entry_price']) * position if position > 0 else (current_trade['entry_price'] - exit_price) * abs(position)
                    
                    current_trade['exit_time'] = current_ts
                    current_trade['exit_price'] = exit_price
                    current_trade['fee_paid'] += fee_cost
                    current_trade['slippage_cost'] += abs(fill_price - bar['open']) * abs(position)
                    current_trade['pnl'] = pnl - current_trade['fee_paid'] - current_trade['funding_paid']
                    current_trade['pnl_pct'] = current_trade['pnl'] / (current_trade['size'] * current_trade['entry_price'])
                    trades.append(current_trade)
                    
                    cash += pnl
                    cash -= fee_cost
                    position = 0
                    current_trade = None
                    
                # Open or add to position
                if position == 0:
                    # New trade
                    position = new_pos
                    entry_price = fill_price
                    cash -= fee_cost
                    
                    current_trade = {
                        'entry_time': current_ts,
                        'exit_time': None,
                        'side': 'long' if side == 'buy' else 'short',
                        'entry_price': entry_price,
                        'exit_price': None,
                        'size': abs(position),
                        'pnl': 0.0,
                        'pnl_pct': 0.0,
                        'fee_paid': fee_cost,
                        'slippage_cost': abs(fill_price - bar['open']) * abs(position),
                        'funding_paid': 0.0
                    }
            
            pending_order = None
            
        # 5. MARK-TO-MARKET
        pos_value = abs(position) * bar['close']
        if position > 0:
            unrealized = (bar['close'] - entry_price) * position
        elif position < 0:
            unrealized = (entry_price - bar['close']) * abs(position)
        else:
            unrealized = 0
            
        equity = cash + unrealized
        if equity > peak_equity:
            peak_equity = equity
            
        drawdown = (peak_equity - equity) / peak_equity if peak_equity > 0 else 0
        
        equity_curve.append({
            "timestamp": current_ts,
            "equity": equity,
            "drawdown": drawdown
        })
        
        # 4. SIGNALS
        # Evaluate signal on current bar
        sig = strategy.generate_signal(indicators, i)
        
        if sig != Signal.NONE:
            debug_log(f"Signal at {current_ts}: {sig.name} (Pos: {position})")
        
        if sig == Signal.BUY and position <= 0:
            target_usd = equity * config.position_size_pct
            if position < 0:
                # Need to close short and then open long
                # For simplicity, we just issue a buy order of 2x target_usd if we want to reverse
                target_usd += abs(position) * bar['close']
            pending_order = {"side": "buy", "usd_size": target_usd}
            
        elif sig == Signal.SELL and position >= 0:
            target_usd = equity * config.position_size_pct
            if position > 0:
                target_usd += abs(position) * bar['close']
            pending_order = {"side": "sell", "usd_size": target_usd}

    # Close any open position at the end
    if position != 0 and len(df) > 0 and current_trade:
        last_bar = df.iloc[-1]
        exit_price = last_bar['close']
        pnl = (exit_price - current_trade['entry_price']) * position if position > 0 else (current_trade['entry_price'] - exit_price) * abs(position)
        
        current_trade['exit_time'] = int(last_bar['timestamp'])
        current_trade['exit_price'] = exit_price
        current_trade['pnl'] = pnl - current_trade['fee_paid'] - current_trade['funding_paid']
        current_trade['pnl_pct'] = current_trade['pnl'] / (current_trade['size'] * current_trade['entry_price'])
        trades.append(current_trade)

    # Metrics
    metrics = calculate_metrics(trades, equity_curve, config.initial_capital)
    
    return BacktestResult(
        trades=trades,
        equity_curve=equity_curve,
        metrics=metrics,
        config=config.__dict__,
        warnings=warnings
    )

def calculate_metrics(trades: list[dict], equity_curve: list[dict], initial_capital: float) -> dict:
    if not equity_curve:
        return {}
        
    final_equity = equity_curve[-1]['equity']
    total_return = (final_equity - initial_capital) / initial_capital
    
    # CAGR
    start_ts = equity_curve[0]['timestamp']
    end_ts = equity_curve[-1]['timestamp']
    days = max(1, (end_ts - start_ts) / (1000 * 60 * 60 * 24))
    years = days / 365.0
    cagr = ((final_equity / initial_capital) ** (1/years)) - 1 if years > 0 and final_equity > 0 else 0
    
    # Daily Returns mapping
    eq_df = pd.DataFrame(equity_curve)
    eq_df['date'] = pd.to_datetime(eq_df['timestamp'], unit='ms').dt.date
    daily = eq_df.groupby('date')['equity'].last()
    daily_returns = daily.pct_change().dropna()
    
    sharpe = 0.0
    sortino = 0.0
    if len(daily_returns) > 1 and daily_returns.std() != 0:
        sharpe = (daily_returns.mean() / daily_returns.std()) * math.sqrt(365)
        downside = daily_returns[daily_returns < 0]
        if not downside.empty and downside.std() != 0:
            sortino = (daily_returns.mean() / downside.std()) * math.sqrt(365)
            
    max_drawdown = eq_df['drawdown'].max()
    calmar = cagr / abs(max_drawdown) if max_drawdown > 0 else 0
    
    win_rate = 0.0
    profit_factor = 0.0
    avg_win_loss = 0.0
    
    if trades:
        winners = [t for t in trades if t['pnl'] > 0]
        losers = [t for t in trades if t['pnl'] <= 0]
        win_rate = len(winners) / len(trades)
        
        gross_profit = sum(t['pnl'] for t in winners)
        gross_loss = abs(sum(t['pnl'] for t in losers))
        
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else gross_profit
        
        avg_win = gross_profit / len(winners) if winners else 0
        avg_loss = gross_loss / len(losers) if losers else 0
        
        avg_win_loss = avg_win / avg_loss if avg_loss > 0 else avg_win
        
    return {
        "total_return": total_return,
        "cagr": cagr,
        "sharpe": sharpe,
        "sortino": sortino,
        "max_drawdown": max_drawdown,
        "calmar": calmar,
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "avg_win_loss": avg_win_loss,
        "total_trades": len(trades)
    }
