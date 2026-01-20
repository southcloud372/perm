// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SignedMath} from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import "./LiquidationModule.sol";

/// @notice Margin accounting (deposit/withdraw) plus margin checks.
/// @dev Day 1: 保证金模块
abstract contract MarginModule is LiquidationModule {

    /// @notice 存入保证金
   function deposit() external payable virtual nonReentrant {
    accounts[msg.sender].margin += msg.value;
    emit MarginDeposited(msg.sender, msg.value);
}

    /// @notice 提取保证金
    /// @param amount 提取金额
    function withdraw(uint256 amount) external virtual nonReentrant {
    require(amount > 0, "amount=0");
    _applyFunding(msg.sender);
    require(accounts[msg.sender].margin >= amount, "not enough margin");
    _ensureWithdrawKeepsMaintenance(msg.sender, amount);

    accounts[msg.sender].margin -= amount;
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok, "withdraw failed");

    emit MarginWithdrawn(msg.sender, amount);
}

    /// @notice 计算持仓所需保证金
    function _calculatePositionMargin(int256 size) internal view returns (uint256) {
        // TODO: 请实现此函数
        // 公式: abs(size) * markPrice * initialMarginBps / 10000 / 1e18
        if (size == 0 || markPrice == 0) return 0;
        uint256 absSize = SignedMath.abs(size);
        uint256 notional = (absSize * markPrice) / 1e18;
        return (notional * initialMarginBps) / 10_000;
    }

    /// @notice 获取用户待成交订单数量
    function _countPendingOrders(address trader) internal view returns (uint256) {
        return pendingOrderCount[trader];
    }

    /// @notice 计算最坏情况下所需保证金
    /// @dev 假设所有挂单都成交后的保证金需求
    function _calculateWorstCaseMargin(address trader) internal view returns (uint256) {
        // TODO: 请实现此函数
        // 步骤:
        // 1. 遍历买单链表，累计该用户的买单总量
        // 2. 遍历卖单链表，累计该用户的卖单总量
        // 3. 计算两种情况: 全部买单成交 vs 全部卖单成交
        // 4. 返回两者中较大的保证金需求
        Position memory pos = accounts[trader].position;

        // 1. Calculate margin needed for Open Orders (based on Order Price)
        // 使用委托价 (User Price) 而非标记价来计算挂单占用的保证金
        uint256 buyOrderMargin = 0;
        uint256 id = bestBuyId;
        while (id != 0) {
            if (orders[id].trader == trader) {
                 uint256 orderVal = (orders[id].price * orders[id].amount) / 1e18;
                 buyOrderMargin += (orderVal * initialMarginBps) / 10_000;
            }
            id = orders[id].next;
        }

        uint256 sellOrderMargin = 0;
        id = bestSellId;
        while (id != 0) {
            if (orders[id].trader == trader) {
                 uint256 orderVal = (orders[id].price * orders[id].amount) / 1e18;
                 sellOrderMargin += (orderVal * initialMarginBps) / 10_000;
            }
            id = orders[id].next;
        }

        // 2. Calculate margin needed for Current Position (based on Mark Price)
        uint256 positionMargin = _calculatePositionMargin(pos.size);

        // 3. Total Required = Position Margin + Max(BuyOrdersMargin, SellOrdersMargin)
        return positionMargin + (buyOrderMargin > sellOrderMargin ? buyOrderMargin : sellOrderMargin);
    }

    /// @notice 检查用户是否有足够保证金
    function _checkWorstCaseMargin(address trader) internal view {
        // TODO: 请实现此函数
        // 步骤:
        // 1. 计算 required = _calculateWorstCaseMargin(trader)
        // 2. 计算 marginBalance = margin + unrealizedPnl
        // 3. require(marginBalance >= required, "insufficient margin")
        uint256 required = _calculateWorstCaseMargin(trader);
        Position memory p = accounts[trader].position;

        int256 marginBalance =
            int256(accounts[trader].margin) + _unrealizedPnl(p);

        require(marginBalance >= int256(required), "insufficient margin");
    }

    /// @notice 确保提现后仍满足维持保证金要求
    function _ensureWithdrawKeepsMaintenance(address trader, uint256 amount) internal view {
        // 步骤:
        // 1. 如果没有持仓，直接返回
        // 2. 计算提现后的 marginBalance
        // 3. 计算持仓价值和维持保证金
        // 4. require(marginBalance >= maintenance)
        Account storage a = accounts[trader];
        Position memory p = a.position;

        // 1. 无持仓直接放行
        if (p.size == 0) return;

        // 2. 计算提现后的保证金余额
        uint256 marginAfterWithdraw = a.margin - amount;
        
        // 3. 计算未实现盈亏（使用 markPrice，和测试预期一致）
        int256 unrealizedPnl = _unrealizedPnl(p);
        
        // 4. 计算总保证金余额 = 提现后保证金 + 未实现盈亏
        int256 totalMargin = int256(marginAfterWithdraw) + unrealizedPnl;
        
        // 5. 计算维持保证金（关键：使用 markPrice 计算持仓价值，而非 entryPrice）
        uint256 positionValue = (uint256(SignedMath.abs(int256(p.size))) * markPrice) / 1e18;
        uint256 maintenanceMargin = (positionValue * maintenanceMarginBps) / 10_000;

        // 6. 临界值判断：>= 而不是 >，允许刚好等于维持保证金（修复核心边界）
        require(
            totalMargin >= int256(maintenanceMargin),
            "withdraw would trigger liquidation"
        );
    }
}
