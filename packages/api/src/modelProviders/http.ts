import { getConfigOverrideIssues } from '@librechat/data-schemas';
import { EModelEndpoint, PrincipalModel, PrincipalType } from 'librechat-data-provider';
import type {
  TModelProvider,
  TModelProviderKind,
  TModelProviderModelsResponse,
  TModelProvidersResponse,
} from 'librechat-data-provider';
import type { ConfigRecord } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { encryptConfigSecrets, preserveConfigSecrets } from '~/admin/secrets';

const MAX_PROVIDERS = 10;
const MAX_MODELS = 100;
const MAX_NAME_LENGTH = 48;
const MAX_URL_LENGTH = 2048;
const MAX_MODEL_LENGTH = 128;
const MAX_API_KEY_LENGTH = 4096;

/** Built-in endpoint keys must not be shadowed by a user provider: the custom
 *  entry would merge into that endpoint's config for this user. */
const RESERVED_NAMES = new Set(
  [
    ...Object.values(EModelEndpoint),
    'gptPlugins',
    'deepseek',
    'openrouter',
    'xai',
    'mistral',
    'vertexai',
    'azure',
  ].map((name) => name.trim().toLowerCase()),
);

export interface ModelProviderHttpDeps {
  findConfigByPrincipal: (
    principalType: PrincipalType,
    principalId: string,
    options?: { includeInactive?: boolean },
  ) => Promise<ConfigRecord | null>;
  patchConfigFields: (
    principalType: PrincipalType,
    principalId: string,
    principalModel: PrincipalModel,
    fields: Record<string, unknown>,
  ) => Promise<ConfigRecord>;
  invalidateConfigCaches?: (tenantId?: string) => Promise<unknown>;
  /** Reads the provider's model catalog with its stored, decrypted key. */
  fetchModels?: (params: {
    apiKey: string;
    baseURL: string;
    name: string;
    baseURLIsUserProvided: boolean;
    skipCache: boolean;
    createTokenConfig: boolean;
  }) => Promise<string[]>;
  /** Resolves the effective stored entry so a blank form key can reuse it. */
  findStoredProvider?: (params: {
    userId: string;
    name: string;
    role?: string;
    tenantId?: string;
  }) => Promise<{ baseURL: string; apiKey?: string; provider?: string } | null>;
}

type ProviderEntry = Record<string, unknown>;

function readProviderKind(value: unknown): TModelProviderKind {
  return value === EModelEndpoint.anthropic ? 'anthropic' : 'openai';
}

function normalizeName(name: unknown): string | null {
  if (typeof name !== 'string') {
    return null;
  }
  return name.trim().toLowerCase();
}

function readModels(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((model): model is string => typeof model === 'string');
  }
  if (value != null && typeof value === 'object' && 'default' in value) {
    const models = (value as { default?: unknown }).default;
    if (Array.isArray(models)) {
      return models.filter((model): model is string => typeof model === 'string');
    }
  }
  return [];
}

function readEntries(record: ConfigRecord | null): ProviderEntry[] {
  const custom = record?.overrides?.endpoints?.custom;
  if (!Array.isArray(custom)) {
    return [];
  }
  return custom.filter(
    (entry): entry is ProviderEntry => entry != null && typeof entry === 'object',
  );
}

function toView(entry: ProviderEntry): TModelProvider | null {
  if (typeof entry.name !== 'string' || typeof entry.baseURL !== 'string') {
    return null;
  }
  const apiKey = typeof entry.apiKey === 'string' ? entry.apiKey : '';
  return {
    name: entry.name,
    baseURL: entry.baseURL,
    models: readModels(entry.models),
    provider: readProviderKind(entry.provider),
    hasApiKey: apiKey.length > 0,
    ...(typeof entry.apiKeyPreview === 'string' ? { apiKeyPreview: entry.apiKeyPreview } : {}),
  };
}

function views(entries: ProviderEntry[]): TModelProvider[] {
  return entries.map(toView).filter((provider): provider is TModelProvider => provider != null);
}

function isProvidersBody(value: unknown): value is { providers: unknown[] } {
  return (
    value != null &&
    typeof value === 'object' &&
    'providers' in value &&
    Array.isArray(value.providers)
  );
}

function isProviderEntry(value: unknown): value is ProviderEntry {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isModelsBody(
  value: unknown,
): value is { name?: unknown; baseURL?: unknown; provider?: unknown; apiKey?: unknown } {
  return value != null && typeof value === 'object' && 'baseURL' in value;
}

function invalid(res: Response, code: string, details?: unknown) {
  return res.status(400).json({ error: code, ...(details == null ? {} : { details }) });
}

function parseModelList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const models: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      return null;
    }
    const model = item.trim();
    if (model === '' || model.length > MAX_MODEL_LENGTH) {
      return null;
    }
    models.push(model);
  }
  return [...new Set(models)];
}

function parseBaseURL(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const baseURL = value.trim().replace(/\/+$/, '');
  if (baseURL === '' || baseURL.length > MAX_URL_LENGTH || baseURL.includes('${')) {
    return null;
  }
  try {
    const url = new URL(baseURL);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    if (url.username !== '' || url.password !== '') {
      return null;
    }
  } catch {
    return null;
  }
  return baseURL;
}

function parseName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const name = value.trim();
  if (name === '' || name.length > MAX_NAME_LENGTH) {
    return null;
  }
  if (
    /[/\\:]/.test(name) ||
    [...name].some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    return null;
  }
  const normalized = normalizeName(name);
  if (normalized == null || RESERVED_NAMES.has(normalized)) {
    return null;
  }
  return name;
}

/**
 * The provider form owns a small projection of a custom endpoint: name, base
 * URL and model list. Unknown fields on an existing entry (headers, params)
 * are carried over so saving the form never silently drops advanced config.
 */
function buildEntry(
  input: ProviderEntry,
  existing: ProviderEntry | undefined,
): ProviderEntry | null {
  const name = parseName(input.name);
  const baseURL = parseBaseURL(input.baseURL);
  const models = parseModelList(input.models);
  if (
    name == null ||
    baseURL == null ||
    models == null ||
    models.length === 0 ||
    models.length > MAX_MODELS
  ) {
    return null;
  }

  const entry: ProviderEntry = { ...(existing ?? {}) };
  entry.name = name;
  if (baseURL !== existing?.baseURL) {
    /** A preserved key belongs to the URL it was entered for. Changing the
     *  host must require re-entering it rather than forwarding it elsewhere. */
    delete entry.apiKey;
    delete entry.apiKeyPreview;
  }
  entry.baseURL = baseURL;
  if (input.provider === EModelEndpoint.anthropic) {
    entry.provider = EModelEndpoint.anthropic;
  } else {
    delete entry.provider;
  }
  const existingModels =
    existing?.models != null &&
    typeof existing.models === 'object' &&
    !Array.isArray(existing.models)
      ? (existing.models as Record<string, unknown>)
      : {};
  entry.models = { ...existingModels, default: models, fetch: false };

  if (typeof input.apiKey === 'string' && input.apiKey.trim() !== '') {
    const apiKey = input.apiKey.trim();
    if (apiKey.length > MAX_API_KEY_LENGTH) {
      return null;
    }
    entry.apiKey = apiKey;
  } else {
    delete entry.apiKey;
    delete entry.apiKeyPreview;
  }
  return entry;
}

export interface ModelProviderHandlers {
  list(req: ServerRequest, res: Response): Promise<Response>;
  save(req: ServerRequest, res: Response): Promise<Response>;
  fetchProviderModels(req: ServerRequest, res: Response): Promise<Response>;
}

export function createModelProviderHandlers(deps: ModelProviderHttpDeps): ModelProviderHandlers {
  async function list(req: ServerRequest, res: Response) {
    const userId = req.user?.id;
    if (userId == null) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const record = await deps.findConfigByPrincipal(PrincipalType.USER, userId, {
      includeInactive: true,
    });
    const response: TModelProvidersResponse = { providers: views(readEntries(record)) };
    return res.json(response);
  }

  async function fetchProviderModels(req: ServerRequest, res: Response) {
    const userId = req.user?.id;
    if (userId == null) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (!isModelsBody(req.body)) {
      return invalid(res, 'invalid_model_provider');
    }
    const baseURL = parseBaseURL(req.body.baseURL);
    if (baseURL == null) {
      return invalid(res, 'invalid_model_provider_url');
    }

    const provider = readProviderKind(req.body.provider);
    let apiKey = typeof req.body.apiKey === 'string' ? req.body.apiKey.trim() : '';
    if (apiKey === '') {
      const name = normalizeName(req.body.name);
      const stored =
        name == null
          ? null
          : await deps.findStoredProvider?.({
              userId,
              name,
              role: req.user?.role,
              tenantId: req.user?.tenantId,
            });
      if (stored != null) {
        if (stored.baseURL !== baseURL || readProviderKind(stored.provider) !== provider) {
          return invalid(res, 'model_provider_api_key_required');
        }
        apiKey = stored.apiKey ?? '';
      }
    }
    if (apiKey === '') {
      return invalid(res, 'model_provider_api_key_required');
    }
    if (deps.fetchModels == null) {
      return res.status(503).json({ error: 'model_provider_fetch_unavailable' });
    }

    const models = await deps.fetchModels({
      apiKey,
      baseURL,
      name: provider,
      baseURLIsUserProvided: true,
      skipCache: true,
      createTokenConfig: false,
    });
    const response: TModelProviderModelsResponse = {
      models: [...new Set(models.filter((model) => model.trim() !== ''))].slice(0, MAX_MODELS),
    };
    return res.json(response);
  }

  async function save(req: ServerRequest, res: Response) {
    const userId = req.user?.id;
    if (userId == null) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (!isProvidersBody(req.body)) {
      return invalid(res, 'invalid_model_providers');
    }
    const input = req.body.providers;
    if (input.length > MAX_PROVIDERS) {
      return invalid(res, 'too_many_model_providers');
    }

    const record = await deps.findConfigByPrincipal(PrincipalType.USER, userId, {
      includeInactive: true,
    });
    const existingEntries = readEntries(record);
    const existingByName = new Map<string, ProviderEntry>();
    for (const entry of existingEntries) {
      const normalized = normalizeName(entry.name);
      if (normalized != null) {
        existingByName.set(normalized, entry);
      }
    }

    const entries: ProviderEntry[] = [];
    const seen = new Set<string>();
    for (const raw of input) {
      if (!isProviderEntry(raw)) {
        return invalid(res, 'invalid_model_provider');
      }
      const provider = raw;
      const normalized = normalizeName(provider.name);
      if (normalized == null || RESERVED_NAMES.has(normalized)) {
        return invalid(res, 'invalid_model_provider_name');
      }
      if (seen.has(normalized)) {
        return invalid(res, 'duplicate_model_provider_name');
      }
      seen.add(normalized);

      const existing = existingByName.get(normalized);
      const entry = buildEntry(provider, existing);
      if (entry == null) {
        return invalid(res, 'invalid_model_provider');
      }
      const submittedKey = typeof provider.apiKey === 'string' ? provider.apiKey.trim() : '';
      /** A stored key is bound to the URL and protocol it was entered for.
       *  Require a new key when either changes instead of silently reusing it. */
      const providerChanged =
        existing != null &&
        readProviderKind(provider.provider) !== readProviderKind(existing.provider);
      if (
        existing != null &&
        submittedKey === '' &&
        (parseBaseURL(provider.baseURL) !== existing.baseURL || providerChanged)
      ) {
        return invalid(res, 'model_provider_api_key_required');
      }
      entries.push(entry);
    }

    const encrypted = encryptConfigSecrets({ endpoints: { custom: entries } });
    const preserved = preserveConfigSecrets(encrypted, record?.overrides ?? {});
    const nextEntries = preserved.endpoints.custom;

    const issues = getConfigOverrideIssues({ endpoints: { custom: nextEntries } });
    if (issues.length > 0) {
      return invalid(
        res,
        'invalid_model_provider',
        issues.map((issue) => ({ path: issue.path, code: issue.code })),
      );
    }

    await deps.patchConfigFields(PrincipalType.USER, userId, PrincipalModel.USER, {
      'endpoints.custom': nextEntries,
    });
    await deps.invalidateConfigCaches?.(req.user?.tenantId);

    const response: TModelProvidersResponse = { providers: views(nextEntries) };
    return res.json(response);
  }

  return { list, save, fetchProviderModels };
}
