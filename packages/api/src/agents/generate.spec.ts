import { createAgentGenerateHandler, parseGeneratedDraft } from './generate';

describe('parseGeneratedDraft', () => {
  it('accepts fenced JSON and bounds every field', () => {
    const draft = parseGeneratedDraft(
      '```json\n' +
        JSON.stringify({
          name: '  财报助手  ',
          description: '解读财报',
          instructions: '你是一名财报分析师。',
          category: 'finance',
          conversation_starters: ['分析财报', '分析财报', ''],
        }) +
        '\n```',
    );

    expect(draft).toEqual({
      name: '财报助手',
      description: '解读财报',
      instructions: '你是一名财报分析师。',
      category: 'finance',
      conversation_starters: ['分析财报'],
    });
  });

  it('rejects a response without a usable name or instructions', () => {
    expect(() => parseGeneratedDraft('{"name":"","instructions":""}')).toThrow();
    expect(() => parseGeneratedDraft('not json')).toThrow();
  });

  it('drops an unsafe category', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        name: 'A',
        instructions: 'B',
        category: 'evil<script>',
      }),
    );
    expect(draft.category).toBe('');
  });
});

describe('createAgentGenerateHandler', () => {
  const provider = {
    name: 'Fullon',
    baseURL: 'https://fullon.example/v1',
    apiKey: 'secret-key',
    kind: 'openai' as const,
    models: ['deepseek-v4-pro'],
  };

  const makeResponse = () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
    };
    return response;
  };

  const makeRequest = (body: Record<string, unknown> = {}) => ({
    user: { id: 'user-1' },
    body: {
      prompt: '创建一个财报分析助手',
      provider: 'Fullon',
      model: 'deepseek-v4-pro',
      ...body,
    },
  });

  it('returns a draft without persisting or exposing the key', async () => {
    const requestCompletion = jest.fn().mockResolvedValue(
      JSON.stringify({
        name: '财报助手',
        description: '解读财报',
        instructions: '你是一名财报分析师。',
        category: 'finance',
        conversation_starters: ['分析财报'],
      }),
    );
    const handler = createAgentGenerateHandler({
      resolveProvider: jest.fn().mockResolvedValue(provider),
      requestCompletion,
    });
    const response = makeResponse();

    await handler(makeRequest() as never, response as never);

    expect(response.status).toHaveBeenCalledWith(200);
    const body = response.json.mock.calls[0][0];
    expect(body.draft.name).toBe('财报助手');
    expect(body.provider).toBe('Fullon');
    expect(JSON.stringify(body)).not.toContain('secret-key');
    expect(requestCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        provider,
        model: 'deepseek-v4-pro',
        system: expect.stringContaining('JSON'),
      }),
    );
  });

  it('rejects a model the provider does not expose', async () => {
    const handler = createAgentGenerateHandler({
      resolveProvider: jest.fn().mockResolvedValue(provider),
      requestCompletion: jest.fn(),
    });
    const response = makeResponse();

    await handler(makeRequest({ model: 'other-model' }) as never, response as never);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: 'model_not_available' });
  });

  it('rejects a missing provider without calling the model', async () => {
    const requestCompletion = jest.fn();
    const handler = createAgentGenerateHandler({
      resolveProvider: jest.fn().mockResolvedValue(null),
      requestCompletion,
    });
    const response = makeResponse();

    await handler(makeRequest() as never, response as never);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: 'provider_not_configured' });
    expect(requestCompletion).not.toHaveBeenCalled();
  });
});
