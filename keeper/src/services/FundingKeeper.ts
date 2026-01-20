import { EXCHANGE_ABI } from '../abi';
import { publicClient, walletClient } from '../client';
import { EXCHANGE_ADDRESS as ADDRESS } from '../config';

/**
 * FundingKeeper Service - 脚手架版本
 *
 * 这个服务负责定期调用合约的 settleFunding() 函数，
 * 触发全局资金费率结算。
 */
export class FundingKeeper {
    private intervalId: NodeJS.Timeout | null = null;
    private isRunning = false;

    // 新增：缓存合约地址（确保类型安全）
    private readonly contractAddress: `0x${string}` | undefined;

    constructor(private intervalMs: number = 60000) {
        // 初始化时校验地址格式
        this.contractAddress = this.validateAddress(ADDRESS);
    }

    /**
     * 验证并转换合约地址为类型安全的格式
     */
    private validateAddress(address: string | undefined): `0x${string}` | undefined {
        if (!address) {
            console.error('[FundingKeeper] EXCHANGE_ADDRESS is undefined!');
            return undefined;
        }
        // 确保地址以 0x 开头且长度正确
        const formattedAddress = address.startsWith('0x') ? address : `0x${address}`;
        if (!/^0x[a-fA-F0-9]{40}$/.test(formattedAddress)) {
            console.error(`[FundingKeeper] Invalid contract address: ${address}`);
            return undefined;
        }
        return formattedAddress as `0x${string}`;
    }

    start() {
        if (this.isRunning) return;
        
        // 前置校验：核心依赖必须存在
        if (!this.contractAddress) {
            console.error('[FundingKeeper] Cannot start - invalid contract address!');
            return;
        }
        if (!EXCHANGE_ABI || !Array.isArray(EXCHANGE_ABI)) {
            console.error('[FundingKeeper] Cannot start - invalid or undefined ABI!');
            return;
        }
        if (!publicClient || !walletClient) {
            console.error('[FundingKeeper] Cannot start - viem clients are undefined!');
            return;
        }

        this.isRunning = true;
        console.log(`[FundingKeeper] Starting funding settlement checks every ${this.intervalMs}ms...`);

        this.checkAndSettle();
        this.intervalId = setInterval(() => this.checkAndSettle(), this.intervalMs);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        console.log('[FundingKeeper] Stopped.');
    }

    /**
     * 检查并结算资金费率
     */
    private async checkAndSettle() {
        // 快速失败：核心依赖不存在则直接返回
        if (!this.contractAddress || !EXCHANGE_ABI || !publicClient || !walletClient) {
            console.warn('[FundingKeeper] Missing required dependencies - skip check');
            return;
        }

        try {
            // Step 1: 读取合约状态（添加类型断言和错误防护）
            const lastFundingTime = await publicClient.readContract({
                address: this.contractAddress,
                abi: EXCHANGE_ABI,
                functionName: 'lastFundingTime',
                args: [], // 显式传空数组，避免 undefined
            }) as bigint;

            const fundingInterval = await publicClient.readContract({
                address: this.contractAddress,
                abi: EXCHANGE_ABI,
                functionName: 'fundingInterval',
                args: [], // 显式传空数组
            }) as bigint;

            // Step 2: 判断是否需要结算
            const now = BigInt(Math.floor(Date.now() / 1000));
            const nextSettlementTime = lastFundingTime + fundingInterval;
            
            if (now < nextSettlementTime) {
                const timeLeft = Number(nextSettlementTime - now);
                console.log(`[FundingKeeper] Not yet time. Next settlement in ${timeLeft}s`);
                return;
            }

            // Step 3: 调用 settleFunding
            console.log('[FundingKeeper] Time to settle funding...');
            const hash = await walletClient.writeContract({
                address: this.contractAddress,
                abi: EXCHANGE_ABI,
                functionName: 'settleFunding',
                args: [], // 显式传空数组
            });
            
            // 等待交易确认
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            if (receipt.status === 'success') {
                console.log(`[FundingKeeper] Settlement tx succeeded: ${hash}`);
            } else {
                console.error(`[FundingKeeper] Settlement tx failed: ${hash}`);
            }

        } catch (e) {
            console.error('[FundingKeeper] Error:', e);
        }
    }
}