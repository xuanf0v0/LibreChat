import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { SuperAgentExecutionResult } from './types';

interface CapturedResult {
  statusCode: number;
  body: Record<string, unknown> | undefined;
  raw: string;
}

interface InvokeUser {
  id: string;
  role?: string;
  tenantId?: string;
  [key: string]: unknown;
}

export interface InProcessAgentInvokerDeps {
  execute(req: unknown, res: unknown): Promise<void>;
  findUser(userId: string): Promise<InvokeUser | null>;
  getConfig(params: {
    userId: string;
    role?: string;
    tenantId?: string;
    failClosed?: boolean;
  }): Promise<unknown>;
  prepareAgent(params: {
    userId: string;
    role?: string;
    agentId: string;
    tenantId?: string;
  }): Promise<Record<string, unknown> | null>;
}

class CaptureResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, unknown> = Object.create(null);
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  body: unknown;
  raw = '';
  private settled = false;
  private resolveResult!: (value: CapturedResult) => void;
  private rejectResult!: (reason?: unknown) => void;
  readonly result: Promise<CapturedResult>;

  constructor(signal?: AbortSignal) {
    super();
    this.result = new Promise<CapturedResult>((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    signal?.addEventListener(
      'abort',
      () => {
        if (!this.settled) {
          this.settled = true;
          this.rejectResult(signal.reason ?? new Error('Agent execution aborted'));
        }
      },
      { once: true },
    );
  }

  setHeader(name: string, value: unknown): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  getHeader(name: string): unknown {
    return this.headers[name.toLowerCase()];
  }

  getHeaders(): Record<string, unknown> {
    return { ...this.headers };
  }

  flushHeaders(): void {
    this.headersSent = true;
  }

  writeHead(statusCode: number, headers?: Record<string, unknown>): this {
    this.statusCode = statusCode;
    if (headers != null) {
      for (const [name, value] of Object.entries(headers)) {
        this.setHeader(name, value);
      }
    }
    this.headersSent = true;
    return this;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  write(chunk: unknown): boolean {
    this.headersSent = true;
    if (chunk != null) {
      this.raw += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    }
    return true;
  }

  json(body: unknown): this {
    this.body = body;
    this.headersSent = true;
    this.finish();
    return this;
  }

  send(body: unknown): this {
    this.body = body;
    this.headersSent = true;
    this.finish();
    return this;
  }

  end(chunk?: unknown): this {
    if (chunk != null) {
      this.raw += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    }
    this.finish();
    return this;
  }

  private finish(): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.writableEnded = true;
    let body = this.body;
    if (body === undefined && this.raw.trim() !== '') {
      try {
        body = JSON.parse(this.raw);
      } catch {
        body = undefined;
      }
    }
    this.resolveResult({
      statusCode: this.statusCode,
      body:
        typeof body === 'object' && body != null ? (body as Record<string, unknown>) : undefined,
      raw: this.raw,
    });
  }
}

function createRequest(params: {
  user: InvokeUser;
  config: unknown;
  tenantId?: string;
  agentId: string;
  goal: string;
  requestId: string;
  agentOverride: Record<string, unknown>;
  allowedTools: string[] | null;
}) {
  return {
    user: params.user,
    config: params.config,
    tenantId: params.tenantId,
    requestId: params.requestId,
    id: params.requestId,
    agentOverride: params.agentOverride,
    superAgentAllowedTools: params.allowedTools,
    body: {
      model: params.agentId,
      messages: [{ role: 'user', content: params.goal }],
      stream: false,
    },
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    url: '/api/agents/v1/chat/completions',
    query: {},
    params: {},
    get(name: string) {
      return this.headers[name.toLowerCase() as keyof typeof this.headers];
    },
    header(name: string) {
      return this.get(name);
    },
    on() {
      return this;
    },
    once() {
      return this;
    },
    off() {
      return this;
    },
    emit() {
      return false;
    },
  };
}

export function createInProcessAgentInvoker(
  deps: InProcessAgentInvokerDeps,
): (input: {
  agentId: string;
  goal: string;
  userId: string;
  tenantId?: string;
  signal: AbortSignal;
  allowedTools?: string[] | null;
  maxSteps?: number;
}) => Promise<SuperAgentExecutionResult> {
  return async (input) => {
    if (input.signal.aborted) {
      throw input.signal.reason ?? new Error('Agent execution aborted');
    }
    const storedUser = await deps.findUser(input.userId);
    if (storedUser == null) {
      throw new Error('Task owner is no longer available');
    }
    const user: InvokeUser = {
      ...storedUser,
      id: String(storedUser.id ?? input.userId),
    };
    const agent = await deps.prepareAgent({
      userId: input.userId,
      role: user.role,
      agentId: input.agentId,
      tenantId: input.tenantId,
    });
    if (agent == null) {
      throw new Error('Worker agent is not accessible');
    }
    const agentTools = Array.isArray(agent.tools)
      ? agent.tools.filter((tool): tool is string => typeof tool === 'string')
      : [];
    const allowedTools = input.allowedTools == null ? null : new Set(input.allowedTools);
    const agentOverride: Record<string, unknown> = {
      ...agent,
      ...(input.maxSteps == null ? {} : { recursion_limit: input.maxSteps }),
    };
    if (allowedTools != null) {
      agentOverride.tools = agentTools.filter((tool) => allowedTools.has(tool));
    }
    const config = await deps.getConfig({
      userId: input.userId,
      role: user.role,
      tenantId: input.tenantId,
      failClosed: true,
    });
    const requestId = `superagent-${randomUUID()}`;
    const req = createRequest({
      user,
      config,
      tenantId: input.tenantId,
      agentId: input.agentId,
      goal: input.goal,
      requestId,
      agentOverride,
      allowedTools: input.allowedTools ?? null,
    });
    const res = new CaptureResponse(input.signal);
    const execution = deps.execute(req, res);
    execution.catch(() => {});
    const aborted = Promise.withResolvers<never>();
    const onAbort = () => {
      aborted.reject(input.signal.reason ?? new Error('Agent execution aborted'));
    };
    if (input.signal.aborted) {
      onAbort();
    } else {
      input.signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      await Promise.race([execution, aborted.promise]);
    } catch (error) {
      if (input.signal.aborted) {
        throw error;
      }
      throw new Error('Agent execution failed');
    } finally {
      input.signal.removeEventListener('abort', onAbort);
    }
    const { statusCode, body } = await res.result;
    if (statusCode >= 400) {
      throw new Error('Agent execution failed');
    }
    const usage = body?.usage as
      | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      | undefined;
    const choices = body?.choices;
    const content =
      Array.isArray(choices) && choices.length > 0
        ? (choices[0] as { message?: { content?: unknown } })?.message?.content
        : undefined;
    if (typeof content !== 'string' || content.trim() === '') {
      throw new Error('Agent returned an empty result');
    }
    return {
      content,
      ...(usage == null
        ? {}
        : {
            tokenUsage: {
              promptTokens: usage.prompt_tokens ?? 0,
              completionTokens: usage.completion_tokens ?? 0,
              totalTokens:
                usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
            },
          }),
    };
  };
}
