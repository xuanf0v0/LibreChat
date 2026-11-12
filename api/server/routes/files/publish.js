const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { publishWorkspaceFile, contentTypeFor } = require('@librechat/api');
const { loadCustomConfig } = require('~/server/services/Config');
const { resolveWorkspaceRoots, isWithinRoots } = require('@librechat/api');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { FileSources } = require('librechat-data-provider');
const db = require('~/models');

const router = express.Router();

/**
 * Publishing a file the agent produced into a real attachment.
 *
 * The document MCP server writes files to disk, but the chat can only preview a
 * file it has a record for. This endpoint is how that record gets made: it takes
 * a workspace path, copies the bytes into LibreChat's own storage, and records
 * the file so the message can carry its `file_id`.
 *
 * ## Why not JWT
 *
 * The caller is a stdio MCP process, not a browser session — it has no JWT and
 * cannot mint one. It authenticates with `DOC_PUBLISH_TOKEN`, a value the
 * operator sets in the environment and passes to the server through
 * `librechat.yaml`. The user it publishes for is `DOC_PUBLISH_USER`, which the
 * MCP config fills from `{{LIBRECHAT_USER_ID}}`; that placeholder is resolved by
 * the connection the request already owns, so a server cannot name another
 * user. Admission costs a token leak into a local process the operator runs.
 *
 * The endpoint refuses without that token configured, rather than defaulting to
 * open: an unset `DOC_PUBLISH_TOKEN` means the feature is off.
 */

function readToken() {
  const token = process.env.DOC_PUBLISH_TOKEN;
  return typeof token === 'string' && token.trim() !== '' ? token.trim() : null;
}

/** Constant-time-ish comparison; the token is short and local, not a password. */
function tokenMatches(expected, provided) {
  if (typeof provided !== 'string') {
    return false;
  }
  if (provided.length !== expected.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return diff === 0;
}

module.exports = function publishRoutes() {
  router.post('/', async (req, res) => {
    const expected = readToken();
    if (expected == null) {
      return res.status(501).json({ error: 'publish_not_configured' });
    }
    const provided = req.get('x-doc-publish-token');
    if (!tokenMatches(expected, provided)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const filePath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
    if (userId === '' || filePath === '') {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const deploymentConfig = await loadCustomConfig();
    const roots = resolveWorkspaceRoots(deploymentConfig);
    if (!isWithinRoots(filePath, roots)) {
      return res.status(400).json({ error: 'outside_roots' });
    }
    if (contentTypeFor(filePath) == null) {
      return res.status(400).json({ error: 'unsupported_type' });
    }

    const { saveBuffer } = getStrategyFunctions(FileSources.local);

    const result = await publishWorkspaceFile(
      { path: filePath, ...(typeof req.body?.name === 'string' ? { name: req.body.name } : {}) },
      {
        userId,
        ...(typeof req.body?.conversationId === 'string'
          ? { conversationId: req.body.conversationId }
          : {}),
        ...(typeof req.body?.messageId === 'string' ? { messageId: req.body.messageId } : {}),
      },
      {
        read: (target) => require('fs').promises.readFile(target),
        saveBuffer: ({ buffer, fileName }) => saveBuffer({ userId, buffer, fileName }),
        createFile: (record) =>
          db.createFile({ ...record, user: userId }, true),
      },
    );

    if (!result.ok) {
      const status =
        result.error.code === 'unsupported'
          ? 400
          : result.error.code === 'not_found'
            ? 404
            : result.error.code === 'too_large'
              ? 413
              : 500;
      return res.status(status).json({ error: result.error.code });
    }

    /* Put the card on the message the reader is looking at. The assistant row is
     * still streaming when a tool publishes, so the conversation's newest row is
     * the anchor; without this the file exists but nothing in the transcript
     * points at it. A missing conversation is not an error — the file is
     * registered either way. */
    const conversationId =
      typeof req.body?.conversationId === 'string' ? req.body.conversationId.trim() : '';
    let attachedTo = null;
    if (conversationId !== '' && typeof db.attachFilesToLatestMessage === 'function') {
      try {
        attachedTo = await db.attachFilesToLatestMessage({
          user: userId,
          conversationId,
          fileIds: [result.value.file_id],
          ...(req.user?.tenantId != null ? { tenantId: req.user.tenantId } : {}),
        });
      } catch (error) {
        logger.warn(`[publish] could not attach ${result.value.file_id}: ${error.message}`);
      }
    }

    logger.info(
      `[publish] user=${userId} file=${result.value.file_id} name=${result.value.filename} bytes=${result.value.bytes} message=${attachedTo ?? 'none'}`,
    );
    res.status(201).json({ ...result.value, attachedTo });
  });

  return router;
};
