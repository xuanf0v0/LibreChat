import type { SuperAgentTask } from 'librechat-data-provider';
import type { SuperAgentAgentExecutor, SuperAgentTaskRepository } from './types';
import { createSuperAgentOrchestrator } from './orchestrator';
import type { SuperAgentPlanner } from './planner';
import type { SuperAgentEvaluator } from './evaluator';

function makeTask(overrides: Partial<SuperAgentTask> = {}): SuperAgentTask {
  const now = new Date().toISOString();
  return {
    id: 'task-1',
    userId: 'user-1',
    goal: 'Ship the thing',
    plannerAgentId: 'planner',
    evaluatorAgentId: 'planner',
    workerAgentIds: ['worker-a', 'worker-b'],
    status: 'planning',
    maxWorkers: 2,
    replans: 0,
    policy: {
      allowedTools: null,
      maxSteps: 25,
      timeoutMs: 300_000,
      maxNodes: 12,
      maxReplans: 1,
      maxTokens: 200_000,
      plannerMaxTokens: 40_000,
      workerMaxTokens: 160_000,
      evaluatorMaxTokens: 40_000,
      maxDurationMs: 3_600_000,
    },
    usageEvents: [],
    usage: {
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      planner: { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
      worker: { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
      evaluator: { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
    },
    version: 0,
    nodes: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createRepository(initial: SuperAgentTask) {
  let task = initial;
  const repository: SuperAgentTaskRepository & {
    create: (input: never) => Promise<never>;
  } = {
    async get(userId, taskId) {
      return task.id === taskId && task.userId === userId ? task : null;
    },
    async list() {
      return [task];
    },
    async update(_userId, _taskId, expectedVersion, update) {
      if (task.version !== expectedVersion) {
        return null;
      }
      task = {
        ...task,
        ...update,
        version: task.version + 1,
        updatedAt: new Date().toISOString(),
        ...(update.completedAt === null ? { completedAt: undefined } : {}),
      } as SuperAgentTask;
      return task;
    },
    async listRecoverable() {
      return [];
    },
    create: async () => {
      throw new Error('unused');
    },
  };
  return {
    repository,
    getTask: () => task,
  };
}

const evaluator: SuperAgentEvaluator = {
  async evaluate() {
    return { passed: true, reason: 'ok' };
  },
};

const planner: SuperAgentPlanner = {
  async createPlan() {
    return {
      nodes: [
        {
          id: 'a',
          goal: 'A',
          agentId: 'worker-a',
          dependencies: [],
          acceptanceCriteria: [],
          status: 'ready',
          attempts: 0,
          maxAttempts: 2,
        },
        {
          id: 'b',
          goal: 'B',
          agentId: 'worker-b',
          dependencies: [],
          acceptanceCriteria: [],
          status: 'ready',
          attempts: 0,
          maxAttempts: 2,
        },
        {
          id: 'c',
          goal: 'C',
          agentId: 'worker-a',
          dependencies: ['a', 'b'],
          acceptanceCriteria: [],
          status: 'pending',
          attempts: 0,
          maxAttempts: 2,
        },
      ],
    };
  },
};

async function waitForTerminal(
  getTask: () => SuperAgentTask,
  timeoutMs = 2_000,
): Promise<SuperAgentTask> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = getTask();
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Task did not settle');
}

describe('SuperAgentOrchestrator', () => {
  it('runs independent nodes in parallel and waits for dependencies', async () => {
    const { repository, getTask } = createRepository(makeTask());
    const started: string[] = [];
    const executor: SuperAgentAgentExecutor = {
      async execute(input) {
        started.push(input.nodeId);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { content: `result:${input.nodeId}` };
      },
    };
    const orchestrator = createSuperAgentOrchestrator({
      repository,
      executor,
      planner,
      evaluator,
      loadWorkers: async () => [
        { id: 'worker-a', name: 'A' },
        { id: 'worker-b', name: 'B' },
      ],
      pollIntervalMs: 5,
      retryDelayMs: 5,
    });

    orchestrator.start('task-1', 'user-1');
    const task = await waitForTerminal(getTask);

    expect(task.status).toBe('completed');
    expect(task.nodes.every((node) => node.status === 'completed')).toBe(true);
    expect(started.indexOf('c')).toBeGreaterThan(started.indexOf('a'));
    expect(started.indexOf('c')).toBeGreaterThan(started.indexOf('b'));
    expect(task.nodes[2].result?.content).toBe('result:c');
  });

  it('records provider cost and duration on the usage ledger', async () => {
    const { repository, getTask } = createRepository(makeTask());
    const executor: SuperAgentAgentExecutor = {
      async execute() {
        return {
          content: 'done',
          tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          durationMs: 4_321,
          costUsd: 0.25,
        };
      },
    };
    const singleNodePlanner: SuperAgentPlanner = {
      async createPlan() {
        return {
          nodes: [
            {
              id: 'a',
              goal: 'A',
              agentId: 'worker-a',
              dependencies: [],
              acceptanceCriteria: [],
              status: 'ready',
              attempts: 0,
              maxAttempts: 2,
            },
          ],
        };
      },
    };
    const orchestrator = createSuperAgentOrchestrator({
      repository,
      executor,
      planner: singleNodePlanner,
      evaluator,
      loadWorkers: async () => [{ id: 'worker-a', name: 'A' }],
      pollIntervalMs: 5,
      retryDelayMs: 5,
    });

    orchestrator.start('task-1', 'user-1');
    const task = await waitForTerminal(getTask);
    const event = task.usageEvents.find((entry) => entry.role === 'worker');

    expect(event?.costUsd).toBe(0.25);
    expect(event?.durationMs).toBe(4_321);
    expect(task.usage.costUsd).toBe(0.25);
  });

  it('retries a failed node up to maxAttempts', async () => {
    const { repository, getTask } = createRepository(makeTask());
    let attempts = 0;
    const executor: SuperAgentAgentExecutor = {
      async execute() {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('temporary');
        }
        return { content: 'ok' };
      },
    };
    const singleNodePlanner: SuperAgentPlanner = {
      async createPlan() {
        return {
          nodes: [
            {
              id: 'a',
              goal: 'A',
              agentId: 'worker-a',
              dependencies: [],
              acceptanceCriteria: [],
              status: 'ready',
              attempts: 0,
              maxAttempts: 2,
            },
          ],
        };
      },
    };
    const orchestrator = createSuperAgentOrchestrator({
      repository,
      executor,
      planner: singleNodePlanner,
      evaluator,
      loadWorkers: async () => [{ id: 'worker-a', name: 'A' }],
      pollIntervalMs: 5,
      retryDelayMs: 5,
    });

    orchestrator.start('task-1', 'user-1');
    const task = await waitForTerminal(getTask);

    expect(task.status).toBe('completed');
    expect(task.nodes[0].attempts).toBe(2);
    expect(task.nodes[0].result?.content).toBe('ok');
  });

  it('retries a rejected node and reports the evaluation', async () => {
    const { repository, getTask } = createRepository(makeTask());
    let verdicts = 0;
    const rejectingEvaluator: SuperAgentEvaluator = {
      async evaluate() {
        verdicts += 1;
        return verdicts === 1
          ? { passed: false, reason: 'too short', feedback: 'Add detail' }
          : { passed: true, reason: 'ok' };
      },
    };
    const executor: SuperAgentAgentExecutor = {
      async execute() {
        return { content: 'answer' };
      },
    };
    const singleNodePlanner: SuperAgentPlanner = {
      async createPlan() {
        return {
          nodes: [
            {
              id: 'a',
              goal: 'A',
              agentId: 'worker-a',
              dependencies: [],
              acceptanceCriteria: [],
              status: 'ready',
              attempts: 0,
              maxAttempts: 2,
            },
          ],
        };
      },
    };
    const orchestrator = createSuperAgentOrchestrator({
      repository,
      executor,
      planner: singleNodePlanner,
      evaluator: rejectingEvaluator,
      loadWorkers: async () => [{ id: 'worker-a', name: 'A' }],
      pollIntervalMs: 5,
      retryDelayMs: 5,
    });

    orchestrator.start('task-1', 'user-1');
    const task = await waitForTerminal(getTask);

    expect(task.status).toBe('completed');
    expect(task.nodes[0].attempts).toBe(2);
    expect(task.nodes[0].evaluation?.passed).toBe(true);
  });

  it('fails without running workers when the token budget is already spent', async () => {
    const { repository, getTask } = createRepository(
      makeTask({
        status: 'running',
        usage: { totalTokens: 100, promptTokens: 80, completionTokens: 20 },
        policy: { ...makeTask().policy, maxTokens: 100 },
      }),
    );
    const executor: SuperAgentAgentExecutor = { execute: jest.fn() };
    const orchestrator = createSuperAgentOrchestrator({
      repository,
      executor,
      planner,
      evaluator,
      loadWorkers: async () => [{ id: 'worker-a', name: 'A' }],
      pollIntervalMs: 5,
    });

    orchestrator.start('task-1', 'user-1');
    const task = await waitForTerminal(getTask);

    expect(task.status).toBe('failed');
    expect(task.errorCode).toBe('budget_tokens_exceeded');
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('fails when the task duration budget is exhausted', async () => {
    const { repository, getTask } = createRepository(
      makeTask({
        status: 'running',
        createdAt: new Date(0).toISOString(),
        policy: { ...makeTask().policy, maxDurationMs: 60_000 },
      }),
    );
    const executor: SuperAgentAgentExecutor = { execute: jest.fn() };
    const orchestrator = createSuperAgentOrchestrator({
      repository,
      executor,
      planner,
      evaluator,
      loadWorkers: async () => [{ id: 'worker-a', name: 'A' }],
      pollIntervalMs: 5,
      now: () => new Date(120_000),
    });

    orchestrator.start('task-1', 'user-1');
    const task = await waitForTerminal(getTask);

    expect(task.status).toBe('failed');
    expect(task.errorCode).toBe('budget_duration_exceeded');
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('cancels an active task', async () => {
    const { repository, getTask } = createRepository(makeTask());
    const executor: SuperAgentAgentExecutor = {
      execute(input) {
        return new Promise((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      },
    };
    const orchestrator = createSuperAgentOrchestrator({
      repository,
      executor,
      planner,
      evaluator,
      loadWorkers: async () => [
        { id: 'worker-a', name: 'A' },
        { id: 'worker-b', name: 'B' },
      ],
      pollIntervalMs: 5,
      retryDelayMs: 5,
    });

    orchestrator.start('task-1', 'user-1');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const cancelled = await orchestrator.cancel('task-1', 'user-1');

    expect(cancelled?.status).toBe('cancelled');
    expect(getTask().nodes.every((node) => node.status !== 'running')).toBe(true);
  });
});
