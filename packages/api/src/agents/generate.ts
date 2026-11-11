import { z } from 'zod';
import axios from 'axios';
import { Constants, normalizeServerName, splitMCPToolKey } from 'librechat-data-provider';
import type { AgentGenerateDraft, AgentGenerateParams, TPlugin } from 'librechat-data-provider';
import type { Request, Response } from 'express';
import type { ParsedServerConfig } from '~/mcp/types';
import { createSSRFSafeAgents } from '~/auth/agent';
import { validateEndpointURL } from '~/auth/domain';

const MAX_PROMPT_LENGTH = 4000;
const MAX_DRAFT_JSON_LENGTH = 6000;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 400;
const MAX_INSTRUCTIONS_LENGTH = 12000;
const MAX_CATEGORY_LENGTH = 50;
const MAX_STARTER_LENGTH = 120;
const MAX_STARTERS = 4;
const MAX_TOOLS = 24;
const MAX_TOOL_ID_LENGTH = 120;
const MAX_TOOL_DESCRIPTION_LENGTH = 140;
/** Bounds the prompt on deployments with hundreds of MCP tools; order is deterministic. */
const MAX_CATALOG_TOOLS = 80;
const GENERATION_TIMEOUT_MS = 60_000;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

export type AgentGenerateProvider = {
  name: string;
  baseURL: string;
  apiKey: string;
  kind: 'openai' | 'anthropic';
  models: string[];
};

export type AgentGenerateCompletionInput = {
  provider: AgentGenerateProvider;
  model: string;
  system: string;
  user: string;
  signal: AbortSignal;
};

/** One tool the generator may attach, as the agent editor persists it. */
export type AgentGenerateTool = {
  id: string;
  name: string;
  description: string;
};

/**
 * The tools a user may attach: the deployment's builtin tools plus the MCP tools
 * of every server the user can reach. Server tokens are not offered — only
 * concrete tool ids, so the draft is attachable as-is.
 */
export function buildAgentGenerateTools({
  builtin,
  mcpServers,
}: {
  builtin: readonly Pick<TPlugin, 'pluginKey' | 'name' | 'description'>[];
  mcpServers: Record<string, Pick<ParsedServerConfig, 'consumeOnly' | 'toolFunctions'>>;
}): AgentGenerateTool[] {
  const tools = new Map<string, AgentGenerateTool>();
  const add = (tool: AgentGenerateTool) => {
    if (tool.id !== '' && !tools.has(tool.id)) {
      tools.set(tool.id, tool);
    }
  };

  for (const plugin of builtin) {
    add({
      id: plugin.pluginKey,
      name: plugin.name || plugin.pluginKey,
      description: plugin.description ?? '',
    });
  }

  for (const [serverName, config] of Object.entries(mcpServers)) {
    /** A consume-only server is reachable through its owning agent, not attachable here. */
    if (config.consumeOnly === true) {
      continue;
    }
    for (const [toolId, tool] of Object.entries(config.toolFunctions ?? {})) {
      if (!toolId.includes(Constants.mcp_delimiter)) {
        continue;
      }
      const [toolName] = splitMCPToolKey(toolId, [serverName, normalizeServerName(serverName)]);
      add({
        id: toolId,
        name: tool.function.name || toolName,
        description: tool.function.description ?? '',
      });
    }
  }

  return [...tools.values()];
}

export interface AgentGenerateDeps {
  /** Resolves an authenticated user's configured provider and decrypted key. */
  resolveProvider: (params: {
    userId: string;
    role?: string;
    tenantId?: string;
    provider: string;
  }) => Promise<AgentGenerateProvider | null>;
  /** The tools the requester may attach; the draft may only pick ids from this list. */
  listTools: (params: {
    userId: string;
    role?: string;
    tenantId?: string;
    idOnTheSource?: string;
  }) => Promise<AgentGenerateTool[]>;
  /** Injectable for tests; defaults to the OpenAI-compatible/Anthropic HTTP call. */
  requestCompletion?: (input: AgentGenerateCompletionInput) => Promise<string>;
}

type GenerateRequestUser = {
  id?: string;
  role?: string;
  tenantId?: string;
  idOnTheSource?: string;
};

type GenerateRequestBody = Partial<AgentGenerateParams> & { draft?: unknown };

class GenerationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(code);
  }
}

const draftSchema = z.object({
  name: z.string(),
  description: z.string().optional().default(''),
  instructions: z.string(),
  category: z.string().optional().default(''),
  conversation_starters: z.array(z.string()).optional().default([]),
  tools: z.array(z.string()).optional().default([]),
});

const SYSTEM_PROMPT = `You design agent configurations for LibreChat.
Return exactly one JSON object and no prose, Markdown, or code fences.
The object must have these keys:
- "name": a short display name
- "description": one or two sentences for a catalog card
- "instructions": a complete system prompt for the agent
- "category": a short lowercase identifier for the agent's category, or ""
- "conversation_starters": 0-4 short example user messages
- "tools": the ids of the tools the agent needs to do this job, chosen only from the "Available tools" catalog in the user message; [] when none is needed
Write all copy in the language of the user's request.
Choose the fewest tools that cover the request. Never invent tool ids, skills, file ids, secrets, URLs, or capabilities, and do not mention a tool in "instructions" unless you selected it.`;

const sanitizeText = (value: string, maxLength: number): string =>
  Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return char === '\n' || char === '\r' || char === '\t' || (code >= 32 && code !== 127);
    })
    .join('')
    .trim()
    .slice(0, maxLength);

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1').trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new GenerationError('invalid_generation', 502);
  }
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    throw new GenerationError('invalid_generation', 502);
  }
}

/** Extracts and bounds a model response before it can reach the builder form. */
export function parseGeneratedDraft(
  text: string,
  allowedTools?: readonly string[],
): AgentGenerateDraft {
  const parsed = draftSchema.safeParse(parseJson(text));
  if (!parsed.success) {
    throw new GenerationError('invalid_generation', 502);
  }

  const name = sanitizeText(parsed.data.name, MAX_NAME_LENGTH);
  const instructions = sanitizeText(parsed.data.instructions, MAX_INSTRUCTIONS_LENGTH);
  if (name === '' || instructions === '') {
    throw new GenerationError('invalid_generation', 502);
  }

  const description = sanitizeText(parsed.data.description, MAX_DESCRIPTION_LENGTH);
  const rawCategory = sanitizeText(parsed.data.category, MAX_CATEGORY_LENGTH);
  const category = /^[a-z0-9][a-z0-9_-]*$/i.test(rawCategory) ? rawCategory : '';
  const conversation_starters = Array.from(
    new Set(
      parsed.data.conversation_starters
        .map((starter) => sanitizeText(starter, MAX_STARTER_LENGTH))
        .filter((starter) => starter !== ''),
    ),
  ).slice(0, MAX_STARTERS);
  const tools = Array.from(
    new Set(
      parsed.data.tools
        .map((tool) => sanitizeText(tool, MAX_TOOL_ID_LENGTH))
        .filter((tool) => tool !== '' && (allowedTools == null || allowedTools.includes(tool))),
    ),
  ).slice(0, MAX_TOOLS);

  return {
    name,
    description,
    instructions,
    category,
    conversation_starters,
    tools,
  };
}

function readModels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((model): model is string => typeof model === 'string');
}

function normalizeDraft(value: unknown): string {
  if (value == null || typeof value !== 'object') {
    return '';
  }
  const draft = value as Record<string, unknown>;
  const picked = {
    name: typeof draft.name === 'string' ? draft.name.slice(0, MAX_NAME_LENGTH) : '',
    description:
      typeof draft.description === 'string'
        ? draft.description.slice(0, MAX_DESCRIPTION_LENGTH)
        : '',
    instructions:
      typeof draft.instructions === 'string'
        ? draft.instructions.slice(0, MAX_INSTRUCTIONS_LENGTH)
        : '',
    category:
      typeof draft.category === 'string' ? draft.category.slice(0, MAX_CATEGORY_LENGTH) : '',
    conversation_starters: Array.isArray(draft.conversation_starters)
      ? draft.conversation_starters
          .filter((starter): starter is string => typeof starter === 'string')
          .slice(0, MAX_STARTERS)
          .map((starter) => starter.slice(0, MAX_STARTER_LENGTH))
      : [],
    tools: Array.isArray(draft.tools)
      ? draft.tools
          .filter((tool): tool is string => typeof tool === 'string')
          .slice(0, MAX_TOOLS)
          .map((tool) => tool.slice(0, MAX_TOOL_ID_LENGTH))
      : [],
  };
  const json = JSON.stringify(picked);
  return json.length > MAX_DRAFT_JSON_LENGTH ? json.slice(0, MAX_DRAFT_JSON_LENGTH) : json;
}

function buildUserPrompt(params: AgentGenerateParams, tools: readonly AgentGenerateTool[]): string {
  const draft = normalizeDraft(params.draft);
  const catalog =
    tools.length === 0
      ? 'Available tools: none.'
      : [
          'Available tools (id — description):',
          ...tools.slice(0, MAX_CATALOG_TOOLS).map((tool) => {
            const description = tool.description.trim().slice(0, MAX_TOOL_DESCRIPTION_LENGTH);
            return description === '' ? `- ${tool.id}` : `- ${tool.id} — ${description}`;
          }),
        ].join('\n');
  return [
    `User request:\n${params.prompt.trim()}`,
    draft === '' ? '' : `Current draft to improve:\n${draft}`,
    catalog,
    'Return the JSON object now.',
  ]
    .filter((part) => part !== '')
    .join('\n\n');
}

function readOpenAIContent(payload: unknown): string | null {
  const choices = (payload as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const message = (choices[0] as { message?: { content?: unknown } })?.message;
  const content = message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        part != null &&
        typeof part === 'object' &&
        typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : '',
      )
      .join('');
    return text === '' ? null : text;
  }
  return null;
}

function readAnthropicContent(payload: unknown): string | null {
  const content = (payload as { content?: unknown })?.content;
  if (!Array.isArray(content)) {
    return null;
  }
  const text = content
    .map((part) =>
      part != null &&
      typeof part === 'object' &&
      typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : '',
    )
    .join('');
  return text === '' ? null : text;
}

/** Calls a user-configured provider directly; the key never leaves this process. */
async function requestProviderCompletion({
  provider,
  model,
  system,
  user,
  signal,
}: AgentGenerateCompletionInput): Promise<string> {
  const isAnthropic = provider.kind === 'anthropic';
  const endpoint = isAnthropic
    ? `${provider.baseURL.replace(/\/+$/, '')}${provider.baseURL.endsWith('/v1') ? '' : '/v1'}/messages`
    : `${provider.baseURL.replace(/\/+$/, '')}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(isAnthropic
      ? { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${provider.apiKey}` }),
  };

  await validateEndpointURL(provider.baseURL, provider.name);
  const ssrfAgents = createSSRFSafeAgents();
  const response = await axios.post(
    endpoint,
    isAnthropic
      ? {
          model,
          max_tokens: 4096,
          system,
          messages: [{ role: 'user', content: user }],
        }
      : {
          model,
          temperature: 0.4,
          max_tokens: 4096,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        },
    {
      headers,
      signal,
      timeout: GENERATION_TIMEOUT_MS,
      maxRedirects: 0,
      proxy: false,
      httpAgent: ssrfAgents.httpAgent,
      httpsAgent: ssrfAgents.httpsAgent,
    },
  );

  const payload: unknown = response.data;
  const content = isAnthropic ? readAnthropicContent(payload) : readOpenAIContent(payload);
  if (content == null) {
    throw new GenerationError('invalid_generation', 502);
  }
  return content;
}

function isValidProvider(provider: AgentGenerateProvider): boolean {
  try {
    const url = new URL(provider.baseURL);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    if (url.username !== '' || url.password !== '') {
      return false;
    }
  } catch {
    return false;
  }
  return provider.apiKey !== '' && readModels(provider.models).length > 0;
}

/** In-memory per-process budget; a multi-instance deployment should move this to Redis. */
function createRateLimiter(limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS) {
  const buckets = new Map<string, number[]>();
  return (key: string, now = Date.now()): number | null => {
    const recent = (buckets.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= limit) {
      buckets.set(key, recent);
      return Math.ceil((windowMs - (now - recent[0])) / 1000);
    }
    recent.push(now);
    buckets.set(key, recent);
    return null;
  };
}

function sendError(res: Response, error: GenerationError): Response {
  if (error.retryAfter != null) {
    res.setHeader('Retry-After', String(error.retryAfter));
  }
  return res.status(error.status).json({ error: error.code });
}

export function createAgentGenerateHandler(deps: AgentGenerateDeps) {
  const completion = deps.requestCompletion ?? requestProviderCompletion;
  const takeBudget = createRateLimiter();

  return async (req: Request, res: Response): Promise<Response> => {
    const user = (req as Request & { user?: GenerateRequestUser }).user;
    const userId = user?.id;
    if (userId == null || userId === '') {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const retryAfter = takeBudget(userId);
    if (retryAfter != null) {
      return sendError(res, new GenerationError('rate_limited', 429, retryAfter));
    }

    const body = (req.body ?? {}) as GenerateRequestBody;
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const providerName = typeof body.provider === 'string' ? body.provider.trim() : '';
    const model = typeof body.model === 'string' ? body.model.trim() : '';

    if (prompt === '' || prompt.length > MAX_PROMPT_LENGTH) {
      return sendError(res, new GenerationError('invalid_request', 400));
    }
    if (providerName === '' || model === '') {
      return sendError(res, new GenerationError('invalid_request', 400));
    }

    try {
      const provider = await deps.resolveProvider({
        userId,
        role: user?.role,
        tenantId: user?.tenantId,
        provider: providerName,
      });

      if (provider == null || !isValidProvider(provider)) {
        return sendError(res, new GenerationError('provider_not_configured', 400));
      }
      if (!readModels(provider.models).includes(model)) {
        return sendError(res, new GenerationError('model_not_available', 400));
      }

      const tools = await deps.listTools({
        userId,
        role: user?.role,
        tenantId: user?.tenantId,
        idOnTheSource: user?.idOnTheSource,
      });

      const content = await completion({
        provider,
        model,
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(
          {
            prompt,
            provider: provider.name,
            model,
            draft: body.draft as AgentGenerateParams['draft'],
            locale: typeof body.locale === 'string' ? body.locale : undefined,
          },
          tools,
        ),
        signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      });

      return res.status(200).json({
        draft: parseGeneratedDraft(
          content,
          tools.map((tool) => tool.id),
        ),
        provider: provider.name,
        model,
      });
    } catch (error) {
      if (error instanceof GenerationError) {
        return sendError(res, error);
      }
      return sendError(res, new GenerationError('generation_failed', 502));
    }
  };
}
