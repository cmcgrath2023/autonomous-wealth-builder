interface AgentTask {
  agent: string;
  action: string;
  params: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high' | 'critical';
}

interface AgentResponse {
  taskId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

export interface SwarmStatus {
  activeAgents: number;
  queuedTasks: number;
  completedToday: number;
  agents: { name: string; status: 'idle' | 'busy' | 'error'; currentTask?: string }[];
}

class RuflowClient {
  private baseUrl: string;

  constructor(baseUrl: string = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001') {
    this.baseUrl = baseUrl;
  }

  async dispatch(task: AgentTask): Promise<AgentResponse> {
    const response = await fetch(`${this.baseUrl}/api/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    });
    if (!response.ok) throw new Error(`ruflow error: ${response.statusText}`);
    return response.json();
  }

  async getStatus(): Promise<SwarmStatus> {
    const response = await fetch(`${this.baseUrl}/api/status`);
    if (!response.ok) throw new Error(`ruflow error: ${response.statusText}`);
    return response.json();
  }

  async getTaskResult(taskId: string): Promise<AgentResponse> {
    const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}`);
    if (!response.ok) throw new Error(`ruflow error: ${response.statusText}`);
    return response.json();
  }

  async requestBriefing(): Promise<AgentResponse> {
    return this.dispatch({ agent: 'finley', action: 'generate_briefing', params: { type: 'daily' } });
  }

  async queryPortfolio(question: string): Promise<AgentResponse> {
    return this.dispatch({ agent: 'harbor', action: 'query', params: { question }, priority: 'high' });
  }
}

export const ruflow = new RuflowClient();
export type { AgentTask, AgentResponse };
