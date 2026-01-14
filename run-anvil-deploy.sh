#!/usr/bin/env bash
# 一键启动 anvil、部署合约，最后把 anvil 留在前台（Ctrl+C 关闭）。
# 适配：WSL/Linux 原生环境（移除 Git Bash 兼容代码，优化 Linux 命令）
set -euo pipefail

# 确保脚本执行出错时立即退出，且变量未定义时也报错
set -o errexit
set -o nounset
set -o pipefail

# 定义根目录（兼容 Linux 路径解析）
ROOT_DIR="/home/sa/perpm-course"
CONTRACT_DIR="$ROOT_DIR/contract"

# 默认参数（可根据需要修改）
RPC_URL="http://127.0.0.1:8545"
CHAIN_ID="31337"
PORT="8545"
LOG_FILE="$ROOT_DIR/output/logs/anvil.log"

# anvil 默认私钥（账户 #0）
DEFAULT_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
# 前端用于本地签名的测试私钥（助记词索引 #1）
TEST_PRIVATE_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"

# 部署脚本参数
USE_MOCK_PYTH="true"
MOCK_PRICE="2000"
MOCK_EXPO="0"

# 生成临时部署私钥（避免 nonce 冲突）
echo "生成临时部署私钥..."
PRIVATE_KEY=$(cast wallet new | grep -i "Private Key" | awk '{print $3}')
# 兜底：如果生成失败，使用默认私钥
if [[ -z "$PRIVATE_KEY" ]]; then
  PRIVATE_KEY="$DEFAULT_PRIVATE_KEY"
  echo "临时私钥生成失败，使用默认私钥: $PRIVATE_KEY"
else
  echo "生成的临时部署私钥: $PRIVATE_KEY"
fi

# ======== 修复：Linux 原生端口查杀（替换 fuser 为更通用的 ss + kill）=======
# 简化版端口/进程清理（WSL 兼容）
echo "清理占用 $PORT 端口的进程..."
# 用 lsof 查杀端口（更稳定）
sudo lsof -ti:"$PORT" | xargs kill -9 >/dev/null 2>&1 || true
# 强制查杀 anvil 进程
pkill -9 anvil >/dev/null 2>&1 || true
sleep 1  # 缩短等待时间，避免卡壳

# 启动 anvil 并输出日志
echo "启动 anvil (chain-id=$CHAIN_ID, port=$PORT)..."
mkdir -p "$ROOT_DIR/output/logs"
# 清空日志文件
> "$LOG_FILE"
# Linux 原生启动 anvil（绑定所有地址，支持 WSL 访问）
anvil --host 0.0.0.0 --chain-id "$CHAIN_ID" --port "$PORT" --block-time 1 >> "$LOG_FILE" 2>&1 &
ANVIL_PID=$!
echo "anvil 进程ID: $ANVIL_PID (日志文件: $LOG_FILE)"

# 退出时清理 anvil 进程
cleanup() {
  if ps -p "$ANVIL_PID" >/dev/null 2>&1; then
    echo -e "\n停止 anvil 进程 ($ANVIL_PID)..."
    kill "$ANVIL_PID" >/dev/null 2>&1 || true
    wait "$ANVIL_PID" 2>/dev/null || true
  fi
  echo "脚本执行完成，已清理资源"
}
# 捕获 Ctrl+C、脚本退出等信号
trap cleanup EXIT INT TERM

# 等待 anvil 就绪（最多等待 9 秒）
echo "等待 anvil 节点就绪..."
READY=false
for _ in {1..30}; do
  if cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1; then
    READY=true
    break
  fi
  # 检查 anvil 进程是否存活
  if ! ps -p "$ANVIL_PID" >/dev/null 2>&1; then
    echo "错误：anvil 进程意外退出！"
    echo "日志最后 20 行："
    tail -n 20 "$LOG_FILE"
    exit 1
  fi
  sleep 0.3
done

# 最终检查 anvil 是否就绪
if [[ "$READY" != "true" ]]; then
  echo "错误：anvil 节点启动超时！"
  echo "日志最后 20 行："
  tail -n 20 "$LOG_FILE"
  exit 1
fi

# 给临时部署账户转 ETH（使用 anvil 内置账户 #2）
echo "给部署账户转 ETH..."
DEPLOYER_ADDRESS=$(cast wallet address --private-key "$PRIVATE_KEY")
FUNDING_KEY="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
# 转 10 ETH 给部署账户（设置足够的 gas 确保交易成功）
cast send "$DEPLOYER_ADDRESS" \
  --value 10ether \
  --private-key "$FUNDING_KEY" \
  --rpc-url "$RPC_URL" \
  --gas-limit 21000 \
  --gas-price 20000000000 >/dev/null 2>&1

# 部署合约
echo "开始部署合约 (USE_MOCK_PYTH=$USE_MOCK_PYTH, MOCK_PRICE=$MOCK_PRICE, MOCK_EXPO=$MOCK_EXPO)..."
cd "$CONTRACT_DIR" || exit 1
# 清理旧的部署缓存和广播文件
rm -rf broadcast/ cache/ || true
forge clean
# 执行部署脚本（Linux 原生环境变量传递）
USE_MOCK_PYTH="$USE_MOCK_PYTH" \
MOCK_PRICE="$MOCK_PRICE" \
MOCK_EXPO="$MOCK_EXPO" \
PRIVATE_KEY="$PRIVATE_KEY" \
forge script script/DeployExchange.s.sol:DeployExchangeScript \
  --broadcast \
  --rpc-url "$RPC_URL" \
  --legacy \
  --slow || {
    echo "合约部署失败！"
    exit 1
  }

# 生成前端环境变量和 ABI
if command -v jq >/dev/null 2>&1; then
  BROADCAST_FILE="$CONTRACT_DIR/broadcast/DeployExchange.s.sol/$CHAIN_ID/run-latest.json"
  if [[ -f "$BROADCAST_FILE" ]]; then
    # 提取合约地址
    EXCHANGE_ADDR=$(jq -r '.transactions[] | select(.contractName=="MonadPerpExchange") | .contractAddress' "$BROADCAST_FILE" | tail -n 1)
    # 提取部署区块号（十六进制转十进制）
    BLOCK_HEX=$(jq -r --arg addr "$EXCHANGE_ADDR" '.receipts[] | select(.contractAddress==$addr) | .blockNumber' "$BROADCAST_FILE" | tail -n 1)
    BLOCK_DEC=$((16#${BLOCK_HEX#0x}))

    # 写入前端 .env.local 文件
    FRONTEND_ENV="$ROOT_DIR/frontend/.env.local"
    cat > "$FRONTEND_ENV" <<EOF
VITE_RPC_URL=$RPC_URL
VITE_CHAIN_ID=$CHAIN_ID
VITE_EXCHANGE_ADDRESS=$EXCHANGE_ADDR
VITE_EXCHANGE_DEPLOY_BLOCK=$BLOCK_DEC
VITE_TEST_PRIVATE_KEY=$TEST_PRIVATE_KEY
EOF
    echo "已写入前端环境文件: $FRONTEND_ENV"
    echo "合约地址: $EXCHANGE_ADDR，部署区块: $BLOCK_DEC"

    # 给 Alice 授权 OPERATOR_ROLE
    echo "给 Alice 授权 OPERATOR_ROLE..."
    ALICE_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    cast send "$EXCHANGE_ADDR" \
      "setOperator(address)" "$ALICE_ADDRESS" \
      --private-key "$PRIVATE_KEY" \
      --rpc-url "$RPC_URL" >/dev/null 2>&1

    # 生成前端 ABI 文件（TS 格式）
    ABI_SOURCE="$CONTRACT_DIR/out/Exchange.sol/MonadPerpExchange.json"
    ABI_DEST_TS="$ROOT_DIR/frontend/onchain/ExchangeABI.ts"
    if [[ -f "$ABI_SOURCE" ]]; then
      mkdir -p "$(dirname "$ABI_DEST_TS")" || true
      printf "export const EXCHANGE_ABI = %s as const;\n" "$(jq -c '.abi' "$ABI_SOURCE")" > "$ABI_DEST_TS"
      echo "已生成合约 ABI 到: $ABI_DEST_TS"
    fi

    # 更新索引器配置文件
    INDEXER_CONFIG="$ROOT_DIR/indexer/config.yaml"
    if [[ -f "$INDEXER_CONFIG" ]]; then
      # Linux 原生 sed 命令（无需空参数）
      sed -i "s/0x[a-fA-F0-9]\{40\}/$EXCHANGE_ADDR/g" "$INDEXER_CONFIG"
      echo "已更新索引器配置文件: $INDEXER_CONFIG"
    else
      echo "未找到索引器配置文件: $INDEXER_CONFIG，跳过更新"
    fi
  else
    echo "未找到部署广播文件: $BROADCAST_FILE，跳过前端配置"
  fi
else
  echo "未安装 jq 工具，跳过前端配置自动生成（执行: sudo apt install jq 安装）"
fi

echo -e "\n✅ 部署完成！anvil 节点将持续运行，按 Ctrl+C 停止。"
# 等待 anvil 进程（保持前台运行）
wait "$ANVIL_PID"