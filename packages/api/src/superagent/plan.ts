import {
  superAgentPlanDraftSchema,
  type SuperAgentNode,
  type SuperAgentNodeDraft,
  type SuperAgentPlanDraft,
  type SuperAgentTask,
} from 'librechat-data-provider';
import type { SuperAgentWorker } from './types';

export const MAX_TASK_NODES = 12;
export const MAX_NODE_ATTEMPTS = 2;

export class SuperAgentPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuperAgentPlanError';
  }
}

export function parsePlanDraft(
  value: unknown,
  allowedAgentIds: ReadonlySet<string>,
  maxNodes: number = MAX_TASK_NODES,
): SuperAgentPlanDraft {
  const parsed = superAgentPlanDraftSchema.safeParse(value);
  if (!parsed.success) {
    throw new SuperAgentPlanError('Plan does not match the required schema');
  }
  const draft = parsed.data;
  if (draft.nodes.length === 0 || draft.nodes.length > maxNodes) {
    throw new SuperAgentPlanError(`Plan must contain between 1 and ${maxNodes} nodes`);
  }

  const ids = new Set<string>();
  for (const node of draft.nodes) {
    if (ids.has(node.id)) {
      throw new SuperAgentPlanError(`Duplicate node id: ${node.id}`);
    }
    ids.add(node.id);
    if (!allowedAgentIds.has(node.agentId)) {
      throw new SuperAgentPlanError(`Agent is not available: ${node.agentId}`);
    }
  }

  for (const node of draft.nodes) {
    for (const dependency of node.dependencies) {
      if (!ids.has(dependency)) {
        throw new SuperAgentPlanError(`Unknown dependency: ${dependency}`);
      }
      if (dependency === node.id) {
        throw new SuperAgentPlanError(`Node cannot depend on itself: ${node.id}`);
      }
    }
  }

  assertAcyclic(draft.nodes);
  return draft;
}

function assertAcyclic(nodes: readonly SuperAgentNodeDraft[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): void => {
    if (visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      throw new SuperAgentPlanError(`Plan contains a dependency cycle at ${id}`);
    }
    visiting.add(id);
    const node = byId.get(id);
    if (node == null) {
      throw new SuperAgentPlanError(`Unknown node: ${id}`);
    }
    for (const dependency of node.dependencies) {
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const node of nodes) {
    visit(node.id);
  }
}

export function toTaskNodes(draft: SuperAgentPlanDraft): SuperAgentNode[] {
  return draft.nodes.map((node) => ({
    ...node,
    status: node.dependencies.length === 0 ? 'ready' : 'pending',
    attempts: 0,
    maxAttempts: MAX_NODE_ATTEMPTS,
  }));
}

export function isTerminalNode(node: SuperAgentNode): boolean {
  return (
    node.status === 'completed' ||
    node.status === 'failed' ||
    node.status === 'blocked' ||
    node.status === 'cancelled'
  );
}

/** Advances pending nodes whose dependencies are settled. Pure and idempotent. */
export function advanceNodes(nodes: readonly SuperAgentNode[]): SuperAgentNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    if (isTerminalNode(node) || node.status === 'running') {
      return node;
    }
    const dependencies = node.dependencies
      .map((id) => byId.get(id))
      .filter(Boolean) as SuperAgentNode[];
    if (
      dependencies.some(
        (dependency) =>
          dependency.status === 'failed' ||
          dependency.status === 'blocked' ||
          dependency.status === 'cancelled',
      )
    ) {
      return { ...node, status: 'blocked', completedAt: new Date().toISOString() };
    }
    if (dependencies.every((dependency) => dependency.status === 'completed')) {
      return node.status === 'ready' ? node : { ...node, status: 'ready' };
    }
    return node;
  });
}

export function readyNodes(nodes: readonly SuperAgentNode[]): SuperAgentNode[] {
  return nodes.filter((node) => node.status === 'ready');
}

export function runningCount(nodes: readonly SuperAgentNode[]): number {
  return nodes.filter((node) => node.status === 'running').length;
}

export function summarizeTask(nodes: readonly SuperAgentNode[]): {
  done: boolean;
  failed: boolean;
} {
  const done = nodes.every(isTerminalNode);
  const failed = nodes.some((node) => node.status === 'failed' || node.status === 'blocked');
  return { done, failed };
}

/** Applies the task policy and each worker's registry limits to a planned node. */
export function applyWorkerPolicies(
  nodes: readonly SuperAgentNode[],
  taskPolicy: SuperAgentTask['policy'],
  workers: readonly SuperAgentWorker[],
): SuperAgentNode[] {
  const byId = new Map(workers.map((worker) => [worker.id, worker]));
  const runsByWorker = new Map<string, number>();

  for (const node of nodes) {
    const worker = byId.get(node.agentId);
    if (worker == null) {
      throw new SuperAgentPlanError(`Agent is not available: ${node.agentId}`);
    }
    const runs = (runsByWorker.get(node.agentId) ?? 0) + 1;
    const maxRuns = worker.maxRunsPerTask ?? MAX_TASK_NODES;
    if (runs > maxRuns) {
      throw new SuperAgentPlanError(
        `Agent ${node.agentId} exceeds its per-task run limit of ${maxRuns}`,
      );
    }
    runsByWorker.set(node.agentId, runs);
  }

  return nodes.map((node) => {
    const worker = byId.get(node.agentId) as SuperAgentWorker;
    let allowedTools = worker.allowedTools ?? null;
    if (taskPolicy.allowedTools !== null) {
      allowedTools = taskPolicy.allowedTools;
    }
    return {
      ...node,
      allowedTools,
      maxSteps: Math.min(taskPolicy.maxSteps, worker.maxSteps ?? taskPolicy.maxSteps),
      timeoutMs: Math.min(taskPolicy.timeoutMs, worker.timeoutMs ?? taskPolicy.timeoutMs),
      maxConcurrentRuns: worker.maxConcurrentRuns ?? 1,
      trinityAgentName: worker.trinityAgentName ?? null,
    };
  });
}
