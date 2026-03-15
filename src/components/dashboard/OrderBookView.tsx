import React, { useEffect, useState, useRef } from 'react';
import { OrderBook, OrderBookLevel } from '../../types/market';
import { cn } from '../../lib/utils';

interface OrderBookViewProps {
  symbol: string;
  marketType: 'spot' | 'perp';
  tickSize: number;
}

export function OrderBookView({ symbol, marketType, tickSize }: OrderBookViewProps) {
  const [orderBook, setOrderBook] = useState<OrderBook>({ bids: [], asks: [] });
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setOrderBook({ bids: [], asks: [] });
    
    if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
    }

    const baseUrl = marketType === 'spot' 
        ? 'wss://stream.binance.com:9443/ws' 
        : 'wss://fstream.binance.com/ws';

    const ws = new WebSocket(`${baseUrl}/${symbol}@depth20@100ms`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      if (ws !== wsRef.current) return;

      const data = JSON.parse(event.data);
      const rawBids = data.bids || data.b;
      const rawAsks = data.asks || data.a;

      if (!rawBids || !rawAsks) return;

      const bids: OrderBookLevel[] = rawBids.map((b: string[]) => ({
        price: parseFloat(b[0]),
        quantity: parseFloat(b[1]),
        total: 0
      }));

      const asks: OrderBookLevel[] = rawAsks.map((a: string[]) => ({
        price: parseFloat(a[0]),
        quantity: parseFloat(a[1]),
        total: 0
      }));

      let bidTotal = 0;
      bids.forEach(b => {
        bidTotal += b.quantity;
        b.total = bidTotal;
      });

      let askTotal = 0;
      asks.forEach(a => {
        askTotal += a.quantity;
        a.total = askTotal;
      });

      setOrderBook({ bids, asks });
    };

    return () => {
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
      }
    };
  }, [symbol, marketType]);

  const maxTotal = Math.max(
    orderBook.bids.length > 0 ? orderBook.bids[orderBook.bids.length - 1].total : 0,
    orderBook.asks.length > 0 ? orderBook.asks[orderBook.asks.length - 1].total : 0
  );

  const formatPrice = (p: number) => {
    if (tickSize <= 0) return p.toFixed(2);
    // Find number of decimal places in tickSize
    const tickStr = tickSize.toString();
    const decimals = tickStr.includes('.') ? tickStr.split('.')[1].length : 0;
    return p.toFixed(decimals);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 font-mono text-[10px] overflow-hidden">
      <div className="flex-1 overflow-hidden flex flex-col-reverse">
        {orderBook.asks.slice(0, 20).reverse().map((ask, i) => (
            <div key={i} className="flex relative items-center h-4 hover:bg-zinc-900/50">
            <div 
                className="absolute right-0 top-0 bottom-0 bg-purple-500/10 transition-all duration-200"
                style={{ width: `${(ask.total / maxTotal) * 100}%` }}
            />
            <span className="flex-1 px-2 text-purple-500 z-10">{formatPrice(ask.price)}</span>
            <span className="px-2 text-zinc-400 z-10">{ask.quantity.toFixed(4)}</span>
            </div>
        ))}
      </div>

      <div className="py-0.5 bg-zinc-900 text-center text-zinc-500 border-y border-zinc-800 my-0.5 text-[9px]">
          {orderBook.asks.length > 0 && orderBook.bids.length > 0 && (
              <span>Spread: {formatPrice(orderBook.asks[0].price - orderBook.bids[0].price)}</span>
          )}
      </div>

      <div className="flex-1 overflow-hidden">
        {orderBook.bids.slice(0, 20).map((bid, i) => (
            <div key={i} className="flex relative items-center h-4 hover:bg-zinc-900/50">
            <div 
                className="absolute right-0 top-0 bottom-0 bg-cyan-400/10 transition-all duration-200"
                style={{ width: `${(bid.total / maxTotal) * 100}%` }}
            />
            <span className="flex-1 px-2 text-cyan-400 z-10">{formatPrice(bid.price)}</span>
            <span className="px-2 text-zinc-400 z-10">{bid.quantity.toFixed(4)}</span>
            </div>
        ))}
      </div>
    </div>
  );
}
