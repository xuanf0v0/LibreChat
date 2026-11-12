/**
 * Publishing a file the agent wrote into the workspace.
 *
 * The document tools produce real files on disk, but the chat only knows how to
 * preview a file it has a record for: `FilePreviewDialog` fetches bytes through
 * `/api/files/download/:userId/:file_id`, which reads LibreChat's own storage.
 * This module closes that gap — it copies a workspace file into storage, records
 * it, and hands back the `file_id` the message can carry as an attachment.
 *
 * @module packages/api/src/files/publish
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';

/** Where a published file came from, for the message-level provenance. */
export interface PublishSource {
  /** Absolute path inside a workspace root. */
  path: string;
  /** Display name; defaults to the path's own basename. */
  name?: string;
}

export interface PublishDeps {
  /** Reads the file off disk. Injected so the caller owns the containment rule. */
  read: (filePath: string) => Promise<Buffer>;
  /** Writes the buffer into LibreChat's storage and returns its storage key. */
  saveBuffer: (input: { buffer: Buffer; fileName: string }) => Promise<string>;
  /** Records the file, returning the id the client will fetch it by. */
  createFile: (record: PublishRecord) => Promise<{ file_id: string } | null>;
  /** Resolves a stored file's bytes back out, for the preview endpoint. */
  storagePath?: (key: string) => string;
}

export interface PublishRecord {
  file_id: string;
  filename: string;
  filepath: string;
  type: string;
  bytes: number;
  user: string;
  context: 'message_attachment';
  source: string;
  conversationId?: string;
  messageId?: string;
  tenantId?: string;
}

export type PublishErrorCode = 'not_found' | 'too_large' | 'unsupported' | 'storage_failed';

export type PublishResult =
  | { ok: true; value: { file_id: string; filename: string; type: string; bytes: number } }
  | { ok: false; error: { code: PublishErrorCode; message?: string } };

/** Extensions the chat can show inline, mapped to the type it previews them as. */
const PREVIEWABLE: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/**
 * A docx or xlsx has no inline viewer, so publishing one still gives the reader a
 * working download — it just opens in the browser's own application, not here.
 */
const DOWNLOADABLE: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
};

const MAX_BYTES = 64 * 1024 * 1024;

/** The media type a published file is stored and served under. */
export function contentTypeFor(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return PREVIEWABLE[ext] ?? DOWNLOADABLE[ext] ?? null;
}

/** Whether the chat can render this file inline instead of only offering it. */
export function isPreviewable(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() in PREVIEWABLE;
}

/**
 * Copy one workspace file into storage and record it.
 *
 * The record uses `context: 'message_attachment'`, which is the context the
 * client's attachment renderer expects; `execute_code` would route it through
 * the code-environment download path, which this deployment does not run.
 */
export async function publishWorkspaceFile(
  source: PublishSource,
  owner: { userId: string; conversationId?: string; messageId?: string; tenantId?: string },
  deps: PublishDeps,
): Promise<PublishResult> {
  const type = contentTypeFor(source.path);
  if (type == null) {
    return { ok: false, error: { code: 'unsupported' } };
  }

  let buffer: Buffer;
  try {
    buffer = await deps.read(source.path);
  } catch {
    return { ok: false, error: { code: 'not_found' } };
  }
  if (buffer.byteLength > MAX_BYTES) {
    return { ok: false, error: { code: 'too_large' } };
  }

  const filename = (source.name ?? path.basename(source.path)).trim() || path.basename(source.path);
  let filepath: string;
  try {
    filepath = await deps.saveBuffer({ buffer, fileName: filename });
  } catch {
    return { ok: false, error: { code: 'storage_failed' } };
  }

  const record: PublishRecord = {
    file_id: randomUUID(),
    filename,
    filepath,
    type,
    bytes: buffer.byteLength,
    user: owner.userId,
    context: 'message_attachment',
    source: 'local',
    ...(owner.conversationId != null ? { conversationId: owner.conversationId } : {}),
    ...(owner.messageId != null ? { messageId: owner.messageId } : {}),
    ...(owner.tenantId != null ? { tenantId: owner.tenantId } : {}),
  };

  let created: { file_id: string } | null;
  try {
    created = await deps.createFile(record);
  } catch {
    return { ok: false, error: { code: 'storage_failed' } };
  }
  if (created == null) {
    return { ok: false, error: { code: 'storage_failed' } };
  }

  return {
    ok: true,
    value: { file_id: created.file_id, filename, type, bytes: buffer.byteLength },
  };
}
