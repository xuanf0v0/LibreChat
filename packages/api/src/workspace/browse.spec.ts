import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveWorkspaceRoots, isWithinRoots, listWorkspaceDirectory } from './browse';

describe('resolveWorkspaceRoots', () => {
  it('reads roots after the filesystem server package name', () => {
    const roots = resolveWorkspaceRoots({
      mcpServers: {
        filesystem: {
          type: 'stdio',
          command: 'npx',
          args: [
            '-y',
            '@modelcontextprotocol/server-filesystem',
            '/data/workspace',
            '/data/docs',
          ],
        },
      },
    } as never);

    expect(roots).toEqual([path.resolve('/data/workspace'), path.resolve('/data/docs')]);
  });

  it('ignores servers that are not the filesystem server', () => {
    const roots = resolveWorkspaceRoots({
      mcpServers: {
        other: { type: 'sse', url: 'http://localhost:3001/sse' },
      },
    } as never);

    expect(roots).toEqual([]);
  });

  it('returns nothing when no MCP servers are configured', () => {
    expect(resolveWorkspaceRoots({} as never)).toEqual([]);
    expect(resolveWorkspaceRoots(null)).toEqual([]);
  });
});

describe('isWithinRoots', () => {
  const roots = [path.resolve('/data/workspace')];

  it('admits the root itself and anything beneath it', () => {
    expect(isWithinRoots('/data/workspace', roots)).toBe(true);
    expect(isWithinRoots('/data/workspace/nested/file.txt', roots)).toBe(true);
  });

  it('rejects a sibling whose name merely starts with the root', () => {
    expect(isWithinRoots('/data/workspace-evil/secret.txt', roots)).toBe(false);
  });

  it('rejects traversal out of the root', () => {
    expect(isWithinRoots('/data/workspace/../secrets', roots)).toBe(false);
  });
});

describe('listWorkspaceDirectory', () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-browse-'));
    await fs.mkdir(path.join(root, 'sub'));
    await fs.writeFile(path.join(root, 'a.txt'), 'hello');
    await fs.mkdir(path.join(os.tmpdir(), 'workspace-outside'), { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('lists directories first, then files, with absolute paths', async () => {
    const result = await listWorkspaceDirectory(root, [root]);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.entries.map((entry) => entry.name)).toEqual(['sub', 'a.txt']);
    expect(result.value.entries[0].type).toBe('directory');
    expect(result.value.entries[1].path).toBe(path.join(root, 'a.txt'));
  });

  it('opens the first root when no path is requested', async () => {
    const result = await listWorkspaceDirectory(undefined, [root]);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.path).toBe(path.resolve(root));
  });

  it('refuses a path outside the roots', async () => {
    const result = await listWorkspaceDirectory(os.tmpdir(), [root]);
    expect(result).toEqual({ ok: false, error: { code: 'outside_roots' } });
  });

  it('refuses traversal written into the requested path', async () => {
    const result = await listWorkspaceDirectory(path.join(root, '..'), [root]);
    expect(result).toEqual({ ok: false, error: { code: 'outside_roots' } });
  });

  it('reports a missing directory rather than throwing', async () => {
    const result = await listWorkspaceDirectory(path.join(root, 'nope'), [root]);
    expect(result).toEqual({ ok: false, error: { code: 'not_found' } });
  });

  it('reports unconfigured roots distinctly from an empty directory', async () => {
    expect(await listWorkspaceDirectory(undefined, [])).toEqual({
      ok: false,
      error: { code: 'not_configured' },
    });
  });

  it('offers a parent only while it stays inside the roots', async () => {
    const atRoot = await listWorkspaceDirectory(root, [root]);
    expect(atRoot.ok && atRoot.value.parent).toBe(null);

    const nested = await listWorkspaceDirectory(path.join(root, 'sub'), [root]);
    expect(nested.ok && nested.value.parent).toBe(path.resolve(root));
  });
});
