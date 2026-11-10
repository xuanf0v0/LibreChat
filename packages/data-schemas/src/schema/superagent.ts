import { Schema } from 'mongoose';
import type { ISuperAgentTaskDocument } from '~/types';

const resultSchema = new Schema(
  {
    content: { type: String, required: true, maxlength: 200_000 },
    conversationId: { type: String, maxlength: 256 },
    messageId: { type: String, maxlength: 256 },
  },
  { _id: false },
);

const policySchema = new Schema(
  {
    allowedTools: { type: [String], default: null },
    maxSteps: { type: Number, required: true, min: 1, max: 100 },
    timeoutMs: { type: Number, required: true, min: 1_000, max: 600_000 },
    maxNodes: { type: Number, required: true, min: 1, max: 12 },
    maxReplans: { type: Number, required: true, min: 0, max: 3 },
    maxTokens: { type: Number, required: true, min: 1_000 },
    plannerMaxTokens: { type: Number, required: true, min: 500 },
    workerMaxTokens: { type: Number, required: true, min: 500 },
    evaluatorMaxTokens: { type: Number, required: true, min: 500 },
    maxDurationMs: { type: Number, required: true, min: 60_000 },
  },
  { _id: false },
);

const evaluationSchema = new Schema(
  {
    passed: { type: Boolean, default: null },
    reason: { type: String, required: true, maxlength: 2_000 },
    feedback: { type: String, maxlength: 4_000 },
  },
  { _id: false },
);

const nodeSchema = new Schema(
  {
    id: { type: String, required: true, maxlength: 64 },
    goal: { type: String, required: true, maxlength: 8_000 },
    agentId: { type: String, required: true, maxlength: 128 },
    dependencies: { type: [String], default: [] },
    acceptanceCriteria: { type: [String], default: [] },
    allowedTools: { type: [String], default: undefined },
    maxSteps: { type: Number, min: 1, max: 100 },
    timeoutMs: { type: Number, min: 1_000, max: 600_000 },
    maxConcurrentRuns: { type: Number, min: 1, max: 10 },
    trinityAgentName: { type: String, maxlength: 128, default: null },
    evaluation: { type: evaluationSchema },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'ready', 'running', 'completed', 'failed', 'blocked', 'cancelled'],
    },
    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 1, min: 1, max: 5 },
    result: { type: resultSchema },
    error: { type: String, maxlength: 2_000 },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { _id: false },
);

const superAgentTaskSchema: Schema<ISuperAgentTaskDocument> = new Schema<ISuperAgentTaskDocument>(
  {
    id: { type: String, required: true, unique: true, index: true, maxlength: 128 },
    user: { type: String, required: true, index: true },
    tenantId: { type: String, index: true },
    goal: { type: String, required: true, maxlength: 8_000 },
    plannerAgentId: { type: String, required: true, maxlength: 128 },
    evaluatorAgentId: { type: String, required: true, maxlength: 128 },
    workerAgentIds: { type: [String], default: [] },
    status: {
      type: String,
      required: true,
      enum: ['planning', 'pending', 'running', 'waiting', 'completed', 'failed', 'cancelled'],
      index: true,
    },
    maxWorkers: { type: Number, default: 3, min: 1, max: 10 },
    replans: { type: Number, default: 0, min: 0, max: 3 },
    replanFeedback: { type: String, maxlength: 8_000 },
    errorCode: { type: String, maxlength: 80 },
    usageEvents: {
      type: [
        new Schema(
          {
            role: { type: String, enum: ['planner', 'worker', 'evaluator'], required: true },
            agentId: { type: String, required: true, maxlength: 128 },
            nodeId: { type: String, required: true, maxlength: 128 },
            promptTokens: { type: Number, required: true, min: 0 },
            completionTokens: { type: Number, required: true, min: 0 },
            totalTokens: { type: Number, required: true, min: 0 },
            durationMs: { type: Number, required: true, min: 0 },
            costUsd: { type: Number, min: 0 },
            contextUsed: { type: Number, min: 0 },
            contextMax: { type: Number, min: 0 },
            at: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    usage: {
      totalTokens: { type: Number, default: 0, min: 0 },
      promptTokens: { type: Number, default: 0, min: 0 },
      completionTokens: { type: Number, default: 0, min: 0 },
      costUsd: { type: Number, min: 0 },
      planner: {
        totalTokens: { type: Number, default: 0, min: 0 },
        promptTokens: { type: Number, default: 0, min: 0 },
        completionTokens: { type: Number, default: 0, min: 0 },
      },
      worker: {
        totalTokens: { type: Number, default: 0, min: 0 },
        promptTokens: { type: Number, default: 0, min: 0 },
        completionTokens: { type: Number, default: 0, min: 0 },
      },
      evaluator: {
        totalTokens: { type: Number, default: 0, min: 0 },
        promptTokens: { type: Number, default: 0, min: 0 },
        completionTokens: { type: Number, default: 0, min: 0 },
      },
    },
    policy: { type: policySchema, required: true },
    nodes: { type: [nodeSchema], default: [] },
    error: { type: String, maxlength: 2_000 },
    version: { type: Number, default: 0, min: 0 },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

superAgentTaskSchema.index({ user: 1, tenantId: 1, createdAt: -1 });
superAgentTaskSchema.index({ status: 1, updatedAt: 1 });

export default superAgentTaskSchema;
