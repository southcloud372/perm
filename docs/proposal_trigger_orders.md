# 方案八：高级条件委托 (Stop-Loss / Take-Profit)

## 目标描述
**难度等级：高 (Full Stack & Keeper System)**。
CEX（中心化交易所）最核心的功能之一是 **止盈止损 (Take-Profit / Stop-Loss)** 和 **计划委托 (Trigger Orders)**。
但在去中心化交易所（DEX）及其难实现：因为智能合约是“被动”的，它无法自动监控价格并执行操作。
我们需要构建一套**“链上委托 + 链下触发”**的系统。用户将“触发条件”写在链上，而链下的 Keeper 机器人网络实时监控价格，一旦满足条件（例如价格跌破 2000），立刻发送交易触发合约执行平仓。

这涉及到了**预言机喂价**、**任务调度**、**Keeper 激励机制**以及**防抢跑设计**。

## 核心技术点
1.  **条件注册表**: 使用 `mapping` 存储用户的条件单（例如：`TriggerPrice`, `Direction`, `Size`）。
2.  **Keeper 激励**: 谁来执行这个单子？必须给执行者（Keeper）发工资（ETH）。交易中必须包含“执行费”。
3.  **价格验证**: 合约在执行时必须再次检查 Oracle 价格，防止 Keeper 恶意提前/延后执行。
4.  **原子化执行**: 触发 -> 检查条件 -> 市价平仓 -> 发放奖励。

## 建议更改

### 合约 (Contract)
#### [NEW] [TriggerOrderModule.sol](contract/src/modules/TriggerOrderModule.sol)
- **结构体**: `struct TriggerOrder { address user; uint256 triggerPrice; bool isStopLoss; ... }`
- **函数**:
    - `placeTriggerOrder(...)`: 用户预先存储一个平仓条件，并质押少量 ETH 作为未来的执行费。
    - `executeTriggerOrder(uint256 orderId)`: **核心函数**。
        - 供 Keeper 调用。
        - 检查 Oracle 价格是否确实触达 `triggerPrice`。
        - 如果满足：调用 `OrderBookModule.placeOrder` 执行市价平仓。
        - 将用户预存的 ETH 奖励发送给 `msg.sender` (Keeper)。

#### [MODIFY] [Exchange.sol](contract/src/Exchange.sol)
- 继承 `TriggerOrderModule`。

### 机器人 (Keeper)
#### [NEW] [TriggerKeeper.ts](keeper/src/services/TriggerKeeper.ts)
- 扩展现有的 Keeper 系统。
- **轮询逻辑**: 每秒查询链上所有活跃的 TriggerOrder。
- **判断逻辑**: 对比当前 Pyth/Chainlink 价格。
- **执行逻辑**: 发现 `LastPrice <= StopPrice`，立即发送交易调用 `executeTriggerOrder`，赚取执行费。

### 前端 (Frontend)
#### [MODIFY] [OrderForm.tsx](frontend/components/OrderForm.tsx)
- 增加“高级设置”：TP/SL 输入框。
- 当用户开仓时，同时发送 `placeTriggerOrder` 交易。

## 难点解析
1.  **执行的确定性**: 价格瞬息万变，可能 Keeper 看到满足了，发交易上链时价格又回去了。
2.  **Gas 费估算**: 用户该预存多少 ETH？这需要动态估算 GasPrice。
3.  **并发竞争**: 多个 Keeper 同时看到机会，谁能抢到？（通常 Gas War，或者引入 Chainlink Automation 注册）。

## 验证计划
1.  **场景**: Alice 开多 @ 2000，设置止损 @ 1900。
2.  **等待**: 此时价格为 1950，什么都不发生。
3.  **触发**: 模拟预言机价格跌到 1899。
4.  **执行**:
    - 本地 Keeper 脚本检测到条件满足。
    - 发送 `executeTriggerOrder`。
    - Alice 被平仓，Keeper 收到 0.01 ETH 奖励。
