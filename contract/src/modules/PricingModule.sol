// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./FundingModule.sol";

/// @notice Price management (Operator updates only).
/// @dev Day 4: 价格预言机模块
abstract contract PricingModule is FundingModule {

    /// @notice 更新指数价格 (仅 OPERATOR_ROLE)
    /// @param newIndexPrice 新的指数价格
    function updateIndexPrice(uint256 newIndexPrice) external virtual onlyRole(OPERATOR_ROLE) {
        // TODO: 请实现此函数
        // 步骤:
        // 1. 更新 indexPrice
        // 2. 调用 _calculateMarkPrice 计算标记价
        // 3. 更新 markPrice
        // 4. 触发 MarkPriceUpdated 事件
    }

    /// @notice 计算标记价格
    /// @dev 使用订单簿最优价和指数价的中位数
    /// @param indexPrice_ 指数价格
    /// @return 标记价格
    function _calculateMarkPrice(uint256 indexPrice_) internal view virtual returns (uint256) {
        // TODO: 请实现此函数
        // 步骤:
        // 1. 获取 bestBid 和 bestAsk
        // 2. 如果订单簿为空，返回 indexPrice_
        // 3. 计算 median(bestBid, bestAsk, indexPrice_)
        // 4. 钳位到 indexPrice_ ± 5%
        return indexPrice_;
    }

    function _pullLatestPrice() internal virtual override(FundingModule) {
        // No-op: Price is pushed by operator
    }
}
