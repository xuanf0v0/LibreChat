import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { SuperAgentAgentExecutor, SuperAgentExecutionResult } from './types';

export interface TrinityConfig {
  url: string;
  apiKey: string;
  agentName?: string;
  timeoutMs?: number;
}

interface TrinityToolResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

const DEFAULT_TIMEOUT_MS = 300_000;

function textContent(result: TrinityToolResult): string {
  const parts = result.content ?? [];
  return parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

/** Trinity execution metrics the caller can report to the usage ledger. */
export interface TrinityExecutionMetrics {
  durationMs?: number;
  costUsd?: number;
  contextUsed?: number;
  contextMax?: number;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Reads Trinity's execution receipt fields without inventing values it did not send. */
export function trinityMetrics(
  payload: Record<string, unknown> | undefined,
): TrinityExecutionMetrics {
  if (payload == null) {
    return {};
  }
  const durationMs = positiveNumber(payload.duration_ms);
  const costUsd = positiveNumber(payload.cost);
  const contextUsed = positiveNumber(payload.context_used);
  const contextMax = positiveNumber(payload.context_max);
  return {
    ...(durationMs == null ? {} : { durationMs }),
    ...(costUsd == null ? {} : { costUsd }),
    ...(contextUsed == null ? {} : { contextUsed }),
    ...(contextMax == null ? {} : { contextMax }),
  };
}

function parseToolPayload(result: TrinityToolResult): Record<string, unknown> | undefined {
  if (result.structuredContent != null) {
    return result.structuredContent;
  }
  const text = textContent(result);
  if (text === '') {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed != null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export async function probeTrinity(
  config: TrinityConfig,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const response = await fetch(new URL('/health', config.url).toString(), {
      signal: AbortSignal.timeout(5_000),
    });
    return { ok: response.ok, ...(response.ok ? {} : { message: `HTTP ${response.status}` }) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Unreachable' };
  }
}

export class TrinityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrinityError';
  }
}

export async function createTrinityClient(
  config: TrinityConfig,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const url = new URL(config.url);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    },
  });
  const client = new Client({ name: 'librechat-superagent', version: '1.0.0' });
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await client.close();
    },
  };
}

/**
 * Executes Super Agent workers on a Trinity instance over MCP.
 * The worker agent is addressed by name; its reply is read from the
 * `chat_with_agent` result or an execution receipt.
 */
export function createTrinityExecutor(config: TrinityConfig): SuperAgentAgentExecutor {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async execute(input): Promise<SuperAgentExecutionResult> {
      const agentName = input.trinityAgentName ?? config.agentName ?? input.agentId;
      const { client, close } = await createTrinityClient(config);
      try {
        const result = (await client.callTool(
          {
            name: 'chat_with_agent',
            arguments: {
              agent_name: agentName,
              message: input.goal,
              async: true,
              parallel: true,
            },
          },
          undefined,
          { timeout: timeoutMs, signal: input.signal },
        )) as TrinityToolResult;

        if (result.isError === true) {
          throw new TrinityError(textContent(result) || 'Trinity agent call failed');
        }

        const payload = parseToolPayload(result);
        const executionId =
          payload != null && typeof payload.execution_id === 'string'
            ? payload.execution_id
            : undefined;
        let inlineText = textContent(result);
        if (payload != null && typeof payload.response === 'string') {
          inlineText = payload.response;
        } else if (payload != null && typeof payload.message === 'string') {
          inlineText = payload.message;
        }

        if (inlineText !== '') {
          return { content: inlineText, ...trinityMetrics(payload) };
        }
        if (executionId == null) {
          throw new TrinityError('Trinity did not return a result or execution receipt');
        }

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (input.signal.aborted) {
            throw input.signal.reason ?? new Error('Agent execution aborted');
          }
          const poll = (await client.callTool(
            {
              name: 'get_execution_result',
              arguments: { agent_name: agentName, execution_id: executionId },
            },
            undefined,
            { timeout: 30_000, signal: input.signal },
          )) as TrinityToolResult;
          const pollPayload = parseToolPayload(poll);
          const status =
            pollPayload != null && typeof pollPayload.status === 'string'
              ? pollPayload.status
              : undefined;
          if (status === 'success' || status === 'completed') {
            const content =
              pollPayload != null && typeof pollPayload.response === 'string'
                ? pollPayload.response
                : textContent(poll);
            if (content.trim() === '') {
              throw new TrinityError('Trinity execution completed without output');
            }
            return { content, ...trinityMetrics(pollPayload) };
          }
          if (status === 'failed' || status === 'error' || status === 'cancelled') {
            throw new TrinityError(`Trinity execution ${status}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
        throw new TrinityError('Trinity execution timed out');
      } finally {
        await close().catch(() => undefined);
      }
    },
  };
}
