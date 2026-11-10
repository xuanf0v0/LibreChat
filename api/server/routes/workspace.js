const express = require('express');
const { listWorkspaceDirectory, resolveWorkspaceRoots } = require('@librechat/api');
const { loadCustomConfig } = require('~/server/services/Config');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

/**
 * The allowed roots live on the deployment's `librechat.yaml`, not on a
 * principal's app config: `mcpServers` is operator-owned and never overlaid per
 * user, so `getAppConfig` does not carry it.
 */
async function rootsForRequest() {
  const deploymentConfig = await loadCustomConfig();
  return resolveWorkspaceRoots(deploymentConfig);
}

/**
 * Lists the roots the composer's workspace picker may browse.
 *
 * The picker cannot read the disk itself — a browser directory handle carries
 * no path — so it asks here and sends the chosen path to the agent.
 */
router.get('/', requireJwtAuth, async (_req, res) => {
  const roots = await rootsForRequest();
  res.json({ roots });
});

/**
 * Lists one directory inside those roots.
 *
 * `path` is optional: omitting it opens the first root, which is what the
 * picker shows before the reader navigates anywhere.
 */
router.get('/entries', requireJwtAuth, async (req, res) => {
  const roots = await rootsForRequest();
  const requested = typeof req.query.path === 'string' ? req.query.path : undefined;

  const result = await listWorkspaceDirectory(requested, roots);
  if (!result.ok) {
    const status =
      result.error.code === 'not_configured'
        ? 501
        : result.error.code === 'outside_roots' || result.error.code === 'invalid_path'
          ? 400
          : result.error.code === 'permission_denied'
            ? 403
            : 404;
    return res.status(status).json({ error: result.error.code });
  }

  res.json(result.value);
});

module.exports = router;
