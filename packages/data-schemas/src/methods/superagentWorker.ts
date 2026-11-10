import type { Model } from 'mongoose';
import type { ISuperAgentWorker, ISuperAgentWorkerDocument } from '~/types';

export interface UpdateSuperAgentWorkerInput {
  capabilities?: string[];
  allowedTools?: string[] | null;
  maxSteps?: number;
  timeoutMs?: number;
  maxConcurrentRuns?: number;
  maxRunsPerTask?: number;
  enabled?: boolean;
  trinityAgentName?: string | null;
}

export interface SuperAgentWorkerMethods {
  listSuperAgentWorkers(user: string, tenantId?: string): Promise<ISuperAgentWorker[]>;
  getSuperAgentWorker(
    user: string,
    agentId: string,
    tenantId?: string,
  ): Promise<ISuperAgentWorker | null>;
  upsertSuperAgentWorker(
    user: string,
    agentId: string,
    input: UpdateSuperAgentWorkerInput,
    tenantId?: string,
  ): Promise<ISuperAgentWorker>;
  deleteSuperAgentWorker(user: string, agentId: string, tenantId?: string): Promise<boolean>;
}

function scope(user: string, tenantId?: string): Record<string, unknown> {
  return tenantId == null ? { user } : { user, tenantId };
}

export function createSuperAgentWorkerMethods(
  mongoose: typeof import('mongoose'),
): SuperAgentWorkerMethods {
  const model = () => mongoose.models.SuperAgentWorker as Model<ISuperAgentWorkerDocument>;

  async function listSuperAgentWorkers(
    user: string,
    tenantId?: string,
  ): Promise<ISuperAgentWorker[]> {
    return await model()
      .find(scope(user, tenantId))
      .sort({ updatedAt: -1 })
      .lean<ISuperAgentWorker[]>();
  }

  async function getSuperAgentWorker(
    user: string,
    agentId: string,
    tenantId?: string,
  ): Promise<ISuperAgentWorker | null> {
    return await model()
      .findOne({ ...scope(user, tenantId), agentId })
      .lean<ISuperAgentWorker | null>();
  }

  async function upsertSuperAgentWorker(
    user: string,
    agentId: string,
    input: UpdateSuperAgentWorkerInput,
    tenantId?: string,
  ): Promise<ISuperAgentWorker> {
    const worker = await model()
      .findOneAndUpdate(
        { ...scope(user, tenantId), agentId },
        {
          $set: { ...input },
          $setOnInsert: { user, ...(tenantId == null ? {} : { tenantId }), agentId },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<ISuperAgentWorker>();
    return worker;
  }

  async function deleteSuperAgentWorker(
    user: string,
    agentId: string,
    tenantId?: string,
  ): Promise<boolean> {
    const result = await model().deleteOne({ ...scope(user, tenantId), agentId });
    return result.deletedCount > 0;
  }

  return {
    listSuperAgentWorkers,
    getSuperAgentWorker,
    upsertSuperAgentWorker,
    deleteSuperAgentWorker,
  };
}
