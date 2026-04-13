import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { NanobotBridge } from './nanobot-bridge.js';
import type { NanobotTaskConfig } from '../../shared/nanobot.types.js';

export function nanobotRoutes(bridge: NanobotBridge): Router {
  const router = Router();

  // Spawn a one-off task
  router.post('/nanobot/task', async (req: Request, res: Response) => {
    const config: NanobotTaskConfig = {
      ...req.body,
      taskId: uuid(),
      triggerOnce: true,
    };

    // Authority guard — bridge-level block on trade execution
    if (config.authorityThreshold?.canExecuteTrades) {
      return res.status(403).json({ error: 'Nanobot tasks cannot execute trades — escalate to OpenClaw authority' });
    }

    try {
      const taskId = await bridge.spawnTask(config);
      res.json({ taskId, status: 'spawning' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get task result
  router.get('/nanobot/task/:taskId', (req: Request, res: Response) => {
    const taskId = String(req.params.taskId);
    const result = bridge.results.get(taskId);
    if (!result) return res.status(404).json({ error: 'Task not found' });
    res.json(result);
  });

  // Cancel a running task
  router.delete('/nanobot/task/:taskId', (req: Request, res: Response) => {
    const taskId = String(req.params.taskId);
    bridge.cancelTask(taskId);
    res.json({ cancelled: true });
  });

  // List active tasks
  router.get('/nanobot/tasks', (_req: Request, res: Response) => {
    const active = bridge.getActiveTaskIds();
    const recent = [...bridge.results.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 20);
    res.json({ active, activeCount: active.length, recent });
  });

  return router;
}
