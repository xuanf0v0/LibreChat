const {
  buildAgentGenerateTools,
  createAgentGenerateHandler,
  listAvailableTools,
  resolveConfigSecret,
} = require('@librechat/api');
const { resolveAllMcpConfigs } = require('~/server/services/MCP');
const { getAppConfig, getCachedTools } = require('~/server/services/Config');
const { availableTools, toolkits } = require('~/app/clients/tools');

const readModels = (value) => {
  if (Array.isArray(value)) {
    return value.filter((model) => typeof model === 'string');
  }
  if (value != null && typeof value === 'object' && Array.isArray(value.default)) {
    return value.default.filter((model) => typeof model === 'string');
  }
  return [];
};

/** Resolves only user-configured custom providers; native endpoints keep their keys
 *  outside the request layer this feature is allowed to read. */
const resolveProvider = async ({ userId, role, tenantId, provider }) => {
  const appConfig = await getAppConfig({ userId, role, tenantId });
  const entries = Array.isArray(appConfig?.endpoints?.custom) ? appConfig.endpoints.custom : [];
  const normalized = provider.trim().toLowerCase();
  const entry = entries.find(
    (candidate) =>
      typeof candidate?.name === 'string' && candidate.name.trim().toLowerCase() === normalized,
  );
  if (entry == null) {
    return null;
  }

  return {
    name: entry.name,
    baseURL: entry.baseURL,
    apiKey: resolveConfigSecret(entry.apiKey) ?? '',
    kind: entry.provider === 'anthropic' ? 'anthropic' : 'openai',
    models: readModels(entry.models),
  };
};

/** The builtin tools the agent panel lists plus every MCP tool of a reachable server. */
const listTools = async ({ userId, role, tenantId, idOnTheSource }) => {
  const [appConfig, toolDefinitions, mcpServers] = await Promise.all([
    getAppConfig({ userId, role, tenantId }),
    getCachedTools(),
    resolveAllMcpConfigs(userId, { role, idOnTheSource }),
  ]);

  return buildAgentGenerateTools({
    builtin: listAvailableTools({
      manifest: availableTools,
      toolkits,
      toolDefinitions,
      githubCompare: appConfig?.githubCompare,
    }),
    mcpServers,
  });
};

module.exports = createAgentGenerateHandler({ resolveProvider, listTools });
