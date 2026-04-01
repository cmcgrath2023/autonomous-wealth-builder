# Nanobot Sub-Agent Integration Layer
## OpenClaw Architecture Integration Spec v1.0
### MTWM + Oceanic Platform

---

## Overview

This spec defines a modular Nanobot sub-agent integration layer that runs beneath the OpenClaw Gateway control plane. Nanobot instances operate as lightweight, ephemeral leaf-node executors — spawned for narrow autonomous tasks, reporting state back to OpenClaw via the existing WebSocket RPC bus on port 18789.

**Design principle:** OpenClaw owns authority, sessions, and orchestration. Nanobot owns execution of bounded, cron-schedulable, resource-light tasks. Neither replaces the other.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              OpenClaw Gateway :18789                │
│         (control plane / authority matrix)          │
└──────────────────┬──────────────────────────────────┘
                   │ WebSocket RPC
         ┌─────────▼──────────┐
         │  NanobotBridge     │  ← new service
         │  (EventEmitter3)   │
         │  port 3005         │
         └──┬──────┬──────┬───┘
            │      │      │
     ┌──────▼─┐ ┌──▼───┐ ┌▼────────┐
     │ Market │ │Twin  │ │Template │  ← Nanobot instances
     │Monitor │ │Check │ │Agent    │    (Python subprocesses)
     │ Agent  │ │Agent │ │ Runner  │
     └────────┘ └──────┘ └─────────┘
```

---

## Shared Types

`/services/shared/nanobot.types.ts`

```typescript
export type NanobotTaskClass =
  | 'market_monitor'
  | 'digital_twin_check'
  | 'template_agent'
  | 'compliance_audit'
  | 'briefing_generator'
  | 'reit_scan'
  | 'forex_alert';

export type NanobotAutonomyLevel = 'observe' | 'suggest' | 'act';

export type NanobotTaskStatus =
  | 'queued'
  | 'spawning'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out';

export interface NanobotTaskConfig {
  taskId: string;                        // uuid
  taskClass: NanobotTaskClass;
  autonomyLevel: NanobotAutonomyLevel;
  cronExpression?: string;               // if scheduled
  triggerOnce?: boolean;                 // if ephemeral
  timeoutMs: number;                     // max execution window
  memoryLimitMb: number;                 // K8s resource hint
  modelProvider: 'anthropic' | 'openai' | 'openrouter' | 'local';
  modelId: string;                       // e.g. 'claude-haiku-4-5-20251001'
  tools: NanobotToolPermission[];
  authorityThreshold: AuthorityThreshold;
  outputChannel: 'openclaw_rpc' | 'rvf_event' | 'stdout';
}

export interface NanobotToolPermission {
  tool: 'web_search' | 'web_fetch' | 'exec' | 'file_read' | 'file_write';
  sandboxed: boolean;
  allowlist?: string[];                  // URL or path patterns
}

export interface AuthorityThreshold {
  canExecuteTrades: boolean;
  maxNotionalUsd?: number;
  requiresApproval: boolean;
  approvalChannel?: string;             // openclaw agent id to approve
}

export interface NanobotTaskResult {
  taskId: string;
  taskClass: NanobotTaskClass;
  status: NanobotTaskStatus;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  output?: NanobotOutput;
  error?: string;
  linesExecuted?: number;              // audit: lines of agent code executed
}

export interface NanobotOutput {
  summary: string;
  data?: Record<string, unknown>;
  suggestedActions?: SuggestedAction[];
  requiresEscalation: boolean;
  escalationReason?: string;
}

export interface SuggestedAction {
  action: string;
  asset?: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  autonomyRequired: NanobotAutonomyLevel;
}
```

---

## NanobotBridge Service

`/services/nanobot-bridge/NanobotBridge.ts`

```typescript
import EventEmitter from 'eventemitter3';
import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import {
  NanobotTaskConfig,
  NanobotTaskResult,
  NanobotTaskStatus,
} from '../shared/nanobot.types';

interface BridgeEvents {
  'task:spawned': (taskId: string) => void;
  'task:completed': (result: NanobotTaskResult) => void;
  'task:failed': (taskId: string, error: string) => void;
  'task:escalation': (result: NanobotTaskResult) => void;
  'gateway:connected': () => void;
  'gateway:disconnected': () => void;
}

export class NanobotBridge extends EventEmitter<BridgeEvents> {
  private processes: Map<string, ChildProcess> = new Map();
  private results: Map<string, NanobotTaskResult> = new Map();
  private gatewayWs: WebSocket | null = null;
  private readonly GATEWAY_URL = 'ws://127.0.0.1:18789';

  constructor() {
    super();
    this.connectToGateway();
  }

  // ── Gateway Connection ──────────────────────────────────────────────

  private connectToGateway(): void {
    this.gatewayWs = new WebSocket(this.GATEWAY_URL);

    this.gatewayWs.on('open', () => {
      this.emit('gateway:connected');
      this.registerWithGateway();
    });

    this.gatewayWs.on('close', () => {
      this.emit('gateway:disconnected');
      setTimeout(() => this.connectToGateway(), 5000); // reconnect
    });

    this.gatewayWs.on('message', (raw) => {
      this.handleGatewayMessage(JSON.parse(raw.toString()));
    });
  }

  private registerWithGateway(): void {
    this.sendToGateway({
      type: 'agent:register',
      agentId: 'nanobot-bridge',
      capabilities: ['sub_agent_spawn', 'cron_task', 'market_monitor'],
      autonomyLevel: 'suggest',
    });
  }

  private sendToGateway(payload: Record<string, unknown>): void {
    if (this.gatewayWs?.readyState === WebSocket.OPEN) {
      this.gatewayWs.send(JSON.stringify(payload));
    }
  }

  private handleGatewayMessage(msg: Record<string, unknown>): void {
    if (msg.type === 'task:dispatch') {
      const config = msg.config as NanobotTaskConfig;
      this.spawnTask(config);
    }
    if (msg.type === 'task:cancel') {
      this.cancelTask(msg.taskId as string);
    }
  }

  // ── Task Lifecycle ──────────────────────────────────────────────────

  async spawnTask(config: NanobotTaskConfig): Promise<string> {
    const taskId = config.taskId || uuid();

    const result: NanobotTaskResult = {
      taskId,
      taskClass: config.taskClass,
      status: 'spawning',
      startedAt: Date.now(),
    };

    this.results.set(taskId, result);
    this.emit('task:spawned', taskId);

    const env = this.buildTaskEnv(config);

    const proc = spawn('python', [
      '-m', 'nanobot',
      '--config', this.buildNanobotConfig(config),
      '--task', config.taskClass,
      '--task-id', taskId,
      '--once',  // triggerOnce mode
    ], { env, stdio: ['pipe', 'pipe', 'pipe'] });

    this.processes.set(taskId, proc);
    result.status = 'running';

    // Timeout enforcement
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      this.finalizeTask(taskId, 'timed_out', 'Task exceeded timeoutMs');
    }, config.timeoutMs);

    proc.stdout?.on('data', (data) => {
      this.handleTaskOutput(taskId, data.toString(), config);
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        this.finalizeTask(taskId, 'completed');
      } else {
        this.finalizeTask(taskId, 'failed', `Exit code ${code}`);
      }
    });

    return taskId;
  }

  private handleTaskOutput(
    taskId: string,
    raw: string,
    config: NanobotTaskConfig
  ): void {
    try {
      const output = JSON.parse(raw);
      const result = this.results.get(taskId)!;
      result.output = output;

      // Authority check before escalating suggested actions
      if (output.requiresEscalation) {
        this.emit('task:escalation', result);
        this.sendToGateway({
          type: 'task:escalation',
          taskId,
          taskClass: config.taskClass,
          output,
          authorityThreshold: config.authorityThreshold,
        });
      }
    } catch {
      // non-JSON stdout, ignore
    }
  }

  private finalizeTask(
    taskId: string,
    status: NanobotTaskStatus,
    error?: string
  ): void {
    const result = this.results.get(taskId);
    if (!result) return;

    result.status = status;
    result.completedAt = Date.now();
    result.durationMs = result.completedAt - result.startedAt;
    if (error) result.error = error;

    this.processes.delete(taskId);

    if (status === 'completed') {
      this.emit('task:completed', result);
    } else {
      this.emit('task:failed', taskId, error || 'unknown');
    }

    // Report back to Gateway
    this.sendToGateway({ type: 'task:result', result });
  }

  cancelTask(taskId: string): void {
    const proc = this.processes.get(taskId);
    proc?.kill('SIGTERM');
    this.finalizeTask(taskId, 'failed', 'Cancelled by gateway');
  }

  // ── Config Builders ─────────────────────────────────────────────────

  private buildNanobotConfig(config: NanobotTaskConfig): string {
    // Writes a temp config JSON file for the Nanobot subprocess
    // Returns the path — implementation writes to /tmp/nanobot-{taskId}.json
    const configPath = `/tmp/nanobot-${config.taskId}.json`;
    const nanobotConfig = {
      providers: {
        [config.modelProvider]: {
          apiKey: process.env[`${config.modelProvider.toUpperCase()}_API_KEY`],
        },
      },
      agents: {
        defaults: {
          model: config.modelId,
          provider: config.modelProvider,
        },
      },
      tools: config.tools.reduce((acc, t) => {
        acc[t.tool] = { enabled: true, sandboxed: t.sandboxed };
        return acc;
      }, {} as Record<string, unknown>),
    };
    require('fs').writeFileSync(configPath, JSON.stringify(nanobotConfig));
    return configPath;
  }

  private buildTaskEnv(config: NanobotTaskConfig): NodeJS.ProcessEnv {
    return {
      ...process.env,
      NANOBOT_TASK_CLASS: config.taskClass,
      NANOBOT_TASK_ID: config.taskId,
      NANOBOT_AUTONOMY_LEVEL: config.autonomyLevel,
      NANOBOT_OUTPUT_CHANNEL: config.outputChannel,
      NANOBOT_MEMORY_LIMIT_MB: String(config.memoryLimitMb),
    };
  }
}
```

---

## Cron Scheduler

`/services/nanobot-bridge/NanobotScheduler.ts`

```typescript
import cron from 'node-cron';
import { v4 as uuid } from 'uuid';
import { NanobotBridge } from './NanobotBridge';
import { NanobotTaskConfig } from '../shared/nanobot.types';

// Pre-defined scheduled tasks mapped to MTWM revenue modules
export const SCHEDULED_TASKS: Omit<NanobotTaskConfig, 'taskId'>[] = [
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

  constructor(private bridge: NanobotBridge) {}

  start(): void {
    for (const taskConfig of SCHEDULED_TASKS) {
      if (!taskConfig.cronExpression) continue;

      const job = cron.schedule(taskConfig.cronExpression, async () => {
        const config: NanobotTaskConfig = {
          ...taskConfig,
          taskId: uuid(),
        };
        await this.bridge.spawnTask(config);
      });

      this.jobs.push(job);
    }

    console.log(`[NanobotScheduler] ${this.jobs.length} tasks scheduled`);
  }

  stop(): void {
    this.jobs.forEach((j) => j.stop());
  }
}
```

---

## Gateway REST Routes

`/gateway/routes/nanobot.routes.ts`

```typescript
import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { NanobotBridge } from '../../services/nanobot-bridge/NanobotBridge';
import { NanobotTaskConfig } from '../../services/shared/nanobot.types';

export function nanobotRoutes(bridge: NanobotBridge): Router {
  const router = Router();

  // Spawn a one-off task
  router.post('/nanobot/task', async (req: Request, res: Response) => {
    const config: NanobotTaskConfig = {
      ...req.body,
      taskId: uuid(),
      triggerOnce: true,
    };

    try {
      const taskId = await bridge.spawnTask(config);
      res.json({ taskId, status: 'spawning' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Get task result
  router.get('/nanobot/task/:taskId', (req: Request, res: Response) => {
    const result = (bridge as any).results.get(req.params.taskId);
    if (!result) return res.status(404).json({ error: 'Task not found' });
    res.json(result);
  });

  // Cancel a running task
  router.delete('/nanobot/task/:taskId', (req: Request, res: Response) => {
    bridge.cancelTask(req.params.taskId);
    res.json({ cancelled: true });
  });

  // List active tasks
  router.get('/nanobot/tasks', (_req: Request, res: Response) => {
    const active = [...(bridge as any).processes.keys()];
    res.json({ active, count: active.length });
  });

  return router;
}
```

---

## OpenClaw Agent Registration

`/agents/nanobot-bridge.agent.yaml` (JSON5 config fragment)

```yaml
agentId: nanobot-bridge
displayName: Nanobot Sub-Agent Bridge
description: >
  Spawns and manages lightweight Nanobot Python sub-agents for narrow
  autonomous tasks. Reports results back to the OpenClaw Gateway.
  Does not execute trades — escalates suggested actions for authority review.

autonomyLevel: suggest

capabilities:
  - sub_agent_spawn
  - cron_task_management
  - market_monitor
  - forex_alert
  - digital_twin_check
  - briefing_generator

authorityMatrix:
  canExecuteTrades: false
  requiresApproval: true
  approvalAgents:
    - mtwm-openclaw-agent
    - openclaw-authority-gateway

tools:
  - name: spawn_nanobot_task
    endpoint: POST /nanobot/task
    sandboxed: true
  - name: cancel_nanobot_task
    endpoint: DELETE /nanobot/task/:taskId
    sandboxed: false

channels:
  - type: websocket_rpc
    host: 127.0.0.1
    port: 18789

heartbeat:
  enabled: true
  intervalMinutes: 5
  checkFile: NANOBOT_HEARTBEAT.md
```

---

## ruflow Build Phases

`/ruflow/nanobot-bridge.ruflow.yaml`

```yaml
name: nanobot-bridge
version: 1.0.0
description: Nanobot sub-agent integration layer for OpenClaw/MTWM

phases:

  - id: phase-1-shared-types
    name: Shared Types
    tasks:
      - create /services/shared/nanobot.types.ts
      - verify all NanobotTaskConfig fields compile
      - verify AuthorityThreshold enforces canExecuteTrades=false for Nanobot agents
    acceptance_criteria:
      - tsc --noEmit passes on nanobot.types.ts with zero errors
      - NanobotAutonomyLevel type is imported cleanly by NanobotBridge
      - NanobotTaskClass union covers all 7 planned task classes

  - id: phase-2-bridge-service
    name: NanobotBridge Service
    depends_on: [phase-1-shared-types]
    tasks:
      - implement NanobotBridge extending EventEmitter3
      - implement connectToGateway() with 5s reconnect backoff
      - implement spawnTask() spawning Python subprocess
      - implement timeout enforcement via clearTimeout pattern
      - implement handleTaskOutput() with authority escalation check
      - implement finalizeTask() reporting to Gateway WS
    acceptance_criteria:
      - NanobotBridge connects to ws://127.0.0.1:18789 on init
      - spawnTask() returns taskId within 500ms
      - task:completed event fires on subprocess exit code 0
      - task:failed event fires on non-zero exit or timeout
      - task:escalation event fires when output.requiresEscalation=true
      - Gateway receives task:result payload on every task completion
      - No task runs beyond its configured timeoutMs

  - id: phase-3-scheduler
    name: Cron Scheduler
    depends_on: [phase-2-bridge-service]
    tasks:
      - implement NanobotScheduler with node-cron
      - wire all 4 SCHEDULED_TASKS
      - verify market_monitor fires every 5 min
      - verify briefing_generator fires at 07:00 daily
    acceptance_criteria:
      - NanobotScheduler.start() registers exactly 4 cron jobs
      - Each job spawns a task with unique taskId (uuid)
      - market_monitor uses claude-haiku-4-5-20251001 (cost control)
      - briefing_generator uses claude-sonnet-4-6
      - All tasks have canExecuteTrades: false

  - id: phase-4-rest-routes
    name: Gateway REST Routes
    depends_on: [phase-2-bridge-service]
    tasks:
      - implement POST /nanobot/task
      - implement GET /nanobot/task/:taskId
      - implement DELETE /nanobot/task/:taskId
      - implement GET /nanobot/tasks
      - mount router on existing Express app port 3001
    acceptance_criteria:
      - POST /nanobot/task returns {taskId, status:'spawning'} within 200ms
      - GET /nanobot/task/:taskId returns full NanobotTaskResult
      - DELETE /nanobot/task/:taskId sends SIGTERM to subprocess
      - GET /nanobot/tasks returns array of active taskIds
      - All routes return 500 with {error} on exception, never crash

  - id: phase-5-agent-registration
    name: OpenClaw Agent Registration
    depends_on: [phase-4-rest-routes]
    tasks:
      - create nanobot-bridge.agent.yaml
      - register with OpenClaw Gateway via agent:register RPC
      - verify agent appears in Gateway agent list
      - verify authority matrix blocks canExecuteTrades at bridge level
    acceptance_criteria:
      - nanobot-bridge agent appears in openclaw agents list
      - Gateway routes task:dispatch messages to NanobotBridge handler
      - Authority check rejects any task config with canExecuteTrades=true
      - Escalation events appear in mtwm-openclaw-agent approval queue

  - id: phase-6-k8s-deployment
    name: DigitalOcean K8s Deployment
    depends_on: [phase-5-agent-registration]
    tasks:
      - containerize NanobotBridge as Node.js service
      - define K8s Deployment with memoryLimitMb per pod
      - configure horizontal pod autoscaler for App Builder template agents
      - set resource requests: 64Mi-256Mi per Nanobot subprocess
    acceptance_criteria:
      - NanobotBridge pod starts and connects to Gateway WS within 30s
      - HPA scales template_agent pods 1-10 based on task queue depth
      - Pod memory never exceeds configured memoryLimitMb + 20% overhead
      - Crashed Nanobot subprocesses do not crash the Bridge pod
```

---

## Key Design Decisions

**1. Authority always lives in OpenClaw, never Nanobot**
All Nanobot tasks run with `canExecuteTrades: false` at the bridge level. Trade execution escalates to `mtwm-openclaw-agent` for Authority Matrix evaluation. Nanobot cannot unilaterally act — it can only suggest.

**2. Model selection by task cost profile**
Monitoring and alert tasks use `claude-haiku-4-5-20251001` — fast and cheap. Briefing generation and complex analysis escalate to `claude-sonnet-4-6`. MTWM execution decisions remain with the full OpenClaw agent using the primary model.

**3. Python subprocess isolation**
Each Nanobot task runs as a separate Python subprocess. A misbehaving task cannot corrupt Bridge state or block the Gateway connection. Timeout enforcement is at the Bridge level, not Nanobot's internal loop.

**4. Config-per-task pattern**
Each subprocess gets its own temp config JSON written at spawn time, scoped to exactly the tools and providers it needs. No shared config files between concurrent tasks.

**5. RVF packaging target**
Each NanobotTaskClass maps cleanly to a distinct RVF Cognitive Container — small blast radius, easy attestation, clear capability boundary per container.
