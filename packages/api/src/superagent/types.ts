import type { SuperAgentTask, SuperAgentTaskStatus } from 'librechat-data-provider';

export interface SuperAgentWorker {
  id: string;
  name: string;
  description?: string;
  category?: string;
  capabilities?: string[];
  tools?: string[];
  allowedTools?: string[] | null;
  maxSteps?: number;
  timeoutMs?: number;
  maxConcurrentRuns?: number;
  maxRunsPerTask?: number;
  trinityAgentName?: string | null;
  customized?: boolean;
  enabled?: boolean;
}

export interface SuperAgentExecutionResult {
  content: string;
  conversationId?: string;
  messageId?: string;
  tokenUsage?: { totalTokens: number; promptTokens: number; completionTokens: number };
  /** Provider-reported wall-clock duration, when the backend returns one. */
  durationMs?: number;
  /** Provider-reported cost in USD, when the backend returns one. */
  costUsd?: number;
  /** Provider-reported context window usage, when the backend returns one. */
  contextUsed?: number;
  contextMax?: number;
}

export interface SuperAgentExecutionInput {
  agentId: string;
  goal: string;
  taskId: string;
  nodeId: string;
  userId: string;
  tenantId?: string;
  signal: AbortSignal;
  timeoutMs: number;
  allowedTools?: string[] | null;
  maxSteps?: number;
  role?: 'planner' | 'worker' | 'evaluator';
  trinityAgentName?: string | null;
}

export interface SuperAgentLimits {
  maxActiveTasks: number;
  maxWorkers: number;
  maxNodes: number;
  defaultMaxSteps: number;
  defaultTimeoutMs: number;
  defaultMaxReplans?: number;
  defaultMaxTokens?: number;
  defaultMaxDurationMs?: number;
  defaultPlannerMaxTokens?: number;
  defaultWorkerMaxTokens?: number;
  defaultEvaluatorMaxTokens?: number;
}

export interface SuperAgentAgentExecutor {
  execute(input: SuperAgentExecutionInput): Promise<SuperAgentExecutionResult>;
}

export interface SuperAgentTaskRepository {
  get(userId: string, taskId: string, tenantId?: string): Promise<SuperAgentTask | null>;
  list(userId: string, options?: { limit?: number; tenantId?: string }): Promise<SuperAgentTask[]>;
  update(
    userId: string,
    taskId: string,
    expectedVersion: number,
    update: {
      status?: SuperAgentTaskStatus;
      nodes?: SuperAgentTask['nodes'];
      replans?: number;
      replanFeedback?: string | null;
      errorCode?: string | null;
      usage?: SuperAgentTask['usage'];
      error?: string | null;
      completedAt?: Date | null;
    },
    tenantId?: string,
  ): Promise<SuperAgentTask | null>;
  listRecoverable(olderThan: Date): Promise<SuperAgentTask[]>;
}

export interface SuperAgentLogger {
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}
