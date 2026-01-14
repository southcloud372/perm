import { walletClient, publicClient } from '../client';
import { EXCHANGE_ABI } from '../abi';
import { EXCHANGE_ADDRESS as ADDRESS } from '../config';

/**
 * FundingKeeper Service - 脚手架版本
 *
 * 这个服务负责定期调用合约的 settleFunding() 函数，
 * 触发全局资金费率结算。
 *
 * TODO: 学生需要实现以下功能：
 * 1. 定时检查是否到达 fundingInterval
 * 2. 调用合约的 settleFunding 函数
 */
export class FundingKeeper {
    private intervalId: NodeJS.Timeout | null = null;
    private isRunning = false;

    constructor(private intervalMs: number = 60000) { } // 默认每分钟检查一次

    start() {
        if (this.isRunning) return;
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
     *
     * TODO: 实现以下逻辑：
     * 1. 读取合约的 lastFundingTime 和 fundingInterval
     * 2. 判断当前时间是否超过 lastFundingTime + fundingInterval
     * 3. 如果是，调用 settleFunding()
     */
    private async checkAndSettle() {
        // TODO: 实现资金费率结算检查
    }
}
