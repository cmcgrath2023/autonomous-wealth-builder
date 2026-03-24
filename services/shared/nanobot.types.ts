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
  taskId: string;
  taskClass: NanobotTaskClass;
  autonomyLevel: NanobotAutonomyLevel;
  cronExpression?: string;
  triggerOnce?: boolean;
  timeoutMs: number;
  memoryLimitMb: number;
  modelProvider: 'anthropic' | 'openai' | 'openrouter' | 'local';
  modelId: string;
  tools: NanobotToolPermission[];
  authorityThreshold: AuthorityThreshold;
  outputChannel: 'openclaw_rpc' | 'rvf_event' | 'stdout';
}

export interface NanobotToolPermission {
  tool: 'web_search' | 'web_fetch' | 'exec' | 'file_read' | 'file_write';
  sandboxed: boolean;
  allowlist?: string[];
}

export interface AuthorityThreshold {
  canExecuteTrades: boolean;
  maxNotionalUsd?: number;
  requiresApproval: boolean;
  approvalChannel?: string;
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
  linesExecuted?: number;
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
