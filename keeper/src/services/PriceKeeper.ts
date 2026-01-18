import dotenv from 'dotenv';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { publicClient as externalPublicClient, walletClient as externalWalletClient } from '../client';
import { EXCHANGE_ADDRESS as ADDRESS } from '../config';

// ========== 核心方案：优先导入外部 ABI，失败则用内置兜底 ==========
let EXCHANGE_ABI: any = [];
try {
    // 尝试导入外部 ABI（保留你的原有逻辑）
    const { EXCHANGE_ABI: importedAbi } = require('../abi');
    EXCHANGE_ABI = importedAbi || [];
    console.log(`[PriceKeeper] 外部 ABI 导入结果:`, {
        length: EXCHANGE_ABI.length,
        isArray: Array.isArray(EXCHANGE_ABI)
    });

    // 如果外部 ABI 为空，自动使用内置兜底
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
    // 内置兜底 ABI（仅包含 updateIndexPrice 函数）
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

// 加载 .env 配置
dotenv.config();

export class PriceKeeper {
    private intervalId: NodeJS.Timeout | null = null;
    private isRunning = false;
    private readonly PYTH_ETH_ID = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';
    private readonly EXCHANGE_ADDRESS = process.env.EXCHANGE_ADDRESS || ADDRESS;
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

    constructor(private intervalMs: number = 10000) { } // 直接改为10秒一次

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        
        // 校验 ABI 是否包含目标函数
        const abiArray = Array.isArray(EXCHANGE_ABI) ? EXCHANGE_ABI : [];
        const hasUpdateFunction = abiArray.some(
            item => item?.type === 'function' && item?.name === 'updateIndexPrice'
        );
        
        console.log(`[PriceKeeper] 最终 ABI 状态:`, {
            length: abiArray.length,
            hasUpdateFunction,
            isArray: Array.isArray(EXCHANGE_ABI)
        });
        console.log(`[PriceKeeper] Starting price updates every ${this.intervalMs}ms...`);
        console.log(`[PriceKeeper] Using exchange address: ${this.EXCHANGE_ADDRESS}`);

        this.updatePrice();
        this.intervalId = setInterval(() => this.updatePrice(), this.intervalMs);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        console.log('[PriceKeeper] Stopped.');
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
                console.log(`[PriceKeeper] Fetched ETH price: $${Number(p) * Math.pow(10, expo)} -> ${priceWei} wei`);
            } catch (pythError) {
                console.warn('[PriceKeeper] Pyth fetch failed, using fallback price:', (pythError as Error).message);
                priceWei = BigInt(3300 * 10 ** 18);
                console.log(`[PriceKeeper] Using fallback price: $3300 -> ${priceWei} wei`);
            }

            // 最终校验（确保能调用合约）
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
                address: this.EXCHANGE_ADDRESS as `0x${string}`,
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