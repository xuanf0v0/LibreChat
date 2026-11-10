const { logger } = require('@librechat/data-schemas');
const {
  createSuperAgentExecutor,
  createTrinityExecutor,
  createSuperAgentPlanner,
  createSuperAgentEvaluator,
  createSuperAgentOrchestrator,
  createSuperAgentHandlers,
  createSuperAgentTaskEvents,
} = require('@librechat/api');
const { ResourceType, PermissionBits } = require('librechat-data-provider');
const { findAccessibleResources } = require('~/server/services/PermissionService');
const { getAppConfig } = require('~/server/services/Config');
const { probeTrinity, resolveConfigSecret } = require('@librechat/api');
const { invokeAgent } = require('./executor');
const db = require('~/models');

const WORKER_DEFAULTS = {
  maxSteps: 25,
  timeoutMs: 300_000,
  maxConcurrentRuns: 1,
  maxRunsPerTask: 4,
};

async function listAccessibleWorkers({ userId, role, tenantId }) {
  const ids = await findAccessibleResources({
    userId,
    role,
    resourceType: ResourceType.AGENT,
    requiredPermissions: PermissionBits.VIEW,
  });
  if (ids.length === 0) {
    return [];
  }
  const [agents, overrides] = await Promise.all([
    db.getAgents(
      { _id: { $in: ids }, isArchived: { $ne: true } },
      'id name description category tools',
    ),
    db.listSuperAgentWorkers(userId, tenantId),
  ]);
  const byAgent = new Map(overrides.map((worker) => [worker.agentId, worker]));
  return agents.map((agent) => {
    const override = byAgent.get(agent.id);
    const agentTools = Array.isArray(agent.tools) ? agent.tools : undefined;
    const allowedTools = override?.allowedTools === undefined ? null : override.allowedTools;
    const effectiveTools = allowedTools == null ? agentTools : allowedTools;
    const derived = [
      ...(agent.category == null ? [] : [agent.category]),
      ...(effectiveTools ?? []),
    ];
    const capabilities =
      override?.capabilities != null && override.capabilities.length > 0
        ? override.capabilities
        : [...new Set(derived)];
    return {
      id: agent.id,
      name: agent.name ?? agent.id,
      description: agent.description ?? undefined,
      category: agent.category ?? undefined,
      capabilities: capabilities.length === 0 ? undefined : capabilities,
      tools: effectiveTools,
      allowedTools,
      maxSteps: override?.maxSteps ?? WORKER_DEFAULTS.maxSteps,
      timeoutMs: override?.timeoutMs ?? WORKER_DEFAULTS.timeoutMs,
      maxConcurrentRuns: override?.maxConcurrentRuns ?? WORKER_DEFAULTS.maxConcurrentRuns,
      maxRunsPerTask: override?.maxRunsPerTask ?? WORKER_DEFAULTS.maxRunsPerTask,
      trinityAgentName: override?.trinityAgentName ?? null,
      customized: override != null,
      enabled: override?.enabled ?? true,
    };
  });
}

async function upsertWorker({ userId, role, tenantId, agentId, input }) {
  await db.upsertSuperAgentWorker(userId, agentId, input, tenantId);
  const workers = await listAccessibleWorkers({ userId, role, tenantId });
  return workers.find((worker) => worker.id === agentId) ?? null;
}

async function deleteWorker({ userId, role, tenantId, agentId }) {
  await db.deleteSuperAgentWorker(userId, agentId, tenantId);
  const workers = await listAccessibleWorkers({ userId, role, tenantId });
  return workers.find((worker) => worker.id === agentId) ?? null;
}

const repository = {
  get: (userId, taskId, tenantId) => db.getSuperAgentTask(userId, taskId, tenantId),
  list: (userId, options) => db.listSuperAgentTasks(userId, options),
  update: (userId, taskId, expectedVersion, update, tenantId) =>
    db.updateSuperAgentTask(userId, taskId, expectedVersion, update, tenantId),
  listRecoverable: (olderThan) => db.listRecoverableSuperAgentTasks(olderThan),
  create: ({
    userId,
    id,
    tenantId,
    goal,
    plannerAgentId,
    evaluatorAgentId,
    workerAgentIds,
    maxWorkers,
    replans,
    usage,
    policy,
    status,
  }) =>
    db.createSuperAgentTask(
      userId,
      {
        id,
        goal,
        plannerAgentId,
        evaluatorAgentId,
        workerAgentIds,
        maxWorkers,
        replans,
        usage,
        policy,
        status,
      },
      tenantId,
    ),
};

const localExecutor = createSuperAgentExecutor(invokeAgent);
const envTrinity = {
  enabled: process.env.TRINITY_ENABLED === 'true',
  url: process.env.TRINITY_URL,
  apiKey: process.env.TRINITY_API_KEY ?? '',
  agentName: process.env.TRINITY_AGENT_NAME,
  timeoutMs: Number(process.env.TRINITY_TIMEOUT_MS ?? 300_000),
};

/** Resolves the worker executor from the task owner's merged config, falling back to env. */
async function resolveWorkerExecutor(input) {
  try {
    const config = await getAppConfig({
      userId: input.userId,
      ...(input.tenantId == null ? {} : { tenantId: input.tenantId }),
    });
    const trinity = config?.trinity;
    const url = trinity?.enabled === true ? trinity.url : undefined;
    if (url != null && url !== '') {
      return createTrinityExecutor({
        url,
        apiKey: resolveConfigSecret(trinity.apiKey) ?? '',
        ...(trinity.agentName == null ? {} : { agentName: trinity.agentName }),
        timeoutMs: trinity.timeoutMs,
      });
    }
  } catch (error) {
    logger.warn('[superagent] Failed to read Trinity config, using the local executor', error);
  }
  if (envTrinity.enabled && envTrinity.url != null) {
    return createTrinityExecutor(envTrinity);
  }
  return localExecutor;
}

/** Workers may run on Trinity; planning and evaluation stay in-process. */
const executor = {
  async execute(input) {
    if (input.role != null && input.role !== 'worker') {
      return localExecutor.execute(input);
    }
    return (await resolveWorkerExecutor(input)).execute(input);
  },
};
const planner = createSuperAgentPlanner({ executor: localExecutor });
const evaluator = createSuperAgentEvaluator({ executor: localExecutor });
const events = createSuperAgentTaskEvents();
const orchestrator = createSuperAgentOrchestrator({
  repository,
  executor,
  planner,
  evaluator,
  events,
  logger,
  loadWorkers: async (task) => {
    const user = await db.findUser({ _id: task.userId });
    const workers = await listAccessibleWorkers({
      userId: task.userId,
      role: user?.role,
      tenantId: task.tenantId,
    });
    const allowed = new Set(task.workerAgentIds);
    return workers.filter((worker) => worker.enabled !== false && allowed.has(worker.id));
  },
});

const handlers = createSuperAgentHandlers({
  store: repository,
  orchestrator,
  listWorkers: listAccessibleWorkers,
  upsertWorker,
  deleteWorker,
  events,
  trinity: {
    enabled: process.env.TRINITY_ENABLED === 'true' || Boolean(process.env.TRINITY_URL),
    url: process.env.TRINITY_URL,
    apiKey: process.env.TRINITY_API_KEY,
    agentName: process.env.TRINITY_AGENT_NAME,
    timeoutMs: Number(process.env.TRINITY_TIMEOUT_MS ?? 300_000),
    probe: async (config) => {
      const url = config?.url ?? process.env.TRINITY_URL;
      if (!url) {
        return { ok: false, message: 'TRINITY_URL is not configured' };
      }
      return probeTrinity({
        url,
        apiKey: resolveConfigSecret(config?.apiKey) ?? process.env.TRINITY_API_KEY ?? '',
        timeoutMs: config?.timeoutMs ?? Number(process.env.TRINITY_TIMEOUT_MS ?? 300_000),
      });
    },
  },
  limits: {
    maxActiveTasks: 3,
    maxWorkers: 3,
    maxNodes: 12,
    defaultMaxSteps: 25,
    defaultTimeoutMs: 300_000,
    defaultMaxReplans: 1,
    defaultMaxTokens: 200_000,
    defaultMaxDurationMs: 3_600_000,
    defaultPlannerMaxTokens: 40_000,
    defaultWorkerMaxTokens: 160_000,
    defaultEvaluatorMaxTokens: 40_000,
  },
});

async function recoverSuperAgentTasks() {
  try {
    const count = await orchestrator.recover();
    if (count > 0) {
      logger.info(`[superagent] Resumed ${count} unfinished task(s)`);
    }
  } catch (error) {
    logger.error('[superagent] Failed to recover unfinished tasks', error);
  }
}

module.exports = { handlers, recoverSuperAgentTasks };
