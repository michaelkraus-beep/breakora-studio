"""
Scanner Service V3 — Stabilized multi-stage market analytics.
Uses pandas + optional pandas_ta for robust indicator calculation.
"""
import math
import pandas as pd
import httpx
import asyncio
import time as _time_mod
from dataclasses import dataclass, asdict
from database import AsyncSessionLocal
from models import Candle
from sqlalchemy import select, distinct, func

PANDAS_TA_AVAILABLE = False
try:
    import pandas_ta as ta
    PANDAS_TA_AVAILABLE = True
except ImportError:
    print("[Scanner] WARNING: pandas_ta not found. Using basic fallback analysis.")

# Global to track discovery cooldown
LAST_DISCOVERY_TIME = 0
LATEST_DISCOVERY: list[dict] = []
DISCOVERY_COOLDOWN = 300 
SCAN_LOCK = asyncio.Lock()

def clean_data(obj):
    """Recursively convert numpy types and other objects to standard JSON types."""
    if isinstance(obj, dict):
        return {k: clean_data(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [clean_data(v) for v in obj]
    elif hasattr(obj, 'item'): # numpy types
        return obj.item()
    elif isinstance(obj, (float, int)) and math.isnan(obj):
        return 0.0
    elif isinstance(obj, (float, int)) and math.isinf(obj):
        return 0.0
    return obj

def classify_market_cap_tier(vol_24h: float) -> str:
    """Classify an asset into a market cap tier based on 24h quote volume (USDT)."""
    if vol_24h >= 500_000_000:   return 'MEGA'    # BTC, ETH level
    if vol_24h >= 100_000_000:   return 'LARGE'   # SOL, BNB, XRP
    if vol_24h >= 20_000_000:    return 'MID'     # Mid-cap alts
    if vol_24h >= 2_000_000:     return 'SMALL'   # Small-cap
    return 'MICRO'                                 # Micro-cap / low liquidity

@dataclass
class ScanResult:
    symbol: str
    price: float
    price_change_5m: float
    price_change_15m: float
    price_change_1h: float
    rvol: float               
    vol_surge_pct: float      
    vwap_pct: float           
    is_new_high: bool
    is_new_low: bool
    rsi: float
    macd_signal: str
    bollinger_b: float        
    bb_width: float           
    supertrend: str           
    atr_pct: float            
    ema_alignment: str        
    delta_divergence: bool
    imbalance_ratio: float
    stacked_imbalance: int    
    large_trade_detected: bool
    absorption: str           
    squeeze_state: str        
    ttm_squeeze_fired: str    
    atr_expansion: bool
    vol_24h: float
    market_cap_tier: str
    ob_depth: float           
    slippage: float           
    funding_rate: float
    score: float              
    triggered_filters: list   
    discovery: bool = False

async def fetch_ob_and_funding(symbol: str, market_type: str = 'spot', client: httpx.AsyncClient = None) -> dict:
    base_url = "https://fapi.binance.com" if market_type == 'perp' else "https://api.binance.com"
    sym = symbol.upper()
    res_data = {'ob_depth': 0.0, 'slippage': 0.0, 'funding_rate': 0.0}
    
    close_client = False
    if client is None:
        client = httpx.AsyncClient(timeout=5)
        close_client = True
        
    try:
        depth_resp = await client.get(f"{base_url}/api/v3/depth" if market_type == 'spot' else f"{base_url}/fapi/v1/depth", 
                                    params={"symbol": sym, "limit": 20})
        if depth_resp.status_code == 200:
            d = depth_resp.json()
            bids = d.get('bids', [])[:10]
            asks = d.get('asks', [])[:10]
            bd = sum(float(b[0]) * float(b[1]) for b in bids)
            ad = sum(float(a[0]) * float(a[1]) for a in asks)
            res_data['ob_depth'] = bd + ad
            
            target_val = 50000
            if ad > 0:
                sv, fp = 0, 0
                for p, q in d.get('asks', []):
                    p, q = float(p), float(q)
                    if sv + (p * q) >= target_val:
                        fp = p
                        break
                    sv += (p * q)
                if fp > 0:
                    mid = (float(d['bids'][0][0]) + float(d['asks'][0][0])) / 2
                    res_data['slippage'] = ((fp - mid) / mid) * 100
        
        if market_type == 'perp':
            f_resp = await client.get(f"{base_url}/fapi/v1/premiumIndex", params={"symbol": sym})
            if f_resp.status_code == 200:
                res_data['funding_rate'] = float(f_resp.json().get('lastFundingRate', 0)) * 100
    except: pass
    finally:
        if close_client: await client.aclose()
    return res_data

def calculate_complex_signals(df: pd.DataFrame, candles: list) -> dict:
    if len(df) < 55 or not PANDAS_TA_AVAILABLE:
        return {}
    try:
        df.ta.rsi(length=14, append=True)
        df.ta.macd(fast=12, slow=26, signal=9, append=True)
        df.ta.supertrend(length=10, multiplier=3, append=True)
        df.ta.bbands(length=20, std=2, append=True)
        df.ta.squeeze(append=True)
        df.ta.atr(length=14, append=True)
        
        last = df.iloc[-1]
        prev = df.iloc[-2]
        
        # EMA
        e8 = ta.ema(df['close'], length=8).iloc[-1]
        e21 = ta.ema(df['close'], length=21).iloc[-1]
        e55 = ta.ema(df['close'], length=55).iloc[-1]
        align = 'MIXED'
        if e8 > e21 > e55: align = 'BULLISH'
        elif e8 < e21 < e55: align = 'BEARISH'

        # OF
        rec = candles[-5:]
        cdel = sum(sum(l.get('delta',0) for l in (c.footprint or {}).values() if isinstance(l, dict)) for c in rec)
        pdir = last.close - df.iloc[-5].open
        ddiv = (cdel > 0 and pdir < 0) or (cdel < 0 and pdir > 0)
        
        # Squeeze Fire
        sq_col = [c for c in df.columns if 'SQZ_' in c and 'ON' in c][0]
        mh_col = [c for c in df.columns if 'MACDh' in c][0]
        sf = 'NONE'
        if prev[sq_col] == 1 and last[sq_col] == 0:
            sf = 'LONG' if last[mh_col] > 0 else 'SHORT'

        return {
            'rsi': last.filter(like='RSI').iloc[0],
            'macd_signal': 'BULLISH' if last[mh_col] > prev[mh_col] else 'BEARISH',
            'bollinger_b': last.filter(like='BBP').iloc[0] / 100,
            'bb_width': last.filter(like='BBB').iloc[0],
            'supertrend': 'BULLISH' if last.filter(like='SUPERTd').iloc[0] > 0 else 'BEARISH',
            'atr_pct': (last.filter(like='ATR').iloc[0] / last.close) * 100,
            'ema_alignment': align,
            'delta_divergence': ddiv,
            'absorption': 'NONE', # Simplified
            'squeeze_state': 'HIGH' if last[sq_col] == 1 else 'NONE',
            'ttm_squeeze_fired': sf,
            'atr_expansion': False # Simplified
        }
    except: return {}

def compute_score(r: dict) -> tuple[float, list[str]]:
    s, trig = 0.0, []
    
    # 1. Core Signals
    rvol = float(r.get('rvol', 1.0))
    pc5 = float(r.get('price_change_5m', 0.0))
    
    if rvol >= 2.5: s += 15; trig.append(f"RVOL {rvol:.1f}x")
    elif rvol >= 1.5: s += 5; trig.append("Elevated Vol")
    
    if abs(pc5) >= 1.2: s += 10; trig.append(f"5m {pc5:+.1f}%")
    elif abs(pc5) >= 0.5: s += 3
    
    # 2. Technical Signal Bonuses
    if r.get('ttm_squeeze_fired') != 'NONE': s += 25; trig.append("SQUEEZE FIRE")
    if float(r.get('rsi', 50)) < 30 or float(r.get('rsi', 50)) > 70: s += 5; trig.append("RSI Extreme")
    if r.get('supertrend') == 'BULLISH' and r.get('ema_alignment') == 'BULLISH': s += 10; trig.append("Trend Alignment")
    
    # Base score for major assets to ensure visibility if they have ANY activity
    if r['symbol'] in ['btcusdt', 'ethusdt', 'solusdt']:
        s += 5
        
    return float(min(s, 100.0)), trig

def _cpu_bound_analysis(sym, candles_data):
    try:
        df = pd.DataFrame(candles_data)
        last_c = df.iloc[-1]
        prev_5m = df.iloc[-6]
        
        pc_5m = (last_c['close'] - prev_5m['close']) / prev_5m['close'] * 100
        rv = df['volume'].iloc[-5:].sum()
        av = df['volume'].iloc[-25:-5].mean() * 5
        rvol = rv / av if av > 0 else 1.0
        
        # Base asset data
        res = {
            'symbol': str(sym).lower(), 'price': float(last_c['close']),
            'price_change_5m': float(pc_5m), 'rvol': float(rvol),
            'vol_surge_pct': float((rv-av)/av*100) if av > 0 else 0.0,
            'price_change_15m': float((last_c.close - df.iloc[-16].close)/df.iloc[-16].close*100) if len(df) >= 16 else 0.0,
            'price_change_1h': float((last_c.close - df.iloc[-61].close)/df.iloc[-61].close*100) if len(df) >= 61 else 0.0,
            'is_new_high': bool(last_c.close >= df['high'].iloc[-60:-1].max()) if len(df) >= 60 else False,
            'is_new_low': bool(last_c.close <= df['low'].iloc[-60:-1].min()) if len(df) >= 60 else False,
            'vol_24h': float(df['volume'].sum() * last_c.close),
            'market_cap_tier': classify_market_cap_tier(float(df['volume'].sum() * last_c.close))
        }
        
        class Stub: 
            def __init__(self, d): self.footprint = d.get('footprint', {})
        signals = calculate_complex_signals(df, [Stub(d) for d in candles_data])
        if signals:
            for k, v in signals.items():
                if isinstance(v, (int, float, complex)) and not isinstance(v, bool):
                    res[k] = float(v)
                else:
                    res[k] = v
        else:
            res.update({
                'rsi': 50.0, 'macd_signal': 'NEUTRAL', 'bollinger_b': 0.5, 'bb_width': 0.0,
                'supertrend': 'NEUTRAL', 'atr_pct': 0.0, 'ema_alignment': 'MIXED',
                'delta_divergence': False, 'absorption': 'NONE', 'squeeze_state': 'NONE',
                'ttm_squeeze_fired': 'NONE', 'atr_expansion': False
            })
        return res
    except: return None

async def scan(market_type: str = 'spot', lookback_1m: int = 240) -> list[dict]:
    if SCAN_LOCK.locked(): return []
    async with SCAN_LOCK:
        print(f"[Scanner] Starting optimized scan (lookback={lookback_1m}m)...")
        async with AsyncSessionLocal() as session:
            # Check maximum timestamp in DB globally first. Allows scanner to work with stale dev data.
            max_time_res = await session.execute(select(func.max(Candle.time)))
            max_db_time = max_time_res.scalar()
            
            # Use max DB time as current if engine has been dead for >1 hour
            current_ms = int(_time_mod.time() * 1000)
            if max_db_time and (current_ms - max_db_time) > 60 * 60_000:
                base_time_ms = max_db_time
                print(f"[Scanner] Stale DB detected. Falling back to DB time {max_db_time} instead of real-time.")
            else:
                base_time_ms = current_ms
            
            start_ms = base_time_ms - (lookback_1m + 60) * 60_000

            # Only fetch symbols that are actually in the live engine (performance)
            q = select(Candle).where(
                Candle.interval == '1m', 
                Candle.time >= start_ms, 
                Candle.market_type == market_type
            )
            result = await session.execute(q)
            all_c = result.scalars().all()
        
        inter_res = []
        if not all_c:
            print("[Scanner] No recent candles found in DB. Falling back to Discovery only.")
        else:
            groups = {}
            for c in all_c:
                if c.symbol not in groups: groups[c.symbol] = []
                groups[c.symbol].append({
                    'time': c.time, 'open': c.open, 'high': c.high, 'low': c.low, 
                    'close': c.close, 'volume': c.volume, 'footprint': c.footprint or {}
                })
            
            print(f"[Scanner] Processing {len(groups)} symbols...")
            loop = asyncio.get_event_loop()
            for sym, c_data in groups.items():
                if len(c_data) < 10: continue
                r = await loop.run_in_executor(None, _cpu_bound_analysis, sym, c_data)
                if r: inter_res.append(r)
            
        final = []
        # Increase semaphore to 25 for faster API fetching, but keep timeout low
        sem = asyncio.Semaphore(25)
        async with httpx.AsyncClient(timeout=3) as client:
            async def wrap(r):
                async with sem:
                    try:
                        liq = await fetch_ob_and_funding(r['symbol'], market_type, client)
                        r.update(liq)
                        sc, tr = compute_score(r)
                        r['score'], r['triggered_filters'] = round(sc, 1), tr
                        final.append(r)
                    except: pass
            await asyncio.gather(*(wrap(r) for r in inter_res))
            
        # 4. Multi-Asset Discovery (trending on Binance but not in DB)
        # Added a cooldown so we don't spam Binance's 24h ticker every 10 seconds
        global LAST_DISCOVERY_TIME, LATEST_DISCOVERY
        now = _time_mod.time()
        if now - LAST_DISCOVERY_TIME > 60: # 1 minute cooldown
            try:
                discovery = await discover_trending_symbols(market_type)
                LATEST_DISCOVERY = discovery[:100]  # Cache top 100 discovery results
                LAST_DISCOVERY_TIME = now
            except Exception as e:
                print(f"[Scanner] Discovery error: {e}")

        # Always append the cached discovery results so they don't flicker between the 60s cooldowns
        for d in LATEST_DISCOVERY:
            if not any(r['symbol'] == d['symbol'] for r in final):
                final.append(d)

        final.sort(key=lambda x: x['score'], reverse=True)
        return clean_data(final)

async def discover_trending_symbols(market_type: str = 'spot') -> list[dict]:
    """Identifies top trending/volume assets on Binance not currently recorded."""
    base_url = "https://fapi.binance.com" if market_type == 'perp' else "https://api.binance.com"
    endpoint = "/fapi/v1/ticker/24hr" if market_type == 'perp' else "/api/v3/ticker/24hr"
    
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{base_url}{endpoint}")
            if resp.status_code != 200: return []
            tickers = resp.json()
            
            # Filter for USDT pairs, sort by volume descent
            hot = [t for t in tickers if t['symbol'].endswith('USDT')]
            hot.sort(key=lambda x: float(x.get('quoteVolume', 0)), reverse=True)
            
            results = []
            for t in hot[:200]: # Check top 200 by volume for comprehensive coverage
                symbol = t['symbol'].lower()
                pc = float(t.get('priceChangePercent', 0))
                qv = float(t.get('quoteVolume', 0))
                tier = classify_market_cap_tier(qv)
                # Base discovery results — ensure all ScanResult fields are present to prevent frontend crashes
                results.append({
                    'symbol': symbol,
                    'price': float(t['lastPrice']),
                    'price_change_5m': 0.0, 
                    'rvol': 1.0, 
                    'vol_surge_pct': 0.0,
                    'price_change_15m': 0.0, 
                    'price_change_1h': pc,  # Use 24h change as rough 1h proxy for discovery
                    'vwap_pct': 0.0,
                    'is_new_high': False, 
                    'is_new_low': False,
                    'rsi': 50.0, 
                    'macd_signal': 'NEUTRAL', 
                    'bollinger_b': 0.5,
                    'bb_width': 0.0, 
                    'supertrend': 'NEUTRAL', 
                    'atr_pct': 0.0,
                    'ema_alignment': 'MIXED', 
                    'delta_divergence': False,
                    'imbalance_ratio': 1.0,
                    'stacked_imbalance': 0,
                    'large_trade_detected': False,
                    'absorption': 'NONE', 
                    'squeeze_state': 'NONE',
                    'ttm_squeeze_fired': 'NONE', 
                    'atr_expansion': False,
                    'vol_24h': qv,
                    'market_cap_tier': tier,
                    'ob_depth': 0.0, 
                    'slippage': 0.0, 
                    'funding_rate': 0.0,
                    'score': 10 + abs(pc),
                    'triggered_filters': ["Trending (24h)"],
                    'discovery': True
                })
            return results
    except Exception as e:
        print(f"[Scanner] discover_trending_symbols error: {e}")
        return []
