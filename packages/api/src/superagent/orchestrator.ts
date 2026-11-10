import type { SuperAgentNode, SuperAgentTask, SuperAgentTaskStatus } from 'librechat-data-provider';
import type {
  SuperAgentAgentExecutor,
  SuperAgentLogger,
  SuperAgentTaskRepository,
  SuperAgentWorker,
} from './types';
import type { SuperAgentPlanner } from './planner';
import type { SuperAgentEvaluator } from './evaluator';
import type { SuperAgentTaskEvents } from './events';
import {
  advanceNodes,
  applyWorkerPolicies,
  isTerminalNode,
  readyNodes,
  runningCount,
  summarizeTask,
} from './plan';

const DEFAULT_MAX_WORKERS = 3;
const DEFAULT_WORKER_TIMEOUT_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 250;
const MAX_RESULT_CHARS = 8_000;

interface ActiveRun {
  abort: AbortController;
  executions: Map<string, Promise<void>>;
}

export interface SuperAgentOrchestratorDeps {
  repository: SuperAgentTaskRepository;
  executor: SuperAgentAgentExecutor;
  planner: SuperAgentPlanner;
  evaluator: SuperAgentEvaluator;
  loadWorkers: (task: SuperAgentTask) => Promise<SuperAgentWorker[]>;
  logger?: SuperAgentLogger;
  events?: SuperAgentTaskEvents;
  maxWorkers?: number;
  workerTimeoutMs?: number;
  retryDelayMs?: number;
  pollIntervalMs?: number;
  now?: () => Date;
}

export interface SuperAgentOrchestrator {
  start(taskId: string, userId: string, tenantId?: string): void;
  cancel(taskId: string, userId: string, tenantId?: string): Promise<SuperAgentTask | null>;
  recover(): Promise<number>;
  isActive(taskId: string): boolean;
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message.slice(0, 2_000);
  }
  return 'Agent execution failed';
}

function nodePrompt(task: SuperAgentTask, node: SuperAgentNode): string {
  const dependencies = node.dependencies
    .map((id) => task.nodes.find((candidate) => candidate.id === id))
    .filter((dependency): dependency is SuperAgentNode => dependency != null)
    .map((dependency) => {
      const content = dependency.result?.content ?? '';
      return `### ${dependency.id}\n${content.slice(0, MAX_RESULT_CHARS)}`;
    });

  return [
    'You are one worker in a multi-agent task. Complete only the assigned task.',
    '',
    `Overall goal:\n${task.goal}`,
    '',
    `Your task:\n${node.goal}`,
    ...(node.acceptanceCriteria.length === 0
      ? []
      : [
          '',
          `Acceptance criteria:\n${node.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}`,
        ]),
    ...(dependencies.length === 0
      ? []
      : ['', `Completed upstream results:\n${dependencies.join('\n\n')}`]),
    '',
    'Return the deliverable itself. Do not describe what you are about to do.',
  ].join('\n');
}

export function createSuperAgentOrchestrator(
  deps: SuperAgentOrchestratorDeps,
): SuperAgentOrchestrator {
  const logger = deps.logger ?? {
    info() {},
    warn() {},
    error() {},
  };
  const maxWorkers = deps.maxWorkers ?? DEFAULT_MAX_WORKERS;
  const workerTimeoutMs = deps.workerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
  const retryDelayMs = deps.retryDelayMs ?? 1_000;
  const pollIntervalMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
  const now = deps.now ?? (() => new Date());
  const active = new Map<string, ActiveRun>();
  const runningByAgent = new Map<string, number>();

  async function mutate(
    task: SuperAgentTask,
    update: (latest: SuperAgentTask) => {
      status?: SuperAgentTaskStatus;
      nodes?: SuperAgentNode[];
      replans?: number;
      replanFeedback?: string | null;
      errorCode?: string | null;
      usage?: SuperAgentTask['usage'];
      usageEvents?: SuperAgentTask['usageEvents'];
      error?: string | null;
      completedAt?: Date | null;
    } | null,
  ): Promise<SuperAgentTask | null> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const latest = await deps.repository.get(task.userId, task.id, task.tenantId);
      if (latest == null) {
        return null;
      }
      const next = update(latest);
      if (next == null) {
        return latest;
      }
      const saved = await deps.repository.update(
        latest.userId,
        latest.id,
        latest.version,
        next,
        latest.tenantId,
      );
      if (saved != null) {
        deps.events?.publish(saved);
        return saved;
      }
    }
    throw new Error('Task changed too often while updating');
  }

  function appendUsage(
    events: SuperAgentTask['usageEvents'],
    event: SuperAgentTask['usageEvents'][number],
  ): SuperAgentTask['usageEvents'] {
    return [...events, event].slice(-200);
  }

  async function setNode(
    task: SuperAgentTask,
    nodeId: string,
    change: Partial<SuperAgentNode>,
  ): Promise<void> {
    await mutate(task, (latest) => ({
      nodes: latest.nodes.map((node) => (node.id === nodeId ? { ...node, ...change } : node)),
    }));
  }

  async function executeNode(
    task: SuperAgentTask,
    node: SuperAgentNode,
    abort: AbortController,
  ): Promise<void> {
    const timeoutMs = node.timeoutMs ?? task.policy?.timeoutMs ?? workerTimeoutMs;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([abort.signal, timeoutSignal]);
    try {
      const result = await deps.executor.execute({
        agentId: node.agentId,
        goal: nodePrompt(task, node),
        taskId: task.id,
        nodeId: node.id,
        userId: task.userId,
        tenantId: task.tenantId,
        signal,
        timeoutMs,
        allowedTools: node.allowedTools ?? task.policy?.allowedTools ?? null,
        maxSteps: node.maxSteps ?? task.policy?.maxSteps,
        role: 'worker',
        trinityAgentName: node.trinityAgentName ?? null,
      });
      if (abort.signal.aborted) {
        await setNode(task, node.id, {
          status: 'cancelled',
          error: 'Task cancelled',
          completedAt: new Date().toISOString(),
        });
        return;
      }
      await setNode(task, node.id, {
        status: 'evaluating',
        result,
        error: undefined,
      });
      const evaluation = await deps.evaluator.evaluate({
        task,
        node: { ...node, result },
        signal,
      });
      if (abort.signal.aborted) {
        await setNode(task, node.id, {
          status: 'cancelled',
          error: 'Task cancelled',
          completedAt: new Date().toISOString(),
        });
        return;
      }
      if (evaluation.usage != null) {
        await mutate(task, (latest) => {
          const evaluatorUsage = {
            promptTokens:
              (latest.usage.evaluator?.promptTokens ?? 0) + evaluation.usage!.promptTokens,
            completionTokens:
              (latest.usage.evaluator?.completionTokens ?? 0) + evaluation.usage!.completionTokens,
            totalTokens: (latest.usage.evaluator?.totalTokens ?? 0) + evaluation.usage!.totalTokens,
          };
          return {
            usage: {
              ...latest.usage,
              promptTokens: latest.usage.promptTokens + evaluation.usage!.promptTokens,
              completionTokens: latest.usage.completionTokens + evaluation.usage!.completionTokens,
              totalTokens: latest.usage.totalTokens + evaluation.usage!.totalTokens,
              evaluator: evaluatorUsage,
            },
            usageEvents: appendUsage(latest.usageEvents, {
              role: 'evaluator',
              agentId: task.evaluatorAgentId,
              nodeId: node.id,
              promptTokens: evaluation.usage!.promptTokens,
              completionTokens: evaluation.usage!.completionTokens,
              totalTokens: evaluation.usage!.totalTokens,
              durationMs: 0,
              at: new Date().toISOString(),
            }),
          };
        });
      }
      if (evaluation.passed === false) {
        const latest = await deps.repository.get(task.userId, task.id, task.tenantId);
        const current = latest?.nodes.find((candidate) => candidate.id === node.id);
        const attempts = current?.attempts ?? node.attempts;
        if (attempts < (current?.maxAttempts ?? node.maxAttempts)) {
          logger.warn(`[superagent] Evaluator rejected node ${node.id}`, {
            taskId: task.id,
            attempts,
          });
          await sleep(retryDelayMs);
          await setNode(task, node.id, {
            status: 'ready',
            evaluation,
            error: evaluation.feedback ?? evaluation.reason,
          });
          return;
        }
        await setNode(task, node.id, {
          status: 'failed',
          evaluation,
          error: evaluation.feedback ?? evaluation.reason,
          completedAt: new Date().toISOString(),
        });
        return;
      }
      await setNode(task, node.id, {
        status: 'completed',
        evaluation,
        error: undefined,
        completedAt: new Date().toISOString(),
      });
      const tokenUsage = result.tokenUsage;
      const costUsd = result.costUsd;
      const contextUsed = result.contextUsed;
      const contextMax = result.contextMax;
      if (tokenUsage != null || costUsd != null || contextUsed != null) {
        const usage = tokenUsage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        await mutate(task, (latest) => {
          const add = (base: typeof latest.usage.planner) => ({
            promptTokens: (base?.promptTokens ?? 0) + usage.promptTokens,
            completionTokens: (base?.completionTokens ?? 0) + usage.completionTokens,
            totalTokens: (base?.totalTokens ?? 0) + usage.totalTokens,
          });
          return {
            usage: {
              promptTokens: latest.usage.promptTokens + usage.promptTokens,
              completionTokens: latest.usage.completionTokens + usage.completionTokens,
              totalTokens: latest.usage.totalTokens + usage.totalTokens,
              ...(costUsd == null ? {} : { costUsd: (latest.usage.costUsd ?? 0) + costUsd }),
              planner: latest.usage.planner,
              worker: add(latest.usage.worker),
              evaluator: latest.usage.evaluator,
            },
            usageEvents: appendUsage(latest.usageEvents, {
              role: 'worker',
              agentId: node.agentId,
              nodeId: node.id,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
              durationMs:
                result.durationMs ??
                Math.max(0, Date.now() - new Date(node.startedAt ?? Date.now()).getTime()),
              ...(costUsd == null ? {} : { costUsd }),
              ...(contextUsed == null ? {} : { contextUsed }),
              ...(contextMax == null ? {} : { contextMax }),
              at: new Date().toISOString(),
            }),
          };
        });
      }
    } catch (error) {
      if (abort.signal.aborted) {
        await setNode(task, node.id, {
          status: 'cancelled',
          error: 'Task cancelled',
          completedAt: new Date().toISOString(),
        });
        return;
      }
      const message = errorMessage(error);
      const latest = await deps.repository.get(task.userId, task.id, task.tenantId);
      const current = latest?.nodes.find((candidate) => candidate.id === node.id);
      const attempts = current?.attempts ?? node.attempts;
      if (attempts < (current?.maxAttempts ?? node.maxAttempts)) {
        logger.warn(`[superagent] Retrying node ${node.id}`, { taskId: task.id, attempts });
        await sleep(retryDelayMs);
        await setNode(task, node.id, { status: 'ready', error: message });
        return;
      }
      await setNode(task, node.id, {
        status: 'failed',
        error: message,
        completedAt: new Date().toISOString(),
      });
    }
  }

  async function planTask(task: SuperAgentTask, abort: AbortController): Promise<SuperAgentTask> {
    const workers = await deps.loadWorkers(task);
    const plan = await deps.planner.createPlan({ task, workers, signal: abort.signal });
    const resolvedNodes = applyWorkerPolicies(plan.nodes, task.policy, workers);
    const saved = await mutate(task, () => ({
      nodes: resolvedNodes,
      status: 'running',
      error: null,
      ...(plan.usage == null
        ? {}
        : {
            usage: {
              ...task.usage,
              promptTokens: task.usage.promptTokens + plan.usage.promptTokens,
              completionTokens: task.usage.completionTokens + plan.usage.completionTokens,
              totalTokens: task.usage.totalTokens + plan.usage.totalTokens,
              planner: plan.usage,
            },
            usageEvents: appendUsage(task.usageEvents, {
              role: 'planner',
              agentId: task.plannerAgentId,
              nodeId: 'planner',
              promptTokens: plan.usage.promptTokens,
              completionTokens: plan.usage.completionTokens,
              totalTokens: plan.usage.totalTokens,
              durationMs: 0,
              at: new Date().toISOString(),
            }),
          }),
    }));
    if (saved == null) {
      throw new Error('Task disappeared while planning');
    }
    return saved;
  }

  async function run(
    taskId: string,
    userId: string,
    tenantId: string | undefined,
    activeRun: ActiveRun,
  ) {
    let task = await deps.repository.get(userId, taskId, tenantId);
    if (
      task == null ||
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'cancelled'
    ) {
      return;
    }
    if (task.status === 'planning' && task.nodes.length === 0) {
      task = await planTask(task, activeRun.abort);
    }

    while (!activeRun.abort.signal.aborted) {
      task = await deps.repository.get(userId, taskId, tenantId);
      if (task == null) {
        return;
      }
      if (task.status === 'cancelled') {
        activeRun.abort.abort();
        return;
      }
      const startedAt = task.createdAt ? new Date(task.createdAt).getTime() : now().getTime();
      if (now().getTime() - startedAt >= task.policy.maxDurationMs) {
        activeRun.abort.abort();
        const timedOut = await mutate(task, () => ({
          status: 'failed',
          errorCode: 'budget_duration_exceeded',
          error: 'Task duration budget exceeded',
          completedAt: new Date(),
        }));
        if (timedOut != null) {
          deps.events?.publish(timedOut);
        }
        return;
      }
      if ((task.usage.planner?.totalTokens ?? 0) >= task.policy.plannerMaxTokens) {
        activeRun.abort.abort();
        const exhausted = await mutate(task, () => ({
          status: 'failed',
          errorCode: 'budget_planner_exceeded',
          error: 'Planner token budget exceeded',
          completedAt: new Date(),
        }));
        if (exhausted != null) {
          deps.events?.publish(exhausted);
        }
        return;
      }
      if ((task.usage.worker?.totalTokens ?? 0) >= task.policy.workerMaxTokens) {
        activeRun.abort.abort();
        const exhausted = await mutate(task, () => ({
          status: 'failed',
          errorCode: 'budget_worker_exceeded',
          error: 'Worker token budget exceeded',
          completedAt: new Date(),
        }));
        if (exhausted != null) {
          deps.events?.publish(exhausted);
        }
        return;
      }
      if ((task.usage.evaluator?.totalTokens ?? 0) >= task.policy.evaluatorMaxTokens) {
        activeRun.abort.abort();
        const exhausted = await mutate(task, () => ({
          status: 'failed',
          errorCode: 'budget_evaluator_exceeded',
          error: 'Evaluator token budget exceeded',
          completedAt: new Date(),
        }));
        if (exhausted != null) {
          deps.events?.publish(exhausted);
        }
        return;
      }
      if (task.usage.totalTokens >= task.policy.maxTokens) {
        activeRun.abort.abort();
        const exhausted = await mutate(task, () => ({
          status: 'failed',
          errorCode: 'budget_tokens_exceeded',
          error: 'Task token budget exceeded',
          completedAt: new Date(),
        }));
        if (exhausted != null) {
          deps.events?.publish(exhausted);
        }
        return;
      }

      const advanced = advanceNodes(task.nodes);
      if (JSON.stringify(advanced) !== JSON.stringify(task.nodes)) {
        task = (await mutate(task, () => ({ nodes: advanced }))) ?? task;
      }

      const summary = summarizeTask(task.nodes);
      if (summary.done) {
        if (summary.failed && task.replans < task.policy.maxReplans) {
          const feedback = task.nodes
            .filter((node) => node.status === 'failed' || node.status === 'blocked')
            .map((node) => `### ${node.id}: ${node.goal}\n${node.error ?? 'Failed'}`)
            .join('\n\n')
            .slice(0, 8_000);
          const replans = task.replans + 1;
          const replannedTask = await mutate(task, () => ({
            status: 'planning',
            nodes: [],
            replans,
            replanFeedback: feedback,
            error: null,
          }));
          if (replannedTask != null) {
            deps.events?.publish(replannedTask);
          }
          const replanned = (await deps.repository.get(userId, taskId, tenantId)) ?? task;
          task = await planTask(replanned, activeRun.abort);
        } else {
          const status: SuperAgentTaskStatus = summary.failed ? 'failed' : 'completed';
          await mutate(task, () => ({
            status,
            completedAt: new Date(),
            error: summary.failed ? 'One or more tasks failed' : null,
          }));
          return;
        }
      }

      const ready = readyNodes(task.nodes).filter((node) => !activeRun.executions.has(node.id));
      const effectiveMaxWorkers = task.maxWorkers ?? maxWorkers;
      const slots = Math.max(effectiveMaxWorkers - runningCount(task.nodes), 0);
      const available = ready.filter(
        (node) => (runningByAgent.get(node.agentId) ?? 0) < (node.maxConcurrentRuns ?? 1),
      );
      for (const node of available.slice(0, slots)) {
        const currentRuns = runningByAgent.get(node.agentId) ?? 0;
        if (currentRuns >= (node.maxConcurrentRuns ?? 1)) {
          continue;
        }
        const started = await mutate(task, (latest) => {
          const current = latest.nodes.find((candidate) => candidate.id === node.id);
          if (current == null || current.status !== 'ready') {
            return null;
          }
          return {
            nodes: latest.nodes.map((candidate) =>
              candidate.id === node.id
                ? {
                    ...candidate,
                    status: 'running',
                    attempts: candidate.attempts + 1,
                    startedAt: new Date().toISOString(),
                    error: undefined,
                  }
                : candidate,
            ),
          };
        });
        if (started == null) {
          continue;
        }
        task = started;
        runningByAgent.set(node.agentId, currentRuns + 1);
        const execution = executeNode(started, node, activeRun.abort).finally(() => {
          activeRun.executions.delete(node.id);
          const remaining = (runningByAgent.get(node.agentId) ?? 1) - 1;
          if (remaining <= 0) {
            runningByAgent.delete(node.agentId);
          } else {
            runningByAgent.set(node.agentId, remaining);
          }
        });
        activeRun.executions.set(node.id, execution);
      }

      if (activeRun.executions.size === 0 && ready.length === 0) {
        const stuck = task.nodes.some((node) => !isTerminalNode(node) && node.status !== 'running');
        if (stuck) {
          const nodes = task.nodes;
          await mutate(task, () => ({
            status: 'failed',
            error: 'Task graph cannot make progress',
            nodes: nodes.map((node) =>
              isTerminalNode(node) ? node : { ...node, status: 'blocked' as const },
            ),
            completedAt: new Date(),
          }));
        }
        return;
      }

      await sleep(pollIntervalMs);
    }
  }

  function start(taskId: string, userId: string, tenantId?: string): void {
    if (active.has(taskId)) {
      return;
    }
    const activeRun: ActiveRun = { abort: new AbortController(), executions: new Map() };
    active.set(taskId, activeRun);
    void run(taskId, userId, tenantId, activeRun)
      .catch(async (error) => {
        logger.error('[superagent] Task run failed', { taskId, error });
        try {
          const task = await deps.repository.get(userId, taskId, tenantId);
          if (task != null && task.status !== 'cancelled' && task.status !== 'completed') {
            const failed = await deps.repository.update(
              userId,
              taskId,
              task.version,
              {
                status: 'failed',
                error: errorMessage(error),
                completedAt: new Date(),
              },
              tenantId,
            );
            if (failed != null) {
              deps.events?.publish(failed);
            }
          }
        } catch (persistError) {
          logger.error('[superagent] Failed to persist task failure', { taskId, persistError });
        }
      })
      .finally(() => {
        active.delete(taskId);
      });
  }

  async function cancel(
    taskId: string,
    userId: string,
    tenantId?: string,
  ): Promise<SuperAgentTask | null> {
    const activeRun = active.get(taskId);
    activeRun?.abort.abort();
    const task = await deps.repository.get(userId, taskId, tenantId);
    if (task == null || task.status === 'completed' || task.status === 'failed') {
      return task;
    }
    return await mutate(task, (latest) => ({
      status: 'cancelled',
      error: null,
      completedAt: new Date(),
      nodes: latest.nodes.map((node) =>
        node.status === 'completed'
          ? node
          : { ...node, status: 'cancelled' as const, completedAt: new Date().toISOString() },
      ),
    }));
  }

  async function recover(): Promise<number> {
    // ponytail: boot-time recovery assumes a single API replica; add a lease
    // before running multiple replicas against the same database.
    const tasks = await deps.repository.listRecoverable(new Date(0));
    let resumed = 0;
    for (const task of tasks) {
      if (active.has(task.id)) {
        continue;
      }
      const nodes = task.nodes.map((node) => {
        if (node.status !== 'running') {
          return node;
        }
        if (node.attempts >= node.maxAttempts) {
          return {
            ...node,
            status: 'failed' as const,
            error: 'Interrupted after the last allowed attempt',
            completedAt: new Date().toISOString(),
          };
        }
        return { ...node, status: 'pending' as const, error: 'Resumed after restart' };
      });
      const saved = await deps.repository.update(
        task.userId,
        task.id,
        task.version,
        {
          status: nodes.length === 0 ? 'planning' : 'pending',
          nodes,
        },
        task.tenantId,
      );
      if (saved != null) {
        resumed += 1;
        start(saved.id, saved.userId, saved.tenantId);
      }
    }
    return resumed;
  }

  return {
    start,
    cancel,
    recover,
    isActive: (taskId) => active.has(taskId),
  };
}
