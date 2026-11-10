import { z } from 'zod';

export const superAgentTaskStatusSchema = z.enum([
  'planning',
  'pending',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
]);

export const superAgentNodeStatusSchema = z.enum([
  'pending',
  'ready',
  'running',
  'evaluating',
  'completed',
  'failed',
  'blocked',
  'cancelled',
]);

export const superAgentNodeResultSchema = z.object({
  content: z.string().max(200_000),
  conversationId: z.string().max(256).optional(),
  messageId: z.string().max(256).optional(),
});

export const superAgentPolicySchema = z
  .object({
    allowedTools: z.array(z.string().min(1).max(128)).max(50).nullable().optional(),
    maxSteps: z.number().int().min(1).max(100).optional(),
    timeoutMs: z.number().int().min(1_000).max(600_000).optional(),
    maxNodes: z.number().int().min(1).max(12).optional(),
    maxReplans: z.number().int().min(0).max(3).optional(),
    maxTokens: z.number().int().min(1_000).max(2_000_000).optional(),
    plannerMaxTokens: z.number().int().min(500).max(1_000_000).optional(),
    workerMaxTokens: z.number().int().min(500).max(2_000_000).optional(),
    evaluatorMaxTokens: z.number().int().min(500).max(1_000_000).optional(),
    maxDurationMs: z.number().int().min(60_000).max(86_400_000).optional(),
  })
  .strict();

export const superAgentEffectivePolicySchema = z.object({
  allowedTools: z.array(z.string().min(1).max(128)).max(50).nullable(),
  maxSteps: z.number().int().min(1).max(100),
  timeoutMs: z.number().int().min(1_000).max(600_000),
  maxNodes: z.number().int().min(1).max(12),
  maxReplans: z.number().int().min(0).max(3),
  maxTokens: z.number().int().min(1_000).max(2_000_000),
  plannerMaxTokens: z.number().int().min(500).max(1_000_000),
  workerMaxTokens: z.number().int().min(500).max(2_000_000),
  evaluatorMaxTokens: z.number().int().min(500).max(1_000_000),
  maxDurationMs: z.number().int().min(60_000).max(86_400_000),
});

export const superAgentUsageTotalsSchema = z.object({
  totalTokens: z.number().int().min(0),
  promptTokens: z.number().int().min(0),
  completionTokens: z.number().int().min(0),
  /** Provider-reported cost in USD, when the backend returns one. */
  costUsd: z.number().min(0).optional(),
});

export const superAgentUsageSchema = superAgentUsageTotalsSchema.extend({
  planner: superAgentUsageTotalsSchema.optional(),
  worker: superAgentUsageTotalsSchema.optional(),
  evaluator: superAgentUsageTotalsSchema.optional(),
});

export const superAgentUsageEventSchema = z.object({
  role: z.enum(['planner', 'worker', 'evaluator']),
  agentId: z.string().max(128),
  nodeId: z.string().max(128),
  promptTokens: z.number().int().min(0),
  completionTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  /** Provider-reported cost in USD, when the backend returns one. */
  costUsd: z.number().min(0).optional(),
  /** Provider-reported context window usage, when the backend returns one. */
  contextUsed: z.number().int().min(0).optional(),
  contextMax: z.number().int().min(0).optional(),
  at: z.string().datetime(),
});

export const superAgentEvaluationSchema = z.object({
  passed: z.boolean().nullable(),
  reason: z.string().max(2_000),
  feedback: z.string().max(4_000).optional(),
});

export const superAgentNodeSchema = z.object({
  id: z.string().min(1).max(64),
  goal: z.string().min(1).max(8_000),
  agentId: z.string().min(1).max(128),
  dependencies: z.array(z.string().min(1).max(64)).max(12).default([]),
  acceptanceCriteria: z.array(z.string().min(1).max(500)).max(8).default([]),
  allowedTools: z.array(z.string().min(1).max(128)).max(50).nullable().optional(),
  maxSteps: z.number().int().min(1).max(100).optional(),
  timeoutMs: z.number().int().min(1_000).max(600_000).optional(),
  maxConcurrentRuns: z.number().int().min(1).max(10).optional(),
  trinityAgentName: z.string().max(128).nullable().optional(),
  evaluation: superAgentEvaluationSchema.optional(),
  status: superAgentNodeStatusSchema,
  attempts: z.number().int().min(0).max(10),
  maxAttempts: z.number().int().min(1).max(5),
  result: superAgentNodeResultSchema.optional(),
  error: z.string().max(2_000).optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});

export const superAgentWorkerConfigSchema = z.object({
  capabilities: z.array(z.string().trim().min(1).max(80)).max(20),
  allowedTools: z.array(z.string().trim().min(1).max(128)).max(50).nullable(),
  maxSteps: z.number().int().min(1).max(100),
  timeoutMs: z.number().int().min(1_000).max(600_000),
  maxConcurrentRuns: z.number().int().min(1).max(10),
  maxRunsPerTask: z.number().int().min(1).max(12),
  enabled: z.boolean(),
  trinityAgentName: z.string().trim().max(128).nullable().optional(),
});

export const updateSuperAgentWorkerSchema = superAgentWorkerConfigSchema.partial();

export const superAgentWorkerSchema = superAgentWorkerConfigSchema.extend({
  agentId: z.string().min(1).max(128),
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  customized: z.boolean(),
});

export const superAgentWorkerListResponseSchema = z.object({
  workers: z.array(superAgentWorkerSchema),
});

export const superAgentWorkerResponseSchema = z.object({
  worker: superAgentWorkerSchema,
});

export type SuperAgentWorkerConfig = z.infer<typeof superAgentWorkerConfigSchema>;
export type UpdateSuperAgentWorkerParams = z.infer<typeof updateSuperAgentWorkerSchema>;
export type SuperAgentWorkerRecord = z.infer<typeof superAgentWorkerSchema>;
export type SuperAgentWorkerListResponse = z.infer<typeof superAgentWorkerListResponseSchema>;
export type SuperAgentWorkerResponse = z.infer<typeof superAgentWorkerResponseSchema>;

export const superAgentTaskSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  tenantId: z.string().optional(),
  goal: z.string(),
  plannerAgentId: z.string(),
  evaluatorAgentId: z.string(),
  workerAgentIds: z.array(z.string()),
  status: superAgentTaskStatusSchema,
  maxWorkers: z.number().int().min(1).max(10),
  replans: z.number().int().min(0).max(3),
  replanFeedback: z.string().max(8_000).optional(),
  errorCode: z.string().max(80).optional(),
  usage: superAgentUsageSchema,
  usageEvents: z.array(superAgentUsageEventSchema).max(200),
  policy: superAgentEffectivePolicySchema,
  version: z.number().int().min(0),
  nodes: z.array(superAgentNodeSchema),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});

export const createSuperAgentTaskSchema = z
  .object({
    goal: z.string().trim().min(1).max(8_000),
    plannerAgentId: z.string().trim().min(1).max(128),
    evaluatorAgentId: z.string().trim().min(1).max(128).optional(),
    workerAgentIds: z.array(z.string().trim().min(1).max(128)).max(20).optional(),
    maxWorkers: z.number().int().min(1).max(10).optional(),
    policy: superAgentPolicySchema.optional(),
  })
  .strict();

export const superAgentTaskParamsSchema = z.object({
  id: z.string().min(1).max(128),
});

export const superAgentWorkerParamsSchema = z.object({
  agentId: z.string().min(1).max(128),
});

export const superAgentTaskListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const superAgentTaskListResponseSchema = z.object({
  tasks: z.array(superAgentTaskSchema),
});

export const superAgentTaskResponseSchema = z.object({
  task: superAgentTaskSchema,
});

export const superAgentNodeDraftSchema = z.object({
  id: z.string().min(1).max(64),
  goal: z.string().min(1).max(8_000),
  agentId: z.string().min(1).max(128),
  dependencies: z.array(z.string().min(1).max(64)).max(12).default([]),
  acceptanceCriteria: z.array(z.string().min(1).max(500)).max(8).default([]),
});

export const superAgentPlanDraftSchema = z.object({
  nodes: z.array(superAgentNodeDraftSchema).min(1).max(12),
});

export type SuperAgentTaskStatus = z.infer<typeof superAgentTaskStatusSchema>;
export type SuperAgentNodeStatus = z.infer<typeof superAgentNodeStatusSchema>;
export type SuperAgentNodeResult = z.infer<typeof superAgentNodeResultSchema>;
export type SuperAgentUsageTotals = z.infer<typeof superAgentUsageTotalsSchema>;
export type SuperAgentUsage = z.infer<typeof superAgentUsageSchema>;
export type SuperAgentUsageEvent = z.infer<typeof superAgentUsageEventSchema>;
export type SuperAgentEvaluation = z.infer<typeof superAgentEvaluationSchema>;
export type SuperAgentNode = z.infer<typeof superAgentNodeSchema>;
export type SuperAgentPolicy = z.infer<typeof superAgentPolicySchema>;
export type SuperAgentEffectivePolicy = z.infer<typeof superAgentEffectivePolicySchema>;
export type SuperAgentTask = z.infer<typeof superAgentTaskSchema>;
export type CreateSuperAgentTaskParams = z.infer<typeof createSuperAgentTaskSchema>;
export type SuperAgentTaskListResponse = z.infer<typeof superAgentTaskListResponseSchema>;
export type SuperAgentTaskResponse = z.infer<typeof superAgentTaskResponseSchema>;
export type SuperAgentNodeDraft = z.infer<typeof superAgentNodeDraftSchema>;
export type SuperAgentPlanDraft = z.infer<typeof superAgentPlanDraftSchema>;
