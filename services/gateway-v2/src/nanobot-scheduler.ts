import cron from 'node-cron';
import { v4 as uuid } from 'uuid';
import { NanobotBridge } from './nanobot-bridge.js';
import type { NanobotTaskConfig } from '../../shared/nanobot.types.js';

type PartialConfig = Omit<NanobotTaskConfig, 'taskId'>;

// Pre-defined scheduled tasks mapped to MTWM revenue modules
const SCHEDULED_TASKS: PartialConfig[] = [
  {
    taskClass: 'market_monitor',
    autonomyLevel: 'suggest',
    cronExpression: '*/5 * * * *',       // every 5 min
    timeoutMs: 60_000,
    memoryLimitMb: 128,
    modelProvider: 'anthropic',
    modelId: 'claude-haiku-4-5-20251001', // cheap + fast for monitoring
    tools: [
      { tool: 'web_fetch', sandboxed: true, allowlist: ['finance.yahoo.com', 'api.alpaca.markets'] },
    ],
    authorityThreshold: {
      canExecuteTrades: false,
      requiresApproval: true,
      approvalChannel: 'mtwm-openclaw-agent',
    },
    outputChannel: 'openclaw_rpc',
  },
  {
    taskClass: 'forex_alert',
    autonomyLevel: 'suggest',
    cronExpression: '*/15 * * * *',      // every 15 min
    timeoutMs: 45_000,
    memoryLimitMb: 64,
    modelProvider: 'anthropic',
    modelId: 'claude-haiku-4-5-20251001',
    tools: [
      { tool: 'web_fetch', sandboxed: true, allowlist: ['api.exchangerate.host'] },
    ],
    authorityThreshold: {
      canExecuteTrades: false,
      requiresApproval: true,
      approvalChannel: 'mtwm-openclaw-agent',
    },
    outputChannel: 'openclaw_rpc',
  },
  {
    taskClass: 'digital_twin_check',
    autonomyLevel: 'observe',
    cronExpression: '0 * * * *',         // hourly
    timeoutMs: 120_000,
    memoryLimitMb: 128,
    modelProvider: 'anthropic',
    modelId: 'claude-haiku-4-5-20251001',
    tools: [
      { tool: 'web_fetch', sandboxed: true },
    ],
    authorityThreshold: {
      canExecuteTrades: false,
      requiresApproval: false,
    },
    outputChannel: 'openclaw_rpc',
  },
  {
    taskClass: 'trade_advisor',
    autonomyLevel: 'act',
    cronExpression: '*/10 * * * 1-5',     // every 10 min weekdays
    timeoutMs: 90_000,
    memoryLimitMb: 256,
    modelProvider: 'anthropic',
    modelId: 'claude-haiku-4-5-20251001',
    tools: [
      { tool: 'web_fetch', sandboxed: true, allowlist: ['finance.yahoo.com', 'api.alpaca.markets', 'data.alpaca.markets'] },
    ],
    authorityThreshold: {
      canExecuteTrades: false,     // writes stars, doesn't place orders directly
      requiresApproval: false,
      approvalChannel: 'mtwm-openclaw-agent',
    },
    outputChannel: 'openclaw_rpc',
  },
  {
    taskClass: 'briefing_generator',
    autonomyLevel: 'observe',
    cronExpression: '0 7 * * *',         // daily 7am
    timeoutMs: 180_000,
    memoryLimitMb: 256,
    modelProvider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    tools: [
      { tool: 'web_search', sandboxed: true },
      { tool: 'web_fetch', sandboxed: true },
    ],
    authorityThreshold: {
      canExecuteTrades: false,
      requiresApproval: false,
    },
    outputChannel: 'openclaw_rpc',
  },
];

export class NanobotScheduler {
  private jobs: cron.ScheduledTask[] = [];
  private bridge: NanobotBridge;

  constructor(bridge: NanobotBridge) {
    this.bridge = bridge;
  }

  start(): void {
    for (const taskConfig of SCHEDULED_TASKS) {
      if (!taskConfig.cronExpression) continue;

      const job = cron.schedule(taskConfig.cronExpression, async () => {
        const config: NanobotTaskConfig = {
          ...taskConfig,
          taskId: uuid(),
        };
        try {
          await this.bridge.spawnTask(config);
        } catch (e: any) {
          console.error(`[NanobotScheduler] Failed to spawn ${taskConfig.taskClass}: ${e.message}`);
        }
      });

      this.jobs.push(job);
    }

    console.log(`[NanobotScheduler] ${this.jobs.length} tasks scheduled (market_monitor:5m, forex_alert:15m, twin_check:1h, briefing:7am)`);
  }

  stop(): void {
    this.jobs.forEach((j) => j.stop());
    this.jobs = [];
    console.log('[NanobotScheduler] Stopped');
  }
}
