import { Model } from 'mongoose';
import type { ISuperAgentTaskDocument } from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import superAgentTaskSchema from '~/schema/superagent';

export function createSuperAgentTaskModel(
  mongoose: typeof import('mongoose'),
): Model<ISuperAgentTaskDocument> {
  applyTenantIsolation(superAgentTaskSchema);
  return (
    mongoose.models.SuperAgentTask ||
    mongoose.model<ISuperAgentTaskDocument>(
      'SuperAgentTask',
      superAgentTaskSchema,
      'superagent_tasks',
    )
  );
}
