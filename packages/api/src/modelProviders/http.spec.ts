import { PrincipalModel, PrincipalType } from 'librechat-data-provider';
import type { ConfigRecord } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ModelProviderHttpDeps } from './http';
import type { ServerRequest } from '~/types/http';
import { createModelProviderHandlers } from './http';

jest.mock('~/admin/secrets', () => ({
  encryptConfigSecrets: (config: unknown) => config,
  preserveConfigSecrets: (next: unknown, previous: unknown) => {
    const config = next as {
      endpoints: { custom: Array<Record<string, unknown>> };
    };
    const prior = (previous as { endpoints?: { custom?: Array<Record<string, unknown>> } } | null)
      ?.endpoints?.custom;
    const priorByName = new Map(
      (prior ?? []).map((entry) => [String(entry.name).toLowerCase(), entry]),
    );
    return {
      ...config,
      endpoints: {
        ...config.endpoints,
        custom: config.endpoints.custom.map((entry) => {
          const old = priorByName.get(String(entry.name).toLowerCase());
          if (old == null || 'apiKey' in entry) {
            return entry;
          }
          return { ...entry, ...('apiKey' in old ? { apiKey: old.apiKey } : {}) };
        }),
      },
    };
  },
}));

type MockResponse = Response & { status: jest.Mock; json: jest.Mock };

function createResponse(): MockResponse {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as MockResponse;
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function createRequest(body: unknown): ServerRequest {
  return { user: { id: 'user-1', tenantId: 'tenant-1' }, body } as unknown as ServerRequest;
}

function setup(record: unknown, overrides: Partial<ModelProviderHttpDeps> = {}) {
  const deps: ModelProviderHttpDeps = {
    findConfigByPrincipal: jest.fn().mockResolvedValue(record as ConfigRecord | null),
    patchConfigFields: jest.fn().mockResolvedValue({} as ConfigRecord),
    invalidateConfigCaches: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { deps, ...createModelProviderHandlers(deps) };
}

describe('model provider handlers', () => {
  it('lists providers without exposing secrets', async () => {
    const { list } = setup({
      overrides: {
        endpoints: {
          custom: [
            {
              name: 'Fullon',
              baseURL: 'https://api.example.com/v1',
              models: { default: ['model-a', 'model-b'], fetch: false },
              apiKey: 'sk-secret',
              apiKeyPreview: 'sk-s...cret',
            },
          ],
        },
      },
    });
    const res = createResponse();

    await list(createRequest(undefined), res);

    expect(res.json).toHaveBeenCalledWith({
      providers: [
        {
          name: 'Fullon',
          baseURL: 'https://api.example.com/v1',
          models: ['model-a', 'model-b'],
          provider: 'openai',
          hasApiKey: true,
          apiKeyPreview: 'sk-s...cret',
        },
      ],
    });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('sk-secret');
  });

  it('rejects names that shadow built-in endpoints', async () => {
    const { save, deps } = setup(null);
    const res = createResponse();

    await save(
      createRequest({
        providers: [{ name: 'OpenAI', baseURL: 'https://api.example.com/v1', models: ['m'] }],
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_model_provider_name' }),
    );
    expect(deps.patchConfigFields).not.toHaveBeenCalled();
  });

  it('keeps the stored key when the base URL is unchanged', async () => {
    const existing = {
      overrides: {
        endpoints: {
          custom: [
            {
              name: 'Fullon',
              baseURL: 'https://api.example.com/v1',
              models: { default: ['old-model'] },
              apiKey: 'sk-old',
            },
          ],
        },
      },
    };
    const { save, deps } = setup(existing);
    const res = createResponse();

    await save(
      createRequest({
        providers: [
          { name: 'Fullon', baseURL: 'https://api.example.com/v1', models: ['new-model'] },
        ],
      }),
      res,
    );

    expect(res.status).not.toHaveBeenCalled();
    expect(deps.patchConfigFields).toHaveBeenCalledWith(
      PrincipalType.USER,
      'user-1',
      PrincipalModel.USER,
      {
        'endpoints.custom': [
          expect.objectContaining({
            name: 'Fullon',
            baseURL: 'https://api.example.com/v1',
            apiKey: 'sk-old',
            models: { default: ['new-model'], fetch: false },
          }),
        ],
      },
    );
    expect(deps.invalidateConfigCaches).toHaveBeenCalledWith('tenant-1');
  });

  it('requires a new key when the base URL changes', async () => {
    const { save, deps } = setup({
      overrides: {
        endpoints: {
          custom: [
            {
              name: 'Fullon',
              baseURL: 'https://old.example.com/v1',
              models: { default: ['m'] },
              apiKey: 'sk-old',
            },
          ],
        },
      },
    });
    const res = createResponse();

    await save(
      createRequest({
        providers: [{ name: 'Fullon', baseURL: 'https://new.example.com/v1', models: ['m'] }],
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'model_provider_api_key_required' }),
    );
    expect(deps.patchConfigFields).not.toHaveBeenCalled();
  });

  it('fetches Anthropic models with a submitted key', async () => {
    const fetchModels = jest.fn().mockResolvedValue(['claude-a', 'claude-b']);
    const { fetchProviderModels } = setup(null, { fetchModels });
    const res = createResponse();

    await fetchProviderModels(
      createRequest({
        baseURL: 'https://api.anthropic.com/v1',
        provider: 'anthropic',
        apiKey: 'sk-new',
      }),
      res,
    );

    expect(fetchModels).toHaveBeenCalledWith({
      apiKey: 'sk-new',
      baseURL: 'https://api.anthropic.com/v1',
      name: 'anthropic',
      baseURLIsUserProvided: true,
      skipCache: true,
      createTokenConfig: false,
    });
    expect(res.json).toHaveBeenCalledWith({ models: ['claude-a', 'claude-b'] });
  });

  it('reuses the stored key for a provider on the same URL and protocol', async () => {
    const fetchModels = jest.fn().mockResolvedValue(['claude-a']);
    const findStoredProvider = jest.fn().mockResolvedValue({
      baseURL: 'https://api.anthropic.com/v1',
      apiKey: 'sk-stored',
      provider: 'anthropic',
    });
    const { fetchProviderModels } = setup(null, { fetchModels, findStoredProvider });
    const res = createResponse();

    await fetchProviderModels(
      createRequest({
        name: 'Claude',
        baseURL: 'https://api.anthropic.com/v1',
        provider: 'anthropic',
      }),
      res,
    );

    expect(findStoredProvider).toHaveBeenCalledWith({
      userId: 'user-1',
      name: 'claude',
      role: undefined,
      tenantId: 'tenant-1',
    });
    expect(fetchModels).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-stored', name: 'anthropic' }),
    );
    expect(res.json).toHaveBeenCalledWith({ models: ['claude-a'] });
  });

  it('refuses the stored key when the URL or protocol changed', async () => {
    const fetchModels = jest.fn();
    const findStoredProvider = jest.fn().mockResolvedValue({
      baseURL: 'https://old.example.com/v1',
      apiKey: 'sk-old',
      provider: 'anthropic',
    });
    const { fetchProviderModels } = setup(null, { fetchModels, findStoredProvider });
    const res = createResponse();

    await fetchProviderModels(
      createRequest({
        name: 'Claude',
        baseURL: 'https://new.example.com/v1',
        provider: 'anthropic',
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'model_provider_api_key_required' }),
    );
    expect(fetchModels).not.toHaveBeenCalled();
  });
});
