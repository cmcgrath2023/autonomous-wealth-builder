import { ServiceRegistry } from './service-registry.js';

export type ModuleInit = (registry: ServiceRegistry) => Promise<(() => void) | void>;

interface ModuleEntry {
  name: string;
  init: ModuleInit;
  cleanup?: () => void;
  status: 'pending' | 'running' | 'error' | 'stopped';
  error?: string;
}

export class Supervisor {
  private modules: ModuleEntry[] = [];

  registerModule(name: string, init: ModuleInit): void {
    this.modules.push({ name, init, status: 'pending' });
  }

  async startAll(registry: ServiceRegistry): Promise<void> {
    for (const mod of this.modules) {
      try {
        console.log(`[Supervisor] Starting module: ${mod.name}`);
        const cleanup = await mod.init(registry);
        mod.cleanup = cleanup || undefined;
        mod.status = 'running';
        console.log(`[Supervisor] Module ready: ${mod.name}`);
      } catch (err: any) {
        mod.status = 'error';
        mod.error = err.message;
        console.error(`[Supervisor] Module FAILED: ${mod.name} — ${err.message}`);
        // Continue starting other modules
      }
    }
  }

  async restartModule(name: string, registry: ServiceRegistry): Promise<boolean> {
    const mod = this.modules.find(m => m.name === name);
    if (!mod) return false;

    try {
      if (mod.cleanup) mod.cleanup();
      const cleanup = await mod.init(registry);
      mod.cleanup = cleanup || undefined;
      mod.status = 'running';
      mod.error = undefined;
      console.log(`[Supervisor] Module restarted: ${name}`);
      return true;
    } catch (err: any) {
      mod.status = 'error';
      mod.error = err.message;
      console.error(`[Supervisor] Module restart FAILED: ${name} — ${err.message}`);
      return false;
    }
  }

  getModuleStatuses(): Record<string, { status: string; error?: string }> {
    const result: Record<string, { status: string; error?: string }> = {};
    for (const mod of this.modules) {
      result[mod.name] = { status: mod.status, error: mod.error };
    }
    return result;
  }
}
