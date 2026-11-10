import {
  advanceNodes,
  parsePlanDraft,
  readyNodes,
  summarizeTask,
  toTaskNodes,
  SuperAgentPlanError,
} from './plan';

const agents = new Set(['planner', 'worker-a', 'worker-b']);

const draftNode = (
  id: string,
  agentId: string,
  dependencies: string[] = [],
): {
  id: string;
  goal: string;
  agentId: string;
  dependencies: string[];
  acceptanceCriteria: string[];
} => ({
  id,
  goal: `Goal ${id}`,
  agentId,
  dependencies,
  acceptanceCriteria: [],
});

describe('parsePlanDraft', () => {
  it('accepts a valid acyclic plan', () => {
    const plan = parsePlanDraft(
      {
        nodes: [
          draftNode('t1', 'worker-a'),
          {
            ...draftNode('t2', 'worker-b', ['t1']),
            acceptanceCriteria: ['Has a result'],
          },
        ],
      },
      agents,
    );
    expect(plan.nodes).toHaveLength(2);
    expect(plan.nodes[1].dependencies).toEqual(['t1']);
  });

  it('rejects unknown agents', () => {
    expect(() => parsePlanDraft({ nodes: [draftNode('t1', 'missing')] }, agents)).toThrow(
      SuperAgentPlanError,
    );
  });

  it('rejects a dependency cycle', () => {
    expect(() =>
      parsePlanDraft(
        {
          nodes: [draftNode('a', 'worker-a', ['b']), draftNode('b', 'worker-b', ['a'])],
        },
        agents,
      ),
    ).toThrow(/cycle/);
  });

  it('honors the task node budget', () => {
    expect(() =>
      parsePlanDraft(
        { nodes: [draftNode('a', 'worker-a'), draftNode('b', 'worker-b')] },
        agents,
        1,
      ),
    ).toThrow(/between 1 and 1/);
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      parsePlanDraft(
        {
          nodes: [draftNode('a', 'worker-a'), draftNode('a', 'worker-b')],
        },
        agents,
      ),
    ).toThrow(/Duplicate/);
  });
});

describe('advanceNodes', () => {
  it('unblocks dependents only after all dependencies complete', () => {
    const [first, second] = toTaskNodes({
      nodes: [draftNode('t1', 'worker-a'), draftNode('t2', 'worker-b', ['t1'])],
    });
    expect(first.status).toBe('ready');
    expect(second.status).toBe('pending');

    const running = advanceNodes([{ ...first, status: 'running' }, second]);
    expect(running[1].status).toBe('pending');

    const completed = advanceNodes([{ ...first, status: 'completed' }, second]);
    expect(completed[1].status).toBe('ready');
    expect(readyNodes(completed)).toHaveLength(1);
  });

  it('blocks a dependent when an upstream node fails', () => {
    const [, second] = toTaskNodes({
      nodes: [draftNode('t1', 'worker-a'), draftNode('t2', 'worker-b', ['t1'])],
    });
    const blocked = advanceNodes([
      { ...second, dependencies: ['t1'] },
      {
        ...draftNode('t1', 'worker-a'),
        status: 'failed',
        attempts: 1,
        maxAttempts: 2,
      },
    ]);
    expect(blocked.find((node) => node.id === 't2')?.status).toBe('blocked');
  });
});

describe('summarizeTask', () => {
  it('reports failure when any node is blocked', () => {
    const summary = summarizeTask([
      {
        ...draftNode('a', 'worker-a'),
        status: 'completed',
        attempts: 1,
        maxAttempts: 2,
      },
      {
        ...draftNode('b', 'worker-b', ['a']),
        status: 'blocked',
        attempts: 1,
        maxAttempts: 2,
      },
    ]);
    expect(summary).toEqual({ done: true, failed: true });
  });
});
