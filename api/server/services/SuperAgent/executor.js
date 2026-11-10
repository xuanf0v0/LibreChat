const { createInProcessAgentInvoker } = require('@librechat/api');
const { ResourceType, PermissionBits } = require('librechat-data-provider');
const { findAccessibleResources } = require('~/server/services/PermissionService');
const { OpenAIChatCompletionController } = require('~/server/controllers/agents/openai');
const { getAppConfig } = require('~/server/services/Config');
const db = require('~/models');

const invokeAgent = createInProcessAgentInvoker({
  execute: (req, res) => OpenAIChatCompletionController(req, res),
  findUser: async (userId) => {
    const user = await db.findUser({ _id: userId });
    if (user == null) {
      return null;
    }
    return {
      id: String(user._id ?? user.id ?? userId),
      _id: user._id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      avatar: user.avatar,
      provider: user.provider,
    };
  },
  getConfig: (params) => getAppConfig(params),
  prepareAgent: async ({ userId, role, agentId }) => {
    const agent = await db.getAgent({ id: agentId });
    if (agent == null) {
      return null;
    }
    const accessible = await findAccessibleResources({
      userId,
      role,
      resourceType: ResourceType.AGENT,
      requiredPermissions: PermissionBits.VIEW,
    });
    if (!accessible.some((resourceId) => String(resourceId) === String(agent._id))) {
      return null;
    }
    return agent.toObject?.() ?? agent;
  },
});

module.exports = { invokeAgent };
