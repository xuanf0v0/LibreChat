import type { Response } from 'express';
import type { ServerRequest } from '~/types';
import type { SuperAgentTask } from 'librechat-data-provider';
import { createSuperAgentHandlers } from './handlers';
import type { SuperAgentTaskStore } from './handlers';
import type { SuperAgentLimits, SuperAgentWorker } from './types';

const start = jest.fn();
const cancel = jest.fn();

function makeRequest(overrides: Record<string, unknown> = {}): ServerRequest {
  return {
    user: { id: 'user-1', role: 'USER' },
    body: {},
    query: {},
    params: {},
    config: {},
    ...overrides,
  } as unknown as ServerRequest;
}

function makeResponse() {
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return response as unknown as Response;
}

function makeTask(overrides: Partial<SuperAgentTask> = {}): SuperAgentTask {
  return {
    id: 'task-1',
    userId: 'user-1',
    goal: 'Do it',
    plannerAgentId: 'planner',
    evaluatorAgentId: 'planner',
    workerAgentIds: ['worker'],
    status: 'planning',
    maxWorkers: 3,
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const workers: SuperAgentWorker[] = [
  { id: 'planner', name: 'Planner' },
  { id: 'worker', name: 'Worker' },
];

const limits: SuperAgentLimits = {
  maxActiveTasks: 3,
  maxWorkers: 3,
  maxNodes: 12,
  defaultMaxSteps: 25,
  defaultTimeoutMs: 300_000,
};

function setup(options: { tasks?: SuperAgentTask[]; create?: SuperAgentTaskStore['create'] } = {}) {
  const create = jest.fn(
    options.create ??
      (async (input) =>
        makeTask({
          ...input,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
  );
  const store: SuperAgentTaskStore = {
    create,
    get: jest.fn(async () => null),
    list: jest.fn(async () => options.tasks ?? []),
    update: jest.fn(async () => null),
    listRecoverable: jest.fn(async () => []),
  };
  const handlers = createSuperAgentHandlers({
    store,
    orchestrator: { start, cancel },
    listWorkers: async () => workers,
    upsertWorker: async () => null,
    deleteWorker: async () => null,
    limits,
    events: { publish: jest.fn(), subscribe: jest.fn(() => jest.fn()) },
  });
  return { handlers, store };
}

describe('Super Agent createTask policy', () => {
  beforeEach(() => {
    start.mockClear();
  });

  it('applies defaults and clamps concurrency to configured limits', async () => {
    const { handlers, store } = setup();
    const res = makeResponse();
    await handlers.createTask(
      makeRequest({ body: { goal: 'Do it', plannerAgentId: 'planner', maxWorkers: 10 } }),
      res,
    );
    expect(res.statusCode).toBe(202);
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        maxWorkers: 3,
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
      }),
    );
    expect(start).toHaveBeenCalledWith(expect.any(String), 'user-1', undefined);
  });

  it('accepts a task-level tool allowlist and step budget', async () => {
    const { handlers, store } = setup();
    const res = makeResponse();
    await handlers.createTask(
      makeRequest({
        body: {
          goal: 'Do it',
          plannerAgentId: 'planner',
          workerAgentIds: ['worker'],
          policy: { allowedTools: ['web_search', 'web_search'], maxSteps: 5, timeoutMs: 5_000 },
        },
      }),
      res,
    );
    expect(res.statusCode).toBe(202);
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: {
          allowedTools: ['web_search'],
          maxSteps: 5,
          timeoutMs: 5_000,
          maxNodes: 12,
          maxReplans: 1,
          maxTokens: 200_000,
          plannerMaxTokens: 40_000,
          workerMaxTokens: 160_000,
          evaluatorMaxTokens: 40_000,
          maxDurationMs: 3_600_000,
        },
      }),
    );
  });

  it('rejects creation when the active task limit is reached', async () => {
    const { handlers } = setup({
      tasks: [makeTask(), makeTask({ id: 'task-2' }), makeTask({ id: 'task-3' })],
    });
    const res = makeResponse();
    await handlers.createTask(
      makeRequest({ body: { goal: 'Do it', plannerAgentId: 'planner' } }),
      res,
    );
    expect(res.statusCode).toBe(429);
  });

  it('rejects a worker outside the accessible catalog', async () => {
    const { handlers } = setup();
    const res = makeResponse();
    await handlers.createTask(
      makeRequest({
        body: { goal: 'Do it', plannerAgentId: 'planner', workerAgentIds: ['other'] },
      }),
      res,
    );
    expect(res.statusCode).toBe(403);
  });

  it('uses request config limits over handler defaults', async () => {
    const { handlers, store } = setup();
    const res = makeResponse();
    await handlers.createTask(
      makeRequest({
        body: { goal: 'Do it', plannerAgentId: 'planner', maxWorkers: 10 },
        config: {
          superAgent: {
            maxActiveTasks: 1,
            maxWorkers: 2,
            maxNodes: 4,
            defaultMaxSteps: 9,
            defaultTimeoutMs: 2_000,
          },
        },
      }),
      res,
    );
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        maxWorkers: 2,
        policy: {
          allowedTools: null,
          maxSteps: 9,
          timeoutMs: 2_000,
          maxNodes: 4,
          maxReplans: 1,
          maxTokens: 200_000,
          plannerMaxTokens: 40_000,
          workerMaxTokens: 160_000,
          evaluatorMaxTokens: 40_000,
          maxDurationMs: 3_600_000,
        },
      }),
    );
  });
});
