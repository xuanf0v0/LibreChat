import type { Document, Types } from 'mongoose';
import type {
  SuperAgentEffectivePolicy,
  SuperAgentEvaluation,
  SuperAgentUsage,
  SuperAgentUsageEvent,
  SuperAgentNodeResult,
  SuperAgentNodeStatus,
  SuperAgentTaskStatus,
} from 'librechat-data-provider';

export interface ISuperAgentNode {
  id: string;
  goal: string;
  agentId: string;
  dependencies: string[];
  acceptanceCriteria: string[];
  allowedTools?: string[] | null;
  maxSteps?: number;
  timeoutMs?: number;
  maxConcurrentRuns?: number;
  trinityAgentName?: string | null;
  evaluation?: SuperAgentEvaluation;
  status: SuperAgentNodeStatus;
  attempts: number;
  maxAttempts: number;
  result?: SuperAgentNodeResult;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ISuperAgentTask {
  _id?: Types.ObjectId;
  id: string;
  user: string;
  tenantId?: string;
  goal: string;
  plannerAgentId: string;
  evaluatorAgentId: string;
  workerAgentIds: string[];
  status: SuperAgentTaskStatus;
  maxWorkers: number;
  replans: number;
  replanFeedback?: string;
  errorCode?: string;
  usage: SuperAgentUsage;
  usageEvents: SuperAgentUsageEvent[];
  policy: SuperAgentEffectivePolicy;
  nodes: ISuperAgentNode[];
  error?: string;
  version: number;
  createdAt?: Date;
  updatedAt?: Date;
  completedAt?: Date;
}

export interface ISuperAgentTaskDocument
  extends Omit<ISuperAgentTask, '_id'>,
    Omit<Document, 'id'> {}
