import { buildAgentGenerateTools, createAgentGenerateHandler, parseGeneratedDraft } from './generate';

describe('buildAgentGenerateTools', () => {
  it('lists builtin and MCP tools by attachable id, skipping consume-only servers', () => {
    const tools = buildAgentGenerateTools({
      builtin: [{ pluginKey: 'web_search', name: 'Web Search', description: 'Search the web' }],
      mcpServers: {
        filesystem: {
          toolFunctions: {
            read_file_mcp_filesystem: {
              type: 'function',
              function: { name: 'read_file', description: 'Read a file' },
            },
          },
        },
        owned: {
          consumeOnly: true,
          toolFunctions: {
            hidden_tool_mcp_owned: {
              type: 'function',
              function: { name: 'hidden_tool' },
            },
          },
        },
      },
    });

    expect(tools).toEqual([
      { id: 'web_search', name: 'Web Search', description: 'Search the web' },
      { id: 'read_file_mcp_filesystem', name: 'read_file', description: 'Read a file' },
    ]);
  });
});

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
      tools: [],
    });
  });

  it('keeps only tool ids from the catalog and deduplicates them', () => {
    const draft = parseGeneratedDraft(
      JSON.stringify({
        name: 'A',
        instructions: 'B',
        tools: ['read_file_mcp_filesystem', 'invented_tool', 'read_file_mcp_filesystem'],
      }),
      ['read_file_mcp_filesystem'],
    );
    expect(draft.tools).toEqual(['read_file_mcp_filesystem']);
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
        tools: ['read_file_mcp_filesystem', 'invented_tool'],
      }),
    );
    const listTools = jest.fn().mockResolvedValue([
      { id: 'read_file_mcp_filesystem', name: 'read_file', description: 'Read a file' },
    ]);
    const handler = createAgentGenerateHandler({
      resolveProvider: jest.fn().mockResolvedValue(provider),
      listTools,
      requestCompletion,
    });
    const response = makeResponse();

    await handler(makeRequest() as never, response as never);

    expect(response.status).toHaveBeenCalledWith(200);
    const body = response.json.mock.calls[0][0];
    expect(body.draft.name).toBe('财报助手');
    expect(body.draft.tools).toEqual(['read_file_mcp_filesystem']);
    expect(body.provider).toBe('Fullon');
    expect(JSON.stringify(body)).not.toContain('secret-key');
    expect(requestCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        provider,
        model: 'deepseek-v4-pro',
        system: expect.stringContaining('JSON'),
        user: expect.stringContaining('read_file_mcp_filesystem'),
      }),
    );
  });

  it('rejects a model the provider does not expose', async () => {
    const listTools = jest.fn();
    const handler = createAgentGenerateHandler({
      resolveProvider: jest.fn().mockResolvedValue(provider),
      listTools,
      requestCompletion: jest.fn(),
    });
    const response = makeResponse();

    await handler(makeRequest({ model: 'other-model' }) as never, response as never);

    expect(listTools).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: 'model_not_available' });
  });

  it('rejects a missing provider without calling the model', async () => {
    const requestCompletion = jest.fn();
    const handler = createAgentGenerateHandler({
      resolveProvider: jest.fn().mockResolvedValue(null),
      listTools: jest.fn(),
      requestCompletion,
    });
    const response = makeResponse();

    await handler(makeRequest() as never, response as never);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: 'provider_not_configured' });
    expect(requestCompletion).not.toHaveBeenCalled();
  });
});
