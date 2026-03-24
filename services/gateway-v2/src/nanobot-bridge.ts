import EventEmitter from 'eventemitter3';
import { spawn, ChildProcess } from 'child_process';
import { v4 as uuid } from 'uuid';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  NanobotTaskConfig,
  NanobotTaskResult,
  NanobotTaskStatus,
  NanobotOutput,
} from '../../shared/nanobot.types.js';
interface BridgeEvents {
  'task:spawned': (taskId: string) => void;
  'task:completed': (result: NanobotTaskResult) => void;
  'task:failed': (taskId: string, error: string) => void;
  'task:escalation': (result: NanobotTaskResult) => void;
}

// Store writer injected by the gateway at startup — avoids circular import
type StoreWriter = (key: string, value: string) => void;

export class NanobotBridge extends EventEmitter<BridgeEvents> {
  private processes = new Map<string, ChildProcess>();
  readonly results = new Map<string, NanobotTaskResult>();
  private shuttingDown = false;
  private storeWrite: StoreWriter | null = null;

  constructor(storeWriter?: StoreWriter) {
    super();
    this.storeWrite = storeWriter || null;
    console.log('[NanobotBridge] Online');
  }

  private writeState(key: string, value: unknown): void {
    try {
      this.storeWrite?.(`nanobot:${key}`, JSON.stringify(value));
    } catch {}
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
    console.log(`[NanobotBridge] Spawning ${config.taskClass} (${taskId.substring(0, 8)})`);

    const env = this.buildTaskEnv(config);
    const configPath = this.buildNanobotConfig(config, taskId);

    const nanobotDir = resolve(new URL('.', import.meta.url).pathname, '../../nanobot-bridge');
    const proc = spawn('python3', [
      '-m', 'agents',
      '--config', configPath,
      '--task', config.taskClass,
      '--task-id', taskId,
      '--once',
    ], { env, cwd: nanobotDir, stdio: ['pipe', 'pipe', 'pipe'] });

    this.processes.set(taskId, proc);
    result.status = 'running';

    // Timeout enforcement
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      this.finalizeTask(taskId, 'timed_out', `Task exceeded ${config.timeoutMs}ms timeout`);
    }, config.timeoutMs);

    let stdout = '';
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
      this.handleTaskOutput(taskId, data.toString(), config);
    });

    proc.stderr?.on('data', (data) => {
      const line = data.toString().trim();
      if (line) console.log(`[Nanobot:${config.taskClass}] ${line}`);
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        this.finalizeTask(taskId, 'completed');
      } else {
        this.finalizeTask(taskId, 'failed', `Exit code ${code}`);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      this.finalizeTask(taskId, 'failed', `Spawn error: ${err.message}`);
    });

    return taskId;
  }

  private handleTaskOutput(
    taskId: string,
    raw: string,
    config: NanobotTaskConfig,
  ): void {
    try {
      const output: NanobotOutput = JSON.parse(raw);
      const result = this.results.get(taskId);
      if (!result) return;
      result.output = output;

      if (output.requiresEscalation) {
        this.emit('task:escalation', result);
        this.writeState('escalation', {
          taskId,
          taskClass: config.taskClass,
          output,
          authorityThreshold: config.authorityThreshold,
        });
        console.log(`[NanobotBridge] ESCALATION from ${config.taskClass}: ${output.escalationReason || output.summary}`);
      }
    } catch {
      // non-JSON stdout, ignore
    }
  }

  private finalizeTask(
    taskId: string,
    status: NanobotTaskStatus,
    error?: string,
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
      console.log(`[NanobotBridge] ${result.taskClass} completed (${result.durationMs}ms)`);
    } else {
      this.emit('task:failed', taskId, error || 'unknown');
      if (status !== 'timed_out') {
        console.log(`[NanobotBridge] ${result.taskClass} ${status}: ${error || 'unknown'}`);
      }
    }

    this.writeState('result:' + taskId, result);

    // Keep last 100 results, prune older
    if (this.results.size > 100) {
      const oldest = [...this.results.keys()].slice(0, this.results.size - 100);
      for (const k of oldest) this.results.delete(k);
    }
  }

  cancelTask(taskId: string): void {
    const proc = this.processes.get(taskId);
    if (proc) {
      proc.kill('SIGTERM');
      this.finalizeTask(taskId, 'failed', 'Cancelled by gateway');
    }
  }

  // ── Config Builders ─────────────────────────────────────────────────

  private buildNanobotConfig(config: NanobotTaskConfig, taskId: string): string {
    const configPath = `/tmp/nanobot-${taskId}.json`;
    const nanobotConfig = {
      providers: {
        [config.modelProvider]: {
          apiKey: process.env[`${config.modelProvider.toUpperCase()}_API_KEY`] || '',
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
    writeFileSync(configPath, JSON.stringify(nanobotConfig));
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

  // ── Lifecycle ───────────────────────────────────────────────────────

  getActiveTaskIds(): string[] {
    return [...this.processes.keys()];
  }

  stop(): void {
    this.shuttingDown = true;
    for (const [id, proc] of this.processes) {
      proc.kill('SIGTERM');
      this.finalizeTask(id, 'failed', 'Bridge shutting down');
    }
    console.log('[NanobotBridge] Stopped');
  }
}
