import type { SuperAgentTask } from 'librechat-data-provider';
import type { SuperAgentAgentExecutor, SuperAgentWorker } from './types';
import { parsePlanDraft } from './plan';

const PLANNER_TIMEOUT_MS = 120_000;
const MAX_WORKER_DESCRIPTION_CHARS = 600;

export class SuperAgentPlannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuperAgentPlannerError';
  }
}

export interface SuperAgentPlanner {
  createPlan(params: {
    task: SuperAgentTask;
    workers: readonly SuperAgentWorker[];
    signal: AbortSignal;
  }): Promise<{
    nodes: SuperAgentTask['nodes'];
    usage?: { totalTokens: number; promptTokens: number; completionTokens: number };
  }>;
}

function workerLine(worker: SuperAgentWorker): string {
  const description = (worker.description ?? '').slice(0, MAX_WORKER_DESCRIPTION_CHARS);
  const category = worker.category == null ? '' : ` | category: ${worker.category}`;
  const tools =
    worker.tools == null || worker.tools.length === 0
      ? ''
      : ` | tools: ${worker.tools.slice(0, 12).join(', ')}`;
  const capabilities =
    worker.capabilities == null || worker.capabilities.length === 0
      ? ''
      : ` | capabilities: ${worker.capabilities.slice(0, 12).join(', ')}`;
  return `- id: ${worker.id} | name: ${worker.name}${category}${capabilities}${tools}${
    description === '' ? '' : ` | description: ${description}`
  }`;
}

function buildPrompt(task: SuperAgentTask, workers: readonly SuperAgentWorker[]): string {
  return [
    'You are the Router of a multi-agent system. Break the user goal into the smallest useful',
    'set of dependent tasks and assign each task to exactly one available agent.',
    '',
    'Return JSON only, with this exact shape:',
    '{"nodes":[{"id":"t1","goal":"...","agentId":"agent_id","dependencies":[],"acceptanceCriteria":["..."]}]}',
    '',
    'Rules:',
    '- Use 1 to 12 nodes. A simple request should use one node.',
    '- Node ids must be unique short strings.',
    '- dependencies may only reference earlier or other node ids; no cycles.',
    '- agentId must be one of the available agent ids.',
    '- Each node goal must be self-contained and include the concrete deliverable.',
    '- Add acceptance criteria only when they are objectively checkable.',
    '- Do not create a node for planning, reviewing, or summarizing unless it needs a different agent.',
    '',
    'Available agents:',
    ...workers.map(workerLine),
    '',
    ...(task.replanFeedback == null
      ? []
      : [
          '',
          'The previous attempt failed. Revise the plan using this feedback:',
          task.replanFeedback,
        ]),
    '',
    'User goal:',
    task.goal,
  ].join('\n');
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new SuperAgentPlannerError('Planner did not return a JSON object');
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new SuperAgentPlannerError('Planner returned invalid JSON');
  }
}

export function createSuperAgentPlanner(deps: {
  executor: SuperAgentAgentExecutor;
  timeoutMs?: number;
}): SuperAgentPlanner {
  return {
    async createPlan({ task, workers, signal }) {
      if (workers.length === 0) {
        throw new SuperAgentPlannerError('No agents are available for planning');
      }
      const allowed = new Set(workers.map((worker) => worker.id));
      const result = await deps.executor.execute({
        agentId: task.plannerAgentId,
        goal: buildPrompt(task, workers),
        taskId: task.id,
        nodeId: 'planner',
        userId: task.userId,
        tenantId: task.tenantId,
        signal,
        timeoutMs: deps.timeoutMs ?? PLANNER_TIMEOUT_MS,
        role: 'planner',
        allowedTools: [],
        maxSteps: 4,
      });
      const draft = parsePlanDraft(extractJson(result.content), allowed, task.policy.maxNodes);
      return {
        nodes: draft.nodes.map((node) => ({
          ...node,
          status: node.dependencies.length === 0 ? 'ready' : 'pending',
          attempts: 0,
          maxAttempts: 2,
        })),
        usage: result.tokenUsage,
      };
    },
  };
}
