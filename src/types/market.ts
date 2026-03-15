export interface Ticker {
  symbol: string;
  price: number;
  priceChangePercent: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume?: number; // Total Quote Asset Volume
  count?: number; // Total number of trades in 24h
}

export interface Trade {
  id: number;
  price: number;
  quantity: number;
  time: number;
  isBuyerMaker: boolean; // true = sell, false = buy
}

export interface FootprintLevel {
  price: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
  footprint?: { [price: number]: FootprintLevel };
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
  total: number;
}

export interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}
