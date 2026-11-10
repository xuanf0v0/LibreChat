import { Schema } from 'mongoose';
import type { ISuperAgentWorkerDocument } from '~/types';

const superAgentWorkerSchema: Schema<ISuperAgentWorkerDocument> =
  new Schema<ISuperAgentWorkerDocument>(
    {
      user: { type: String, required: true, index: true },
      tenantId: { type: String, index: true },
      agentId: { type: String, required: true, maxlength: 128 },
      capabilities: { type: [String], default: [] },
      allowedTools: { type: [String], default: null },
      maxSteps: { type: Number, default: 25, min: 1, max: 100 },
      timeoutMs: { type: Number, default: 300_000, min: 1_000, max: 600_000 },
      maxConcurrentRuns: { type: Number, default: 1, min: 1, max: 10 },
      maxRunsPerTask: { type: Number, default: 4, min: 1, max: 12 },
      enabled: { type: Boolean, default: true },
      trinityAgentName: { type: String, maxlength: 128, default: null },
    },
    { timestamps: true },
  );

superAgentWorkerSchema.index({ user: 1, tenantId: 1, agentId: 1 }, { unique: true });

export default superAgentWorkerSchema;
