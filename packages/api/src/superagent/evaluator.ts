import type { SuperAgentEvaluation, SuperAgentNode, SuperAgentTask } from 'librechat-data-provider';
import type { SuperAgentAgentExecutor } from './types';

const EVALUATOR_TIMEOUT_MS = 60_000;
const MAX_EVIDENCE_CHARS = 20_000;

export class SuperAgentEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuperAgentEvaluationError';
  }
}

export interface SuperAgentEvaluator {
  evaluate(params: { task: SuperAgentTask; node: SuperAgentNode; signal: AbortSignal }): Promise<
    SuperAgentEvaluation & {
      usage?: { totalTokens: number; promptTokens: number; completionTokens: number };
    }
  >;
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new SuperAgentEvaluationError('Evaluator did not return a JSON object');
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new SuperAgentEvaluationError('Evaluator returned invalid JSON');
  }
}

function buildPrompt(task: SuperAgentTask, node: SuperAgentNode): string {
  const criteria =
    node.acceptanceCriteria.length === 0
      ? '- The result directly and completely answers the node goal.'
      : node.acceptanceCriteria.map((criterion) => `- ${criterion}`).join('\n');
  return [
    'You are an independent evaluator. Judge the worker result against the task goal and criteria.',
    'Do not reward effort or intent; judge only the delivered content.',
    'Return JSON only: {"passed":true,"reason":"...","feedback":"..."}',
    'Use passed=false when the result is missing, incomplete, contradictory, or does not meet a criterion.',
    'feedback must tell the worker what to fix; keep it under 500 characters.',
    '',
    `Task goal:\n${task.goal}`,
    '',
    `Node goal:\n${node.goal}`,
    '',
    `Acceptance criteria:\n${criteria}`,
    '',
    `Worker result:\n${(node.result?.content ?? '').slice(0, MAX_EVIDENCE_CHARS)}`,
  ].join('\n');
}

export function createSuperAgentEvaluator(deps: {
  executor: SuperAgentAgentExecutor;
  timeoutMs?: number;
}): SuperAgentEvaluator {
  return {
    async evaluate({ task, node, signal }) {
      try {
        const result = await deps.executor.execute({
          agentId: task.evaluatorAgentId,
          goal: buildPrompt(task, node),
          taskId: task.id,
          nodeId: `${node.id}:eval`,
          userId: task.userId,
          tenantId: task.tenantId,
          signal,
          timeoutMs: deps.timeoutMs ?? EVALUATOR_TIMEOUT_MS,
          allowedTools: [],
          maxSteps: 2,
          role: 'evaluator',
        });
        const parsed = extractJson(result.content) as {
          passed?: unknown;
          reason?: unknown;
          feedback?: unknown;
        };
        if (typeof parsed.passed !== 'boolean') {
          throw new SuperAgentEvaluationError('Evaluator verdict is missing passed');
        }
        let reason = parsed.passed ? 'Accepted' : 'Rejected';
        if (typeof parsed.reason === 'string' && parsed.reason.trim() !== '') {
          reason = parsed.reason.slice(0, 2_000);
        }
        return {
          passed: parsed.passed,
          reason,
          usage: result.tokenUsage,
          ...(typeof parsed.feedback === 'string' && parsed.feedback.trim() !== ''
            ? { feedback: parsed.feedback.slice(0, 4_000) }
            : {}),
        };
      } catch (error) {
        return {
          passed: null,
          reason: 'Evaluation unavailable',
          ...(error instanceof Error ? { feedback: error.message.slice(0, 4_000) } : {}),
        };
      }
    },
  };
}
