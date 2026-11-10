import { Model } from 'mongoose';
import type { ISuperAgentWorkerDocument } from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import superAgentWorkerSchema from '~/schema/superagentWorker';

export function createSuperAgentWorkerModel(
  mongoose: typeof import('mongoose'),
): Model<ISuperAgentWorkerDocument> {
  applyTenantIsolation(superAgentWorkerSchema);
  return (
    mongoose.models.SuperAgentWorker ||
    mongoose.model<ISuperAgentWorkerDocument>(
      'SuperAgentWorker',
      superAgentWorkerSchema,
      'superagent_workers',
    )
  );
}
