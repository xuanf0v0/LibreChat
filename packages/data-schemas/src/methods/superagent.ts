import type { Model } from 'mongoose';
import type {
  SuperAgentEffectivePolicy,
  SuperAgentTask,
  SuperAgentTaskStatus,
} from 'librechat-data-provider';
import type { ISuperAgentTask, ISuperAgentTaskDocument } from '~/types';

export interface CreateSuperAgentTaskInput {
  id: string;
  goal: string;
  plannerAgentId: string;
  evaluatorAgentId: string;
  workerAgentIds: string[];
  maxWorkers: number;
  replans: number;
  usage: SuperAgentTask['usage'];
  usageEvents: SuperAgentTask['usageEvents'];
  policy: SuperAgentEffectivePolicy;
  status: SuperAgentTaskStatus;
  nodes?: SuperAgentTask['nodes'];
}

export interface UpdateSuperAgentTaskInput {
  status?: SuperAgentTaskStatus;
  nodes?: SuperAgentTask['nodes'];
  replans?: number;
  replanFeedback?: string | null;
  errorCode?: string | null;
  usage?: SuperAgentTask['usage'];
  usageEvents?: SuperAgentTask['usageEvents'];
  error?: string | null;
  completedAt?: Date | null;
}

export interface SuperAgentTaskMethods {
  createSuperAgentTask(
    user: string,
    input: CreateSuperAgentTaskInput,
    tenantId?: string,
  ): Promise<SuperAgentTask>;
  getSuperAgentTask(user: string, id: string, tenantId?: string): Promise<SuperAgentTask | null>;
  listSuperAgentTasks(
    user: string,
    options?: { limit?: number; tenantId?: string },
  ): Promise<SuperAgentTask[]>;
  updateSuperAgentTask(
    user: string,
    id: string,
    expectedVersion: number,
    update: UpdateSuperAgentTaskInput,
    tenantId?: string,
  ): Promise<SuperAgentTask | null>;
  listRecoverableSuperAgentTasks(olderThan: Date): Promise<SuperAgentTask[]>;
}

const DEFAULT_LIMIT = 20;

function scope(user: string, tenantId?: string): Record<string, unknown> {
  return tenantId == null ? { user } : { user, tenantId };
}

function iso(value: Date | string | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toPublicTask(task: ISuperAgentTask & { __v?: number }): SuperAgentTask {
  const { user, _id, __v: _version, nodes, createdAt, updatedAt, completedAt, ...rest } = task;
  return {
    ...rest,
    userId: user,
    usageEvents: (task.usageEvents ?? []).map((event) => ({
      ...event,
      at: iso(event.at) as string,
    })),
    nodes: (nodes ?? []).map((node) => ({
      ...node,
      startedAt: iso(node.startedAt),
      completedAt: iso(node.completedAt),
    })),
    createdAt: iso(createdAt) as string,
    updatedAt: iso(updatedAt) as string,
    ...(completedAt == null ? {} : { completedAt: iso(completedAt) }),
  };
}

export function createSuperAgentTaskMethods(
  mongoose: typeof import('mongoose'),
): SuperAgentTaskMethods {
  const model = () => mongoose.models.SuperAgentTask as Model<ISuperAgentTaskDocument>;

  async function createSuperAgentTask(
    user: string,
    input: CreateSuperAgentTaskInput,
    tenantId?: string,
  ): Promise<SuperAgentTask> {
    const task = await model().create({
      ...input,
      user,
      ...(tenantId == null ? {} : { tenantId }),
      nodes: input.nodes ?? [],
      version: 0,
    });
    return toPublicTask(task.toObject() as ISuperAgentTask);
  }

  async function getSuperAgentTask(
    user: string,
    id: string,
    tenantId?: string,
  ): Promise<SuperAgentTask | null> {
    const task = await model()
      .findOne({ ...scope(user, tenantId), id })
      .lean<ISuperAgentTask>();
    return task == null ? null : toPublicTask(task);
  }

  async function listSuperAgentTasks(
    user: string,
    options: { limit?: number; tenantId?: string } = {},
  ): Promise<SuperAgentTask[]> {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 50);
    const tasks = await model()
      .find(scope(user, options.tenantId))
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<ISuperAgentTask[]>();
    return tasks.map(toPublicTask);
  }

  async function updateSuperAgentTask(
    user: string,
    id: string,
    expectedVersion: number,
    update: UpdateSuperAgentTaskInput,
    tenantId?: string,
  ): Promise<SuperAgentTask | null> {
    const $set: Record<string, unknown> = {};
    if (update.status !== undefined) {
      $set.status = update.status;
    }
    if (update.nodes !== undefined) {
      $set.nodes = update.nodes;
    }
    if (update.replans !== undefined) {
      $set.replans = update.replans;
    }
    if (update.replanFeedback !== undefined) {
      $set.replanFeedback = update.replanFeedback;
    }
    if (update.errorCode !== undefined) {
      $set.errorCode = update.errorCode;
    }
    if (update.usage !== undefined) {
      $set.usage = update.usage;
    }
    if (update.usageEvents !== undefined) {
      $set.usageEvents = update.usageEvents;
    }
    if (update.error !== undefined) {
      $set.error = update.error;
    }
    if (update.completedAt !== undefined) {
      $set.completedAt = update.completedAt;
    }
    if (Object.keys($set).length === 0) {
      return await getSuperAgentTask(user, id, tenantId);
    }
    const task = await model()
      .findOneAndUpdate(
        { ...scope(user, tenantId), id, version: expectedVersion },
        { $set, $inc: { version: 1 } },
        { new: true },
      )
      .lean<ISuperAgentTask | null>();
    return task == null ? null : toPublicTask(task);
  }

  async function listRecoverableSuperAgentTasks(olderThan: Date): Promise<SuperAgentTask[]> {
    const tasks = await model()
      .find({
        status: { $in: ['planning', 'pending', 'running'] },
        updatedAt: { $lt: olderThan },
      })
      .sort({ updatedAt: 1 })
      .limit(50)
      .lean<ISuperAgentTask[]>();
    return tasks.map(toPublicTask);
  }

  return {
    createSuperAgentTask,
    getSuperAgentTask,
    listSuperAgentTasks,
    updateSuperAgentTask,
    listRecoverableSuperAgentTasks,
  };
}
