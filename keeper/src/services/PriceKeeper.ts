import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { publicClient as externalPublicClient, walletClient as externalWalletClient } from '../client';
import { EXCHANGE_ADDRESS as ADDRESS } from '../config';

// ========== 核心功能：自动同步前端 .env.local 到 Keeper .env ==========
/**
 * 从前端 .env.local 读取 VITE_EXCHANGE_ADDRESS 并同步到 Keeper .env
 */
function syncExchangeAddressFromFrontend() {
    try {
        // ========== 修复：使用绝对路径（匹配你的实际目录结构） ==========
        // 前端 .env.local 绝对路径：/home/sa/perpm-course/frontend/.env.local
        const frontendEnvPath = path.resolve('/home/sa/perpm-course/frontend/.env.local');
        // Keeper .env 绝对路径：/home/sa/perpm-course/keeper/.env
        const keeperEnvPath = path.resolve('/home/sa/perpm-course/keeper/.env');

        // 2. 检查前端文件是否存在
        if (!fs.existsSync(frontendEnvPath)) {
            console.warn(`[PriceKeeper] 前端 .env.local 文件不存在: ${frontendEnvPath}`);
            console.warn(`[PriceKeeper] 请确认路径是否正确：/home/sa/perpm-course/frontend/.env.local`);
            return false;
        }

        // 3. 读取前端 .env.local 内容
        const frontendEnvContent = fs.readFileSync(frontendEnvPath, 'utf8');
        const viteAddressMatch = frontendEnvContent.match(/VITE_EXCHANGE_ADDRESS=(0x[a-fA-F0-9]{40})/);
        
        if (!viteAddressMatch || !viteAddressMatch[1]) {
            console.warn(`[PriceKeeper] 前端 .env.local 中未找到 VITE_EXCHANGE_ADDRESS`);
            console.warn(`[PriceKeeper] 当前 .env.local 内容:\n${frontendEnvContent}`);
            return false;
        }

        const frontendAddress = viteAddressMatch[1];
        console.log(`[PriceKeeper] ✅ 从前端读取到地址: ${frontendAddress}`);

        // 4. 读取/初始化 Keeper .env 文件
        let keeperEnvContent = '';
        if (fs.existsSync(keeperEnvPath)) {
            keeperEnvContent = fs.readFileSync(keeperEnvPath, 'utf8');
        }

        // 5. 替换/添加 EXCHANGE_ADDRESS 字段
        const exchangeAddressRegex = /EXCHANGE_ADDRESS=(.*)/;
        if (exchangeAddressRegex.test(keeperEnvContent)) {
            // 替换原有值
            keeperEnvContent = keeperEnvContent.replace(
                exchangeAddressRegex,
                `EXCHANGE_ADDRESS=${frontendAddress}`
            );
            console.log(`[PriceKeeper] ✅ 替换 Keeper .env 中原有地址`);
        } else {
            // 添加新值（保留原有内容）
            keeperEnvContent += `\nEXCHANGE_ADDRESS=${frontendAddress}\n`;
            console.log(`[PriceKeeper] ✅ 为 Keeper .env 添加新地址`);
        }

        // 6. 写入 Keeper .env 文件
        fs.writeFileSync(keeperEnvPath, keeperEnvContent, 'utf8');
        console.log(`[PriceKeeper] ✅ 已同步地址到 Keeper .env: ${frontendAddress}`);
        console.log(`[PriceKeeper] Keeper .env 路径: ${keeperEnvPath}`);
        
        return true;
    } catch (e) {
        console.error(`[PriceKeeper] ❌ 同步地址失败:`, (e as Error).message);
        return false;
    }
}

// ========== 第一步：先同步地址，再加载 .env ==========
// 1. 自动同步前端地址到 Keeper .env
syncExchangeAddressFromFrontend();

// 2. 加载 Keeper .env 配置（此时已包含同步后的地址）
dotenv.config();

// ========== ABI 加载逻辑（保留原有） ==========
let EXCHANGE_ABI: any = [];
try {
    const { EXCHANGE_ABI: importedAbi } = require('../abi');
    EXCHANGE_ABI = importedAbi || [];
    console.log(`[PriceKeeper] 外部 ABI 导入结果:`, {
        length: EXCHANGE_ABI.length,
        isArray: Array.isArray(EXCHANGE_ABI)
    });

    if (!Array.isArray(EXCHANGE_ABI) || EXCHANGE_ABI.length === 0) {
        console.warn('[PriceKeeper] 外部 ABI 为空，使用内置最小化 ABI 兜底');
        EXCHANGE_ABI = [
            {
                "type":"function",
                "name":"updateIndexPrice",
                "inputs":[{"name":"newIndexPrice","type":"uint256","internalType":"uint256"}],
                "outputs":[],
                "stateMutability":"nonpayable"
            }
        ];
    }
} catch (e) {
    console.warn('[PriceKeeper] 外部 ABI 导入失败，使用内置最小化 ABI:', (e as Error).message);
    EXCHANGE_ABI = [
        {
            "type":"function",
            "name":"updateIndexPrice",
            "inputs":[{"name":"newIndexPrice","type":"uint256","internalType":"uint256"}],
            "outputs":[],
            "stateMutability":"nonpayable"
        }
    ];
}

export class PriceKeeper {
    private intervalId: NodeJS.Timeout | null = null;
    private isRunning = false;
    private readonly PYTH_ETH_ID = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';
    
    // 优先使用同步后的 .env 地址
    private readonly EXCHANGE_ADDRESS = process.env.EXCHANGE_ADDRESS ? 
        (process.env.EXCHANGE_ADDRESS as `0x${string}`) : 
        (ADDRESS as `0x${string}`);
    
    private readonly operatorAccount = privateKeyToAccount(
        (process.env.OPERATOR_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as `0x${string}`
    );
    private readonly publicClient = externalPublicClient || createPublicClient({
        chain: foundry,
        transport: http(process.env.RPC_URL || 'http://127.0.0.1:8545'),
    });
    private readonly walletClient = externalWalletClient || createWalletClient({
        chain: foundry,
        transport: http(process.env.RPC_URL || 'http://127.0.0.1:8545'),
    });

    constructor(private intervalMs: number = 10000) { 
        this.validateEnvConfig();
    }

    // 配置校验（显示同步后的结果）
    private validateEnvConfig() {
        console.log(`[PriceKeeper] 📝 最终配置:`, {
            EXCHANGE_ADDRESS: this.EXCHANGE_ADDRESS,
            OPERATOR_PRIVATE_KEY: process.env.OPERATOR_PRIVATE_KEY ? '✅ 已配置' : '❌ 使用默认值',
            RPC_URL: process.env.RPC_URL || '❌ 使用默认值 (http://127.0.0.1:8545)'
        });

        if (!this.EXCHANGE_ADDRESS.startsWith('0x') || this.EXCHANGE_ADDRESS.length !== 42) {
            console.error(`[PriceKeeper] ⚠️  警告：交易所地址格式错误 -> ${this.EXCHANGE_ADDRESS}`);
        }
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        
        const abiArray = Array.isArray(EXCHANGE_ABI) ? EXCHANGE_ABI : [];
        const hasUpdateFunction = abiArray.some(
            item => item?.type === 'function' && item?.name === 'updateIndexPrice'
        );
        
        console.log(`[PriceKeeper] 📄 最终 ABI 状态:`, {
            length: abiArray.length,
            hasUpdateFunction,
            isArray: Array.isArray(EXCHANGE_ABI)
        });
        console.log(`[PriceKeeper] 🚀 Starting price updates every ${this.intervalMs}ms...`);
        console.log(`[PriceKeeper] 🔍 Using exchange address: ${this.EXCHANGE_ADDRESS}`);

        this.updatePrice();
        this.intervalId = setInterval(() => this.updatePrice(), this.intervalMs);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        console.log('[PriceKeeper] 🛑 Stopped.');
    }

    private async updatePrice() {
        try {
            let priceWei: bigint;

            // 获取 Pyth 价格（带超时）
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                
                const res = await fetch(
                    `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${this.PYTH_ETH_ID}`,
                    { signal: controller.signal }
                );
                clearTimeout(timeoutId);
                
                const data = await res.json();
                
                if (!data.parsed || !data.parsed[0]?.price) {
                    throw new Error('Pyth returned invalid data');
                }

                const priceInfo = data.parsed[0].price;
                const p = BigInt(priceInfo.price);
                const expo = priceInfo.expo;
                priceWei = p * (10n ** BigInt(18 + expo));
                console.log(`[PriceKeeper] 📈 Fetched ETH price: $${Number(p) * Math.pow(10, expo)} -> ${priceWei} wei`);
            } catch (pythError) {
                console.warn('[PriceKeeper] ⚠️  Pyth fetch failed, using fallback price:', (pythError as Error).message);
                priceWei = BigInt(3300 * 10 ** 18);
                console.log(`[PriceKeeper] 📉 Using fallback price: $3300 -> ${priceWei} wei`);
            }

            if (!this.EXCHANGE_ADDRESS) throw new Error('EXCHANGE_ADDRESS not defined');
            
            const abiArray = Array.isArray(EXCHANGE_ABI) ? EXCHANGE_ABI : [];
            const abiHasUpdateFunction = abiArray.some(
                item => item?.type === 'function' && item?.name === 'updateIndexPrice'
            );
            
            if (abiArray.length === 0 || !abiHasUpdateFunction) {
                throw new Error('EXCHANGE_ABI 无可用的 updateIndexPrice 函数');
            }

            // 调用合约更新价格
            const hash = await this.walletClient.writeContract({
                account: this.operatorAccount,
                address: this.EXCHANGE_ADDRESS,
                abi: EXCHANGE_ABI,
                functionName: 'updateIndexPrice',
                args: [priceWei]
            });
            
            await this.publicClient.waitForTransactionReceipt({ hash });
            console.log(`[PriceKeeper] ✅ Price updated on-chain, tx: ${hash.slice(0, 10)}...`);

        } catch (e) {
            console.error('[PriceKeeper] ❌ Error updating price:', (e as Error).message);
        }
    }
}

// 启动 Keeper
if (require.main === module) {
    const priceKeeper = new PriceKeeper(10000);
    priceKeeper.start();

    process.on('SIGINT', () => {
        priceKeeper.stop();
        process.exit(0);
    });
}