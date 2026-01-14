export interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBookItem {
  price: number;
  size: number;
  total: number;
  depth: number; // percentage for visual bar
}

export interface Trade {
  id: string;
  price: number;
  amount: number;
  time: string;
  side: 'buy' | 'sell';
  buyer?: string;
  seller?: string;
  txHash?: string;
}

export enum OrderSide {
  BUY = 'buy',
  SELL = 'sell'
}

export enum OrderType {
  MARKET = 'Market',
  LIMIT = 'Limit'
}

export interface PositionSnapshot {
  size: bigint;
  entryPrice: bigint;
}

export interface DisplayPosition {
  symbol: string;
  leverage?: number;
  size: number;
  entryPrice: number;
  markPrice: number;
  liqPrice?: number;
  pnl: number;
  pnlPercent: number;
  side: 'long' | 'short';
}
