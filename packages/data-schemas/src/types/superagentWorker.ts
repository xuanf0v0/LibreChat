import type { Document, Types } from 'mongoose';

export interface ISuperAgentWorker {
  _id?: Types.ObjectId;
  user: string;
  tenantId?: string;
  agentId: string;
  capabilities: string[];
  allowedTools: string[] | null;
  maxSteps: number;
  timeoutMs: number;
  maxConcurrentRuns: number;
  maxRunsPerTask: number;
  enabled: boolean;
  trinityAgentName?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISuperAgentWorkerDocument
  extends Omit<ISuperAgentWorker, '_id'>,
    Omit<Document, 'id'> {}
