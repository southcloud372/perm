// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SignedMath} from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import "./PricingModule.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Liquidation checks and execution.
/// @dev Day 6: 清算模块
abstract contract LiquidationModule is PricingModule {

    /// @notice 检查用户是否可被清算
    /// @param trader 用户地址
    /// @return 是否可清算
    function canLiquidate(address trader) public view virtual returns (bool) {
        // 步骤:
        // 1. 获取用户持仓，如果为 0 返回 false
        // 2. 计算当前标记价下的未实现盈亏
        // 3. 计算 marginBalance = margin + unrealizedPnl
        // 4. 计算 maintenance = positionValue * (maintenanceMarginBps + liquidationFeeBps) / 10000
        // 5. 返回 marginBalance < maintenance
        Position memory p = accounts[trader].position;
        if (p.size == 0) return false;

        uint256 markPrice = _calculateMarkPrice(indexPrice);
        
        int256 unrealized = _unrealizedPnl(p);
        
        int256 marginBalance = int256(accounts[trader].margin) + unrealized;
        
        uint256 priceBase = markPrice == 0 ? p.entryPrice : markPrice;
        uint256 positionValue = SignedMath.abs(int256(priceBase) * p.size) / 1e18;
        
        // Binance Style: Maintenance + Liquidation Fee 作为触发线
        uint256 maintenance = (positionValue * (maintenanceMarginBps + liquidationFeeBps)) / 10_000;
        
        return marginBalance < int256(maintenance);
    }

    /// @notice 清算用户 (在 OrderBookModule 中实现具体逻辑)
    function liquidate(address trader, uint256 amount) external virtual nonReentrant {
        // 将在 OrderBookModule 中实现
        
        require(msg.sender != trader, "cannot self-liquidate");
        require(markPrice > 0, "mark price unset");
        
        _applyFunding(trader);
        require(canLiquidate(trader), "position healthy");
        
        _clearTraderOrders(trader);

        Position storage p = accounts[trader].position;
        uint256 sizeAbs = SignedMath.abs(p.size);
        
        // amount=0 表示全部清算
        uint256 liqAmount = amount == 0 ? sizeAbs : Math.min(amount, sizeAbs);

        // 1. 执行市价平仓
        if (p.size > 0) {
            Order memory closeOrder = Order(0, trader, false, 0, liqAmount, liqAmount, block.timestamp, 0);
            _matchLiquidationSell(closeOrder);
        } else {
            Order memory closeOrder = Order(0, trader, true, 0, liqAmount, liqAmount, block.timestamp, 0);
            _matchLiquidationBuy(closeOrder);
        }
        
        // 2. 计算并转移清算费
        uint256 notional = (liqAmount * markPrice) / 1e18;
        uint256 fee = (notional * liquidationFeeBps) / 10_000;
        if (fee < minLiquidationFee) fee = minLiquidationFee;
        
        // 从被清算者扣除，给清算者
        if (accounts[trader].margin >= fee) {
            accounts[trader].margin -= fee;
            accounts[msg.sender].margin += fee;
        } else {
            // 坏账情况：被清算者保证金不足，清算者只能获得剩余部分
            uint256 available = accounts[trader].margin;
            accounts[trader].margin = 0;
            accounts[msg.sender].margin += available;
        }
        
        emit Liquidated(trader, msg.sender, liqAmount, fee);
        
        // 3. H-1 安全检查：部分清算后验证
        // 防止攻击者反复小额清算提取费用
        Position storage pAfterLiq = accounts[trader].position;
        if (pAfterLiq.size != 0) {
            require(!canLiquidate(trader), "must fully liquidate unhealthy position");
        }
    }

    /// @notice 清除用户所有挂单
    /// @param trader 用户地址
    function _clearTraderOrders(address trader) internal returns (uint256 freedLocked) {
        // 步骤:
        // 1. 遍历买单链表，删除该用户的订单
        // 2. 遍历卖单链表，删除该用户的订单
        // 3. 触发 OrderRemoved 事件
        bestBuyId = _removeOrders(bestBuyId, trader);
        bestSellId = _removeOrders(bestSellId, trader);
    }

    /// @notice 从链表中删除指定用户的订单
    function _removeOrders(uint256 headId, address trader) internal returns (uint256 newHead) {
        newHead = headId;
        uint256 current = headId;
        uint256 prev = 0;

        while (current != 0) {
            Order storage o = orders[current];
            uint256 next = o.next;
            if (o.trader == trader) {
                if (prev == 0) {
                    newHead = next;
                } else {
                    orders[prev].next = next;
                }
                pendingOrderCount[trader]--;  // 更新挂单计数
                emit OrderRemoved(o.id);
                delete orders[current];
                current = next;
                continue;
            }
            prev = current;
            current = next;
        }
    }

    uint256 constant SCALE = 1e18;

    /// @notice 执行交易
    /// @dev Day 3: 撮合成交核心函数
    function _executeTrade(
        address buyer,
        address seller,
        uint256 buyOrderId,
        uint256 sellOrderId,
        uint256 amount,
        uint256 price
    ) internal virtual {
        // TODO: 请实现此函数
        // 步骤:
        // 1. 对买卖双方应用资金费 _applyFunding
        // 2. 更新买方持仓 _updatePosition(buyer, true, amount, price)
        // 3. 更新卖方持仓 _updatePosition(seller, false, amount, price)
        // 4. 触发 TradeExecuted 事件
        _applyFunding(buyer);
        _applyFunding(seller);

        _updatePosition(buyer, true, amount, price);
        _updatePosition(seller, false, amount, price);

        emit TradeExecuted(buyOrderId, sellOrderId, price, amount, buyer, seller);
    }

    /// @notice 更新用户持仓
    /// @dev Day 3: 持仓更新核心函数
    function _updatePosition(
        address trader,
        bool isBuy,
        uint256 amount,
        uint256 tradePrice
    ) internal virtual {
        // TODO: 请实现此函数
        // 步骤:
        // 1. 获取用户当前持仓
        // 2. 判断是加仓还是减仓/平仓
        // 3. 加仓: 计算加权平均入场价，增加持仓
        // 4. 减仓: 计算已实现盈亏，更新 margin
        // 5. 更新持仓 size 和 entryPrice
        Position storage p = accounts[trader].position;
        int256 signed = isBuy ? int256(amount) : -int256(amount);
        uint256 existingAbs = SignedMath.abs(p.size);

    // 1) 同方向加仓
        if (p.size == 0 || (p.size > 0) == (signed > 0)) {
            uint256 newAbs = existingAbs + amount;
            uint256 weighted = existingAbs == 0
                ? tradePrice
                : (existingAbs * p.entryPrice + amount * tradePrice) / newAbs;
            p.entryPrice = weighted;
            p.size += signed;
            emit PositionUpdated(trader, p.size, p.entryPrice);
            return;
    }

    // 2) 反向减仓/平仓
        uint256 closing = amount < existingAbs ? amount : existingAbs;
        int256 pnlPerUnit = p.size > 0
            ? int256(tradePrice) - int256(p.entryPrice)
            : int256(p.entryPrice) - int256(tradePrice);
        int256 pnl = (pnlPerUnit * int256(closing)) / int256(SCALE);

    // 盈亏直接结算到 margin（无需单独记录 realizedPnl）
        int256 newMargin = int256(accounts[trader].margin) + pnl;
        if (newMargin < 0) accounts[trader].margin = 0;
        else accounts[trader].margin = uint256(newMargin);

    // 3) 是否反向开仓
        uint256 remaining = amount - closing;
        if (closing == existingAbs) {
            if (remaining == 0) {
                p.size = 0;
                p.entryPrice = tradePrice;
            } else {
                p.size = signed > 0 ? int256(remaining) : -int256(remaining);
                p.entryPrice = tradePrice;
            }
        } else {
            if (p.size > 0) p.size -= int256(closing);
            else p.size += int256(closing);
        }
    
    // Day 5 优化：发出 PositionUpdated 事件，简化 Indexer 逻辑
        emit PositionUpdated(trader, p.size, p.entryPrice);
    }

    
function _matchLiquidationSell(Order memory incoming) internal virtual{
    while (incoming.amount > 0 && bestBuyId != 0) {
        Order storage head = orders[bestBuyId];
        
        uint256 matched = Math.min(incoming.amount, head.amount);
        _executeTrade(head.trader, incoming.trader, head.id, 0, matched, head.price);

        incoming.amount -= matched;
        head.amount -= matched;

        if (head.amount == 0) {
            uint256 nextHead = head.next;
            uint256 removedId = head.id;
            pendingOrderCount[head.trader]--;
            delete orders[bestBuyId];
            bestBuyId = nextHead;
            emit OrderRemoved(removedId);
        }
    }
}

function _matchLiquidationBuy(Order memory incoming) internal virtual{
    while (incoming.amount > 0 && bestSellId != 0) {
        Order storage head = orders[bestSellId];
        
        uint256 matched = Math.min(incoming.amount, head.amount);
        _executeTrade(incoming.trader, head.trader, 0, head.id, matched, head.price);

        incoming.amount -= matched;
        head.amount -= matched;

        if (head.amount == 0) {
            uint256 nextHead = head.next;
            uint256 removedId = head.id;
            pendingOrderCount[head.trader]--;
            delete orders[bestSellId];
            bestSellId = nextHead;
            emit OrderRemoved(removedId);
        }
    }
}
}
