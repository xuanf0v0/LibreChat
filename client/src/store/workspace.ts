import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

/**
 * The directory the composer sends to the agent for this browser.
 *
 * A path string, because the MCP filesystem tools take paths: a browser
 * directory handle has no path, so the picker resolves one through
 * `/api/workspace` and stores that. Persisted per browser rather than per
 * conversation — the workspace is where the reader works, not where one chat
 * happens to be.
 */
export const workspacePathAtom = atomWithStorage<string | null>('workspace:path', null);

/**
 * A single file the reader picked or dropped, as a path.
 *
 * Kept apart from the directory so the chip can name a file without pretending
 * the directory changed, and so dropping a file does not silently widen what
 * the agent may touch.
 */
export const workspaceFileAtom = atomWithStorage<string | null>('workspace:file', null);

/** Whether the picker dialog is open. */
export const workspacePickerOpenAtom = atom(false);
