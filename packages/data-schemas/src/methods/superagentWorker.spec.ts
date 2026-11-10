import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createSuperAgentWorkerMethods } from './superagentWorker';
import { createSuperAgentWorkerModel } from '~/models/superagentWorker';

describe('SuperAgentWorker methods', () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    createSuperAgentWorkerModel(mongoose);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.db?.collection('superagent_workers').deleteMany({});
  });

  it('upserts one override per user and agent and lists it', async () => {
    const methods = createSuperAgentWorkerMethods(mongoose);
    const first = await methods.upsertSuperAgentWorker('user-1', 'agent-1', {
      capabilities: ['research'],
      allowedTools: [],
      maxSteps: 7,
    });
    expect(first.capabilities).toEqual(['research']);
    expect(first.allowedTools).toEqual([]);

    const second = await methods.upsertSuperAgentWorker('user-1', 'agent-1', {
      maxSteps: 9,
    });
    expect(second.maxSteps).toBe(9);
    expect(second.capabilities).toEqual(['research']);

    const list = await methods.listSuperAgentWorkers('user-1');
    expect(list).toHaveLength(1);
    expect(list[0].maxSteps).toBe(9);
  });

  it('isolates overrides by user', async () => {
    const methods = createSuperAgentWorkerMethods(mongoose);
    await methods.upsertSuperAgentWorker('user-1', 'agent-1', { maxSteps: 7 });
    await methods.upsertSuperAgentWorker('user-2', 'agent-1', { maxSteps: 9 });
    expect((await methods.listSuperAgentWorkers('user-1'))[0].maxSteps).toBe(7);
    expect((await methods.listSuperAgentWorkers('user-2'))[0].maxSteps).toBe(9);
  });

  it('deletes an override', async () => {
    const methods = createSuperAgentWorkerMethods(mongoose);
    await methods.upsertSuperAgentWorker('user-1', 'agent-1', { maxSteps: 7 });
    await expect(methods.deleteSuperAgentWorker('user-1', 'agent-1')).resolves.toBe(true);
    await expect(methods.getSuperAgentWorker('user-1', 'agent-1')).resolves.toBeNull();
  });
});
