export type ServiceStatus = 'starting' | 'active' | 'error' | 'unavailable';

export interface ServiceEntry<T = any> {
  instance: T | null;
  status: ServiceStatus;
  lastError?: string;
  startedAt?: string;
}

export class ServiceRegistry {
  private services = new Map<string, ServiceEntry>();

  register<T>(name: string, instance: T | null, status: ServiceStatus = 'starting'): void {
    this.services.set(name, { instance, status, startedAt: new Date().toISOString() });
  }

  get<T>(name: string): T | null {
    const entry = this.services.get(name);
    if (!entry || entry.status === 'unavailable' || entry.status === 'error') return null;
    return entry.instance as T | null;
  }

  getStatus(name: string): ServiceStatus {
    return this.services.get(name)?.status || 'unavailable';
  }

  getAll(): Record<string, { status: ServiceStatus; lastError?: string }> {
    const result: Record<string, { status: ServiceStatus; lastError?: string }> = {};
    for (const [name, entry] of this.services) {
      result[name] = { status: entry.status, lastError: entry.lastError };
    }
    return result;
  }

  markError(name: string, error: string): void {
    const entry = this.services.get(name);
    if (entry) {
      entry.status = 'error';
      entry.lastError = error;
    }
  }

  markActive(name: string): void {
    const entry = this.services.get(name);
    if (entry) {
      entry.status = 'active';
      entry.lastError = undefined;
    }
  }

  set<T>(name: string, instance: T): void {
    const entry = this.services.get(name);
    if (entry) {
      entry.instance = instance;
      entry.status = 'active';
    } else {
      this.register(name, instance, 'active');
    }
  }
}
