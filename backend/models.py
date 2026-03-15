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
