const express = require('express');
const { createModelProviderHandlers, fetchModels, resolveConfigSecret } = require('@librechat/api');
const { getAppConfig, invalidateConfigCaches } = require('~/server/services/Config');
const { requireJwtAuth, requireSameOrigin } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();
const handlers = createModelProviderHandlers({
  findConfigByPrincipal: db.findConfigByPrincipal,
  patchConfigFields: db.patchConfigFields,
  invalidateConfigCaches,
  fetchModels,
  findStoredProvider: async ({ userId, name, role, tenantId }) => {
    const appConfig = await getAppConfig({ userId, role, tenantId });
    const entries = appConfig?.endpoints?.custom ?? [];
    const entry = entries.find((candidate) => candidate.name?.trim().toLowerCase() === name);
    if (entry == null) {
      return null;
    }
    return {
      baseURL: entry.baseURL,
      apiKey: resolveConfigSecret(entry.apiKey),
      provider: entry.provider,
    };
  },
});

router.get('/', requireJwtAuth, handlers.list);
router.put('/', requireJwtAuth, requireSameOrigin, handlers.save);
router.post('/models', requireJwtAuth, requireSameOrigin, handlers.fetchProviderModels);

module.exports = router;
