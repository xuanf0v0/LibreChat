/**
 * Read-only directory browsing for the composer workspace picker.
 *
 * The browser cannot read a filesystem path: `showDirectoryPicker()` hands back
 * a handle whose only name-bearing field is the leaf directory, and a dropped
 * `File` carries a name but no path. The MCP filesystem tools, however, take
 * real paths. So the picker asks this server what is on disk and sends back a
 * path string.
 *
 * Scope is the configured MCP filesystem server's allowed directories. Nothing
 * outside those roots is listable, and the root list itself is the only thing
 * an unauthenticated-shaped request could otherwise enumerate.
 *
 * @module packages/api/src/workspace
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { MCPOptions } from 'librechat-data-provider';

/** The shape this module reads: the deployment's MCP server map. */
interface WorkspaceConfig {
  mcpServers?: Record<string, MCPOptions>;
  /** The operator's fence for the picker and the publish endpoint. */
  workspace?: {
    mode?: 'unrestricted' | 'roots';
    roots?: string[];
  };
}

/** One entry in a listed directory. */
export interface WorkspaceEntry {
  name: string;
  /** Absolute path, already resolved against the requested root. */
  path: string;
  type: 'file' | 'directory';
  size: number | null;
  modifiedAt: string | null;
}

export interface WorkspaceListing {
  /** The directory that was listed, absolute. */
  path: string;
  parent: string | null;
  entries: WorkspaceEntry[];
  /** True when the listing was cut at the entry cap. */
  truncated: boolean;
}

export type WorkspaceErrorCode =
  | 'not_configured'
  | 'outside_roots'
  | 'not_found'
  | 'not_a_directory'
  | 'permission_denied'
  | 'invalid_path'
  | 'already_exists';

export type WorkspaceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: WorkspaceErrorCode; message?: string } };

/** Entries returned per listing. Directories sort first, so the cap keeps the
 *  navigable half; a deeper directory is still reachable by descending. */
const MAX_ENTRIES = 500;

/**
 * The allowed roots, read from the deployment's MCP filesystem server config.
 *
 * `args` is `['-y', '@modelcontextprotocol/server-filesystem', ...roots]` for
 * the stdio server, so everything after the package name is a root. Other MCP
 * servers, and any filesystem server without roots, contribute nothing.
 *
 * An empty result means the deployment did not fence anything, and the process
 * permission is the boundary — the picker then opens on `process.cwd()` and may
 * browse anywhere the server can read.
 */
export function resolveWorkspaceRoots(appConfig: WorkspaceConfig | null | undefined): string[] {
  /** An explicit `roots` mode is the whole answer: the operator named the
   *  directories, so the MCP server's startup arguments are irrelevant. */
  const fence = appConfig?.workspace;
  if (fence?.mode === 'roots') {
    return [...new Set((fence.roots ?? []).map((root) => path.resolve(root)))];
  }
  if (fence?.mode === 'unrestricted') {
    return [];
  }

  const servers = appConfig?.mcpServers;
  if (servers == null || typeof servers !== 'object') {
    return [];
  }

  const roots: string[] = [];
  for (const server of Object.values(servers)) {
    const args = (server as { args?: unknown }).args;
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      continue;
    }
    const packageIndex = (args as string[]).findIndex((arg) =>
      arg.includes('@modelcontextprotocol/server-filesystem'),
    );
    if (packageIndex === -1) {
      continue;
    }
    for (const root of (args as string[]).slice(packageIndex + 1)) {
      if (root.startsWith('-')) {
        continue;
      }
      roots.push(path.resolve(root));
    }
  }
  return [...new Set(roots)];
}

/**
 * Whether `target` is one of the roots or sits beneath one.
 *
 * Resolved on both sides so `..` segments and mixed separators cannot walk out.
 * The prefix is built with a trailing separator so `/data/work` does not admit
 * `/data/workspace`; a root that already ends in one (a drive root like `C:\`)
 * keeps it rather than gaining a second.
 */
export function isWithinRoots(target: string, roots: readonly string[]): boolean {
  /** An empty root list is "no configured fence", not "nothing is reachable":
   *  the deployment asked for the process's own permissions to be the boundary,
   *  which is how a local agent reads a disk. A non-empty list still fences. */
  if (roots.length === 0) {
    return true;
  }
  const resolved = path.resolve(target);
  return roots.some((root) => {
    const normalizedRoot = path.resolve(root);
    if (resolved === normalizedRoot) {
      return true;
    }
    const prefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
    return resolved.startsWith(prefix);
  });
}

/** Where a search for a folder name starts when no fence is configured. */
const SEARCH_DEPTH = 4;
const SEARCH_BUDGET = 4000;

/**
 * Candidate directories whose name matches `name`.
 *
 * A browser's directory picker returns only the leaf name, so the path has to
 * be found again on the server. This walks a bounded slice of the filesystem
 * and reports every match rather than picking one: two folders can share a
 * name, and choosing for the reader would put their files somewhere they did
 * not pick.
 */
export async function findWorkspaceDirectories(
  name: string,
  roots: readonly string[],
): Promise<WorkspaceResult<WorkspaceEntry[]>> {
  const wanted = name.trim();
  if (wanted === '' || !isPlainName(wanted)) {
    return { ok: false, error: { code: 'invalid_path' } };
  }

  const starts = roots.length > 0 ? roots : [process.cwd()];
  const matches: WorkspaceEntry[] = [];
  let visited = 0;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > SEARCH_DEPTH || visited > SEARCH_BUDGET) {
      return;
    }
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      /** Unreadable directories are skipped, not fatal: the walk crosses
       *  system paths the account cannot list. */
      return;
    }
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) {
        continue;
      }
      visited += 1;
      if (visited > SEARCH_BUDGET) {
        return;
      }
      const child = path.join(dir, dirent.name);
      if (dirent.name.toLowerCase() === wanted.toLowerCase()) {
        matches.push({
          name: dirent.name,
          path: child,
          type: 'directory',
          size: null,
          modifiedAt: null,
        });
      }
      await walk(child, depth + 1);
    }
  };

  for (const start of starts) {
    await walk(path.resolve(start), 0);
  }

  return { ok: true, value: matches };
}

function toError(error: unknown): WorkspaceResult<never> {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') {
    return { ok: false, error: { code: 'not_found' } };
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return { ok: false, error: { code: 'permission_denied' } };
  }
  if (code === 'ENOTDIR') {
    return { ok: false, error: { code: 'not_a_directory' } };
  }
  return { ok: false, error: { code: 'invalid_path' } };
}

/**
 * List one directory inside the allowed roots.
 *
 * `requested` may be omitted, in which case the first root is listed — that is
 * the picker's opening view.
 */
export async function listWorkspaceDirectory(
  requested: string | undefined,
  roots: readonly string[],
): Promise<WorkspaceResult<WorkspaceListing>> {
  /** With no configured fence the picker opens on the process's own directory,
   *  which is where a locally launched agent would already be. */
  const target = path.resolve(requested?.trim() ? requested : (roots[0] ?? process.cwd()));
  if (!isWithinRoots(target, roots)) {
    return { ok: false, error: { code: 'outside_roots' } };
  }

  let dirents;
  try {
    dirents = await fs.readdir(target, { withFileTypes: true });
  } catch (error) {
    return toError(error);
  }

  const entries: WorkspaceEntry[] = [];
  for (const dirent of dirents) {
    const entryPath = path.join(target, dirent.name);
    let size: number | null = null;
    let modifiedAt: string | null = null;
    try {
      const stat = await fs.stat(entryPath);
      size = stat.isDirectory() ? null : stat.size;
      modifiedAt = stat.mtime.toISOString();
    } catch {
      /** A broken symlink or a race with a delete still lists; it just carries
       *  no metadata. Refusing the whole listing would hide its siblings. */
    }
    entries.push({
      name: dirent.name,
      path: entryPath,
      type: dirent.isDirectory() ? 'directory' : 'file',
      size,
      modifiedAt,
    });
  }

  /** Directories first, then case-insensitive name, so the picker's first
   *  screen is the navigable one regardless of the directory's own order. */
  entries.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  const truncated = entries.length > MAX_ENTRIES;
  const parentCandidate = path.dirname(target);
  const parent =
    parentCandidate !== target && isWithinRoots(parentCandidate, roots) ? parentCandidate : null;

  return {
    ok: true,
    value: {
      path: target,
      parent,
      entries: truncated ? entries.slice(0, MAX_ENTRIES) : entries,
      truncated,
    },
  };
}

/** A folder name that is one path segment: no separators, no traversal. */
function isPlainName(name: string): boolean {
  return (
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !/[\u0000-\u001f<>:"|?*]/.test(name)
  );
}

/**
 * Create one folder inside the allowed roots and return its listing.
 *
 * The picker's roots come from the deployment's MCP server arguments, so a
 * deployment whose root is a single empty directory would otherwise offer
 * nothing to choose. Creating a folder is the one write this module performs;
 * it stays inside the roots, and it never overwrites.
 */
export async function createWorkspaceDirectory(
  parent: string | undefined,
  name: string | undefined,
  roots: readonly string[],
): Promise<WorkspaceResult<WorkspaceListing>> {
  const base = path.resolve(parent?.trim() ? parent : (roots[0] ?? process.cwd()));
  if (!isWithinRoots(base, roots)) {
    return { ok: false, error: { code: 'outside_roots' } };
  }

  const folder = typeof name === 'string' ? name.trim() : '';
  if (!isPlainName(folder)) {
    return { ok: false, error: { code: 'invalid_path' } };
  }

  const target = path.join(base, folder);
  if (!isWithinRoots(target, roots)) {
    return { ok: false, error: { code: 'outside_roots' } };
  }

  try {
    await fs.mkdir(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return { ok: false, error: { code: 'already_exists' } };
    }
    return toError(error);
  }

  return listWorkspaceDirectory(target, roots);
}
