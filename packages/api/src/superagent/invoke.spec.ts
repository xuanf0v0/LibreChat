import { createInProcessAgentInvoker } from './invoke';

function baseDeps(overrides: Partial<Parameters<typeof createInProcessAgentInvoker>[0]> = {}) {
  return {
    execute: async (_req: unknown, res: unknown) => {
      (res as { status: (code: number) => { json: (body: unknown) => void } })
        .status(200)
        .json({ choices: [{ message: { content: 'done' } }] });
    },
    findUser: async () => ({ id: 'user-1', role: 'USER' }),
    getConfig: async () => ({}),
    prepareAgent: async () => ({ id: 'agent-1', tools: [] }),
    ...overrides,
  };
}

const input = {
  agentId: 'agent-1',
  goal: 'Do the job',
  userId: 'user-1',
  signal: new AbortController().signal,
};

describe('createInProcessAgentInvoker', () => {
  it('returns assistant content', async () => {
    const invoke = createInProcessAgentInvoker(baseDeps());
    await expect(invoke(input)).resolves.toEqual({ content: 'done' });
  });

  it('scopes the agent tools and recursion limit to the task policy', async () => {
    let seen: Record<string, unknown> | undefined;
    const invoke = createInProcessAgentInvoker(
      baseDeps({
        prepareAgent: async () => ({
          id: 'agent-1',
          tools: ['web_search', 'execute_code'],
        }),
        execute: async (req, res) => {
          seen = req as Record<string, unknown>;
          (res as { status: (code: number) => { json: (body: unknown) => void } })
            .status(200)
            .json({ choices: [{ message: { content: 'ok' } }] });
        },
      }),
    );

    await invoke({ ...input, allowedTools: ['web_search'], maxSteps: 7 });

    const override = seen?.agentOverride as
      | { tools?: string[]; recursion_limit?: number }
      | undefined;
    expect(override?.tools).toEqual(['web_search']);
    expect(override?.recursion_limit).toBe(7);
    expect(seen?.superAgentAllowedTools).toEqual(['web_search']);
  });

  it('rejects when the agent is not accessible', async () => {
    const invoke = createInProcessAgentInvoker(baseDeps({ prepareAgent: async () => null }));
    await expect(invoke(input)).rejects.toThrow('not accessible');
  });

  it('surfaces a non-success response without exposing the raw body', async () => {
    const invoke = createInProcessAgentInvoker(
      baseDeps({
        execute: async (_req, res) => {
          (res as { status: (code: number) => { json: (body: unknown) => void } })
            .status(403)
            .json({ error: { message: 'forbidden' } });
        },
      }),
    );
    await expect(invoke(input)).rejects.toThrow('Agent execution failed');
  });

  it('rejects an empty response', async () => {
    const invoke = createInProcessAgentInvoker(
      baseDeps({
        execute: async (_req, res) => {
          (res as { status: (code: number) => { json: (body: unknown) => void } })
            .status(200)
            .json({ choices: [] });
        },
      }),
    );
    await expect(invoke(input)).rejects.toThrow('empty');
  });

  it('rejects when aborted while the host execution hangs', async () => {
    const controller = new AbortController();
    const invoke = createInProcessAgentInvoker(
      baseDeps({
        execute: () => new Promise<void>(() => {}),
      }),
    );
    const pending = invoke({ ...input, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
  });
});
