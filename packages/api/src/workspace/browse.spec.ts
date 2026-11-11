import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveWorkspaceRoots, isWithinRoots, listWorkspaceDirectory, createWorkspaceDirectory } from './browse';

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

describe('createWorkspaceDirectory', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-create-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('creates the folder and lists it', async () => {
    const result = await createWorkspaceDirectory(root, 'notes', [root]);

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.path).toBe(path.join(root, 'notes'));
    expect(result.ok && result.value.entries).toEqual([]);
    await expect(fs.stat(path.join(root, 'notes'))).resolves.toBeTruthy();
  });

  it('refuses to overwrite an existing folder', async () => {
    await fs.mkdir(path.join(root, 'notes'));

    expect(await createWorkspaceDirectory(root, 'notes', [root])).toEqual({
      ok: false,
      error: { code: 'already_exists' },
    });
  });

  it('refuses a name that escapes the parent', async () => {
    for (const name of ['..', '../escape', 'a/b', 'a\\b', '', '  ']) {
      expect(await createWorkspaceDirectory(root, name, [root])).toEqual({
        ok: false,
        error: { code: 'invalid_path' },
      });
    }
    await expect(fs.stat(path.join(root, '..', 'escape'))).rejects.toBeTruthy();
  });

  it('refuses a parent outside the roots', async () => {
    expect(await createWorkspaceDirectory(os.tmpdir(), 'x', [root])).toEqual({
      ok: false,
      error: { code: 'outside_roots' },
    });
  });

  it('reports unconfigured roots distinctly', async () => {
    expect(await createWorkspaceDirectory(root, 'x', [])).toEqual({
      ok: false,
      error: { code: 'not_configured' },
    });
  });
});

/**
 * A drive root already ends in a separator. Appending another one produced
 * `C:\\` and rejected every path beneath it, which left a picker opened on a
 * drive unable to descend.
 */
describe('isWithinRoots with a drive root', () => {
  const driveRoot = path.parse(process.cwd()).root;
  const nested = path.join(driveRoot, 'Users', 'someone', 'documents');

  it('admits a directory beneath a drive root', () => {
    expect(isWithinRoots(nested, [driveRoot])).toBe(true);
  });

  it('admits the drive root itself', () => {
    expect(isWithinRoots(driveRoot, [driveRoot])).toBe(true);
  });

  it('still refuses a different drive', () => {
    const otherDrive = process.platform === 'win32' ? 'Z:\\' : '/proc';
    expect(isWithinRoots(path.join(otherDrive, 'x'), [driveRoot])).toBe(false);
  });

  it('still refuses a sibling that shares a name prefix', () => {
    expect(isWithinRoots('/data/workspace-evil', ['/data/workspace'])).toBe(false);
  });
});
