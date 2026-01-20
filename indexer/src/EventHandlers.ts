import { Candle, Exchange, FundingEvent, Liquidation, MarginEvent, Order, Position, Trade } from "../generated";
Exchange.MarginDeposited.handler(async ({ event, context }) => {
    const entity: MarginEvent = {
        id: `${event.transaction.hash}-${event.logIndex}`,
        trader: event.params.trader,
        amount: event.params.amount,
        eventType: "DEPOSIT",
        timestamp: event.block.timestamp,
        txHash: event.transaction.hash,
    };
    context.MarginEvent.set(entity);
});

Exchange.MarginWithdrawn.handler(async ({ event, context }) => {
    const entity: MarginEvent = {
        id: `${event.transaction.hash}-${event.logIndex}`,
        trader: event.params.trader,
        amount: event.params.amount,
        eventType: "WITHDRAW",
        timestamp: event.block.timestamp,
        txHash: event.transaction.hash,
    };
    context.MarginEvent.set(entity);
});


Exchange.OrderPlaced.handler(async ({ event, context }) => {
    const order: Order = {
        id: event.params.id.toString(),
        trader: event.params.trader,
        isBuy: event.params.isBuy,
        price: event.params.price,
        initialAmount: event.params.amount,
        amount: event.params.amount,
        status: "OPEN",
        timestamp: event.block.timestamp,
    };
    context.Order.set(order);
});

Exchange.OrderRemoved.handler(async ({ event, context }) => {
    const order = await context.Order.get(event.params.id.toString());
    if (order) {
        context.Order.set({
            ...order,
            status: order.amount === 0n ? "FILLED" : "CANCELLED",
            amount: 0n, // 清零以便 GET_OPEN_ORDERS 过滤
        });
    }
});

Exchange.TradeExecuted.handler(async ({ event, context }) => {
    // 1. 创建成交记录
    const trade: Trade = {
        id: `${event.transaction.hash}-${event.logIndex}`,
        buyer: event.params.buyer,
        seller: event.params.seller,
        price: event.params.price,
        amount: event.params.amount,
        timestamp: event.block.timestamp,
        txHash: event.transaction.hash,
        buyOrderId: event.params.buyOrderId,
        sellOrderId: event.params.sellOrderId,
    };
    context.Trade.set(trade);
    // Day 5: 更新 K 线 (1m)
const resolution = "1m";
// 向下取整到最近的分钟
const timestamp = event.block.timestamp - (event.block.timestamp % 60);
const candleId = `${resolution}-${timestamp}`;

const existingCandle = await context.Candle.get(candleId);

if (!existingCandle) {
    // 新 K 线：使用上一根 K 线的 close 作为 open
    const latestCandleState = await context.LatestCandle.get("1");
    const openPrice = latestCandleState ? latestCandleState.closePrice : event.params.price;
    
    const candle: Candle = {
        id: candleId,
        resolution,
        timestamp,
        openPrice: openPrice,
        highPrice: event.params.price > openPrice ? event.params.price : openPrice,
        lowPrice: event.params.price < openPrice ? event.params.price : openPrice,
        closePrice: event.params.price,
        volume: event.params.amount,
    };
    context.Candle.set(candle);
} else {
    // 更新现有 K 线
    const newHigh = event.params.price > existingCandle.highPrice ? event.params.price : existingCandle.highPrice;
    const newLow = event.params.price < existingCandle.lowPrice ? event.params.price : existingCandle.lowPrice;

    context.Candle.set({
        ...existingCandle,
        highPrice: newHigh,
        lowPrice: newLow,
        closePrice: event.params.price,
        volume: existingCandle.volume + event.params.amount,
    });
}

// 更新全局最新价格状态
context.LatestCandle.set({
    id: "1",
    closePrice: event.params.price,
    timestamp: event.block.timestamp
});

    // 2. 更新买卖双方订单的剩余量
    const buyOrder = await context.Order.get(event.params.buyOrderId.toString());
    if (buyOrder) {
        const newAmount = buyOrder.amount - event.params.amount;
        context.Order.set({
            ...buyOrder,
            amount: newAmount,
            status: newAmount === 0n ? "FILLED" : "OPEN",
        });
    }

    const sellOrder = await context.Order.get(event.params.sellOrderId.toString());
    if (sellOrder) {
        const newAmount = sellOrder.amount - event.params.amount;
        context.Order.set({
            ...sellOrder,
            amount: newAmount,
            status: newAmount === 0n ? "FILLED" : "OPEN",
        });
    }
});

Exchange.PositionUpdated.handler(async ({ event, context }) => {
    const position: Position = {
        id: event.params.trader,
        trader: event.params.trader,
        size: event.params.size,
        entryPrice: event.params.entryPrice,
    };
    context.Position.set(position);
});


Exchange.FundingUpdated.handler(async ({ event, context }) => {
    const entity: FundingEvent = {
        id: `${event.transaction.hash}-${event.logIndex}`,
        eventType: "GLOBAL_UPDATE",
        trader: undefined,
        cumulativeRate: event.params.cumulativeFundingRate,
        payment: undefined,
        timestamp: event.block.timestamp,
    };
    context.FundingEvent.set(entity);
});

Exchange.FundingPaid.handler(async ({ event, context }) => {
    const entity: FundingEvent = {
        id: `${event.transaction.hash}-${event.logIndex}`,
        eventType: "USER_PAID",
        trader: event.params.trader,
        cumulativeRate: undefined,
        payment: event.params.amount,
        timestamp: event.block.timestamp,
    };
    context.FundingEvent.set(entity);
});


Exchange.Liquidated.handler(async ({ event, context }) => {
    const entity: Liquidation = {
        id: `${event.transaction.hash}-${event.logIndex}`,
        trader: event.params.trader,
        liquidator: event.params.liquidator,
        amount: event.params.amount,
        fee: event.params.fee,
        timestamp: event.block.timestamp,
        txHash: event.transaction.hash,
    };
    context.Liquidation.set(entity);
    
    // 清算后持仓应该归零或减少
    const position = await context.Position.get(event.params.trader);
    if (position) {
        const newSize = position.size > 0n 
            ? position.size - event.params.amount 
            : position.size + event.params.amount;
        context.Position.set({
            ...position,
            size: newSize,
        });
    }
});