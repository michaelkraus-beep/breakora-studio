from sqlalchemy import Column, Integer, String, Float, Boolean, BigInteger, JSON
from database import Base

class Candle(Base):
    __tablename__ = "candles"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, index=True, nullable=False)
    market_type = Column(String, nullable=False) # 'spot' or 'perp'
    interval = Column(String, index=True, nullable=False) # '1m', '5m', etc.
    time = Column(BigInteger, index=True, nullable=False) # Unix timestamp in milliseconds
    
    open = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    close = Column(Float, nullable=False)
    volume = Column(Float, nullable=False)
    quote_volume = Column(Float, nullable=True) # Quote asset volume
    count = Column(Integer, nullable=True)       # Trade count
    is_closed = Column(Boolean, default=False)
    
    # Store footprint data as JSON. In a heavier app, we might normalize this 
    # into a separate table, but JSON is efficient enough for SQLite/PostgreSQL
    # for rendering OrderBook/Delta charts
    footprint = Column(JSON, nullable=True) 

class SqueezeEvent(Base):
    __tablename__ = "squeeze_events"
    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, index=True)
    interval = Column(String, index=True)
    timestamp = Column(BigInteger, index=True, nullable=False)
    features = Column(JSON, nullable=False) # Store the array of extracted ML features
    label = Column(Integer, nullable=False) # 1 for bull success, -1 for bear success, 0 for failure

import time

class MonitoredSymbol(Base):
    __tablename__ = "monitored_symbols"
    symbol = Column(String, primary_key=True) # symbol in lowercase, e.g., 'btcusdt'
    market_type = Column(String, default='spot')
    active = Column(Boolean, default=True)
    added_at = Column(BigInteger, default=lambda: int(time.time() * 1000))

class WikiArticle(Base):
    __tablename__ = "wiki_articles"
    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String, index=True, unique=True, nullable=False)
    title = Column(String, nullable=False)
    category = Column(String, index=True, nullable=False)
    content = Column(String, nullable=False)
