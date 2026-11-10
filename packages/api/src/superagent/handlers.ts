import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { ServerRequest } from '~/types';
import {
  createSuperAgentTaskSchema,
  superAgentTaskListQuerySchema,
  superAgentTaskParamsSchema,
  superAgentWorkerParamsSchema,
  updateSuperAgentWorkerSchema,
  type SuperAgentEffectivePolicy,
  type SuperAgentTask,
  type SuperAgentWorkerRecord,
  type UpdateSuperAgentWorkerParams,
} from 'librechat-data-provider';
import type { SuperAgentLimits, SuperAgentTaskRepository, SuperAgentWorker } from './types';
import type { SuperAgentTaskEvents } from './events';

export interface SuperAgentTaskStore extends SuperAgentTaskRepository {
  create(input: {
    id: string;
    userId: string;
    tenantId?: string;
    goal: string;
    plannerAgentId: string;
    evaluatorAgentId: string;
    workerAgentIds: string[];
    maxWorkers: number;
    replans: number;
    usage: SuperAgentTask['usage'];
    usageEvents: SuperAgentTask['usageEvents'];
    policy: SuperAgentEffectivePolicy;
    status: 'planning';
  }): Promise<SuperAgentTask>;
}

export interface SuperAgentHandlersDeps {
  store: SuperAgentTaskStore;
  orchestrator: {
    start(taskId: string, userId: string, tenantId?: string): void;
    cancel(taskId: string, userId: string, tenantId?: string): Promise<SuperAgentTask | null>;
  };
  listWorkers: (params: {
    userId: string;
    role?: string;
    tenantId?: string;
  }) => Promise<SuperAgentWorker[]>;
  limits: SuperAgentLimits;
  trinity?: {
    enabled: boolean;
    url?: string;
    apiKey?: string;
    agentName?: string;
    timeoutMs?: number;
    probe?: (config?: {
      url?: string;
      apiKey?: string;
      timeoutMs?: number;
    }) => Promise<{ ok: boolean; message?: string }>;
  };
  events: SuperAgentTaskEvents;
  upsertWorker: (params: {
    userId: string;
    role?: string;
    tenantId?: string;
    agentId: string;
    input: UpdateSuperAgentWorkerParams;
  }) => Promise<SuperAgentWorker | null>;
  deleteWorker: (params: {
    userId: string;
    role?: string;
    tenantId?: string;
    agentId: string;
  }) => Promise<SuperAgentWorker | null>;
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: code, message });
}

function tenantOf(req: ServerRequest): string | undefined {
  const tenantId = req.user?.tenantId;
  return typeof tenantId === 'string' && tenantId !== '' ? tenantId : undefined;
}

export interface SuperAgentHandlers {
  createTask: (req: ServerRequest, res: Response) => Promise<void>;
  listTasks: (req: ServerRequest, res: Response) => Promise<void>;
  getTask: (req: ServerRequest, res: Response) => Promise<void>;
  cancelTask: (req: ServerRequest, res: Response) => Promise<void>;
  streamTaskEvents: (req: ServerRequest, res: Response) => Promise<void>;
  trinityHealth: (req: ServerRequest, res: Response) => Promise<void>;
  listWorkers: (req: ServerRequest, res: Response) => Promise<void>;
  updateWorker: (req: ServerRequest, res: Response) => Promise<void>;
  deleteWorker: (req: ServerRequest, res: Response) => Promise<void>;
}

function toWorkerRecord(worker: SuperAgentWorker): SuperAgentWorkerRecord {
  return {
    agentId: worker.id,
    name: worker.name,
    description: worker.description,
    category: worker.category,
    capabilities: worker.capabilities ?? [],
    allowedTools: worker.allowedTools ?? null,
    maxSteps: worker.maxSteps ?? 25,
    timeoutMs: worker.timeoutMs ?? 300_000,
    maxConcurrentRuns: worker.maxConcurrentRuns ?? 1,
    maxRunsPerTask: worker.maxRunsPerTask ?? 4,
    trinityAgentName: worker.trinityAgentName ?? null,
    enabled: worker.enabled ?? true,
    customized: worker.customized === true,
  };
}

export function createSuperAgentHandlers(deps: SuperAgentHandlersDeps): SuperAgentHandlers {
  const createTask = async (req: ServerRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (userId == null) {
      fail(res, 401, 'unauthorized', 'Authentication is required');
      return;
    }
    const parsed = createSuperAgentTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'invalid_request', 'Task request is invalid');
      return;
    }
    const input = parsed.data;
    const tenantId = tenantOf(req);
    const limits = { ...deps.limits, ...(req.config?.superAgent ?? {}) };

    let workers: SuperAgentWorker[];
    try {
      workers = await deps.listWorkers({ userId, role: req.user?.role, tenantId });
    } catch {
      fail(res, 503, 'workers_unavailable', 'Agent catalog is temporarily unavailable');
      return;
    }
    workers = workers.filter((worker) => worker.enabled !== false);
    const byId = new Map(workers.map((worker) => [worker.id, worker]));
    if (!byId.has(input.plannerAgentId)) {
      fail(res, 403, 'agent_not_accessible', 'Planner agent is not accessible');
      return;
    }

    const evaluatorAgentId = input.evaluatorAgentId ?? input.plannerAgentId;
    if (!byId.has(evaluatorAgentId)) {
      fail(res, 403, 'agent_not_accessible', 'Evaluator agent is not accessible');
      return;
    }

    const requestedWorkerIds =
      input.workerAgentIds == null || input.workerAgentIds.length === 0
        ? workers.filter((worker) => worker.id !== input.plannerAgentId).map((worker) => worker.id)
        : [...new Set(input.workerAgentIds)];
    if (requestedWorkerIds.length === 0) {
      fail(res, 400, 'no_workers', 'No worker agents are available');
      return;
    }
    if (requestedWorkerIds.some((id) => !byId.has(id))) {
      fail(res, 403, 'agent_not_accessible', 'One or more worker agents are not accessible');
      return;
    }

    try {
      const existing = await deps.store.list(userId, { limit: 50, tenantId });
      const active = existing.filter(
        (task) =>
          task.status === 'planning' ||
          task.status === 'pending' ||
          task.status === 'running' ||
          task.status === 'waiting',
      );
      if (active.length >= limits.maxActiveTasks) {
        fail(res, 429, 'too_many_active_tasks', 'Too many active tasks');
        return;
      }
    } catch {
      fail(res, 503, 'tasks_unavailable', 'Task storage is temporarily unavailable');
      return;
    }

    const allowedTools =
      input.policy?.allowedTools === undefined ? null : [...new Set(input.policy.allowedTools)];
    const policy: SuperAgentEffectivePolicy = {
      allowedTools,
      maxSteps: input.policy?.maxSteps ?? limits.defaultMaxSteps,
      timeoutMs: input.policy?.timeoutMs ?? limits.defaultTimeoutMs,
      maxNodes: Math.min(input.policy?.maxNodes ?? limits.maxNodes, limits.maxNodes),
      maxReplans: input.policy?.maxReplans ?? limits.defaultMaxReplans ?? 1,
      maxTokens: input.policy?.maxTokens ?? limits.defaultMaxTokens ?? 200_000,
      plannerMaxTokens: input.policy?.plannerMaxTokens ?? limits.defaultPlannerMaxTokens ?? 40_000,
      workerMaxTokens: input.policy?.workerMaxTokens ?? limits.defaultWorkerMaxTokens ?? 160_000,
      evaluatorMaxTokens:
        input.policy?.evaluatorMaxTokens ?? limits.defaultEvaluatorMaxTokens ?? 40_000,
      maxDurationMs: input.policy?.maxDurationMs ?? limits.defaultMaxDurationMs ?? 3_600_000,
    };
    const maxWorkers = Math.min(input.maxWorkers ?? limits.maxWorkers, limits.maxWorkers);

    const taskId = randomUUID();
    try {
      const task = await deps.store.create({
        id: taskId,
        userId,
        ...(tenantId == null ? {} : { tenantId }),
        goal: input.goal,
        plannerAgentId: input.plannerAgentId,
        evaluatorAgentId,
        workerAgentIds: requestedWorkerIds,
        maxWorkers,
        replans: 0,
        usageEvents: [],
        usage: {
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          planner: { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
          worker: { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
          evaluator: { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
        },
        policy,
        status: 'planning',
      });
      deps.orchestrator.start(task.id, task.userId, task.tenantId);
      res.status(202).json({ task });
    } catch {
      fail(res, 500, 'internal_error', 'Failed to create task');
    }
  };

  const listTasks = async (req: ServerRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (userId == null) {
      fail(res, 401, 'unauthorized', 'Authentication is required');
      return;
    }
    const parsed = superAgentTaskListQuerySchema.safeParse(req.query);
    const limit = parsed.success ? parsed.data.limit : undefined;
    try {
      const tasks = await deps.store.list(userId, { limit, tenantId: tenantOf(req) });
      res.status(200).json({ tasks });
    } catch {
      fail(res, 500, 'internal_error', 'Failed to list tasks');
    }
  };

  const getTask = async (req: ServerRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (userId == null) {
      fail(res, 401, 'unauthorized', 'Authentication is required');
      return;
    }
    const parsed = superAgentTaskParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      fail(res, 400, 'invalid_request', 'Task id is invalid');
      return;
    }
    try {
      const task = await deps.store.get(userId, parsed.data.id, tenantOf(req));
      if (task == null) {
        fail(res, 404, 'task_not_found', 'Task not found');
        return;
      }
      res.status(200).json({ task });
    } catch {
      fail(res, 500, 'internal_error', 'Failed to read task');
    }
  };

  const streamTaskEvents = async (req: ServerRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (userId == null) {
      fail(res, 401, 'unauthorized', 'Authentication is required');
      return;
    }
    const parsed = superAgentTaskParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      fail(res, 400, 'invalid_request', 'Task id is invalid');
      return;
    }
    const task = await deps.store.get(userId, parsed.data.id, tenantOf(req));
    if (task == null) {
      fail(res, 404, 'task_not_found', 'Task not found');
      return;
    }

    res.setHeader('Content-Encoding', 'identity');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    const write = (value: unknown): void => {
      if (closed || res.writableEnded || res.destroyed) {
        return;
      }
      res.write(`data: ${JSON.stringify(value)}\n\n`);
    };
    const close = (): void => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
    };
    let unsubscribe = () => {};
    const heartbeat = setInterval(() => {
      if (!closed && !res.writableEnded) {
        res.write(': keep-alive\n\n');
      }
    }, 15_000);
    heartbeat.unref?.();
    unsubscribe = deps.events.subscribe(task.id, (next) => write({ task: next }));
    req.once('aborted', close);
    res.once('close', close);
    const latest = (await deps.store.get(userId, task.id, tenantOf(req))) ?? task;
    write({ task: latest });
    if (['completed', 'failed', 'cancelled'].includes(latest.status)) {
      close();
    }
  };

  const cancelTask = async (req: ServerRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (userId == null) {
      fail(res, 401, 'unauthorized', 'Authentication is required');
      return;
    }
    const parsed = superAgentTaskParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      fail(res, 400, 'invalid_request', 'Task id is invalid');
      return;
    }
    try {
      const task = await deps.orchestrator.cancel(userId, parsed.data.id, tenantOf(req));
      if (task == null) {
        fail(res, 404, 'task_not_found', 'Task not found');
        return;
      }
      res.status(200).json({ task });
    } catch {
      fail(res, 500, 'internal_error', 'Failed to cancel task');
    }
  };

  const listWorkers = async (req: ServerRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (userId == null) {
      fail(res, 401, 'unauthorized', 'Authentication is required');
      return;
    }
    try {
      const workers = await deps.listWorkers({
        userId,
        role: req.user?.role,
        tenantId: tenantOf(req),
      });
      res.status(200).json({ workers: workers.map(toWorkerRecord) });
    } catch {
      fail(res, 503, 'workers_unavailable', 'Agent catalog is temporarily unavailable');
    }
  };

  const updateWorker = async (req: ServerRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (userId == null) {
      fail(res, 401, 'unauthorized', 'Authentication is required');
      return;
    }
    const params = superAgentWorkerParamsSchema.safeParse(req.params);
    const body = updateSuperAgentWorkerSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      fail(res, 400, 'invalid_request', 'Worker settings are invalid');
      return;
    }
    try {
      const worker = await deps.upsertWorker({
        userId,
        role: req.user?.role,
        tenantId: tenantOf(req),
        agentId: params.data.agentId,
        input: body.data,
      });
      if (worker == null) {
        fail(res, 403, 'agent_not_accessible', 'Worker agent is not accessible');
        return;
      }
      res.status(200).json({ worker: toWorkerRecord(worker) });
    } catch {
      fail(res, 500, 'internal_error', 'Failed to save worker settings');
    }
  };

  const deleteWorker = async (req: ServerRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (userId == null) {
      fail(res, 401, 'unauthorized', 'Authentication is required');
      return;
    }
    const params = superAgentWorkerParamsSchema.safeParse(req.params);
    if (!params.success) {
      fail(res, 400, 'invalid_request', 'Worker id is invalid');
      return;
    }
    try {
      const worker = await deps.deleteWorker({
        userId,
        role: req.user?.role,
        tenantId: tenantOf(req),
        agentId: params.data.agentId,
      });
      if (worker == null) {
        fail(res, 404, 'worker_not_found', 'Worker agent is not accessible');
        return;
      }
      res.status(200).json({ worker: toWorkerRecord(worker) });
    } catch {
      fail(res, 500, 'internal_error', 'Failed to reset worker settings');
    }
  };

  const trinityHealth = async (req: ServerRequest, res: Response): Promise<void> => {
    if (req.user?.id == null) {
      fail(res, 401, 'unauthorized', 'Authentication is required');
      return;
    }
    const configTrinity = req.config?.trinity;
    const trinity = deps.trinity;
    const enabled =
      configTrinity?.enabled === true ||
      (configTrinity?.url != null && configTrinity.url !== '') ||
      trinity?.enabled === true;
    if (!enabled) {
      res.status(200).json({ enabled: false, ok: false });
      return;
    }
    try {
      const result = await trinity?.probe?.({
        url: configTrinity?.url ?? trinity?.url,
        apiKey: configTrinity?.apiKey ?? trinity?.apiKey,
        timeoutMs: configTrinity?.timeoutMs ?? trinity?.timeoutMs,
      });
      res.status(200).json({ enabled: true, ok: result?.ok === true, message: result?.message });
    } catch {
      res.status(200).json({ enabled: true, ok: false });
    }
  };

  return {
    createTask,
    listTasks,
    getTask,
    cancelTask,
    streamTaskEvents,
    trinityHealth,
    listWorkers,
    updateWorker,
    deleteWorker,
  };
}
