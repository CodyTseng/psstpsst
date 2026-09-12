import type { WebContents } from 'electron';

import { DatabaseService, type DatabaseWorkerClient } from '../database-service';

function createWorker() {
  const requests: { command: string; payload?: Record<string, unknown> }[] = [];
  const worker: DatabaseWorkerClient = {
    async request<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
      requests.push({ command, payload });
      if (command === 'execute') return { rows: [] } as T;
      return undefined as T;
    },
    close: jest.fn().mockResolvedValue(undefined),
  };
  return { worker, requests };
}

describe('Electron database service', () => {
  it('holds the global queue for the complete transaction', async () => {
    const { worker, requests } = createWorker();
    const service = new DatabaseService('', jest.fn(), jest.fn(), worker);
    const transactionId = await service.begin(1);

    const outside = service.execute(2, 'select 1', [], 'all');
    await Promise.resolve();
    expect(requests.map((request) => request.command)).toEqual(['begin']);

    await service.execute(1, 'insert into t values (1)', [], 'run', transactionId);
    await service.commit(1, transactionId);
    await outside;

    expect(requests.map((request) => request.command)).toEqual([
      'begin',
      'execute',
      'commit',
      'execute',
    ]);
  });

  it('emits a change only after a dirty transaction commits', async () => {
    const { worker } = createWorker();
    const owner = {} as WebContents;
    const emitChange = jest.fn();
    const service = new DatabaseService('', emitChange, () => owner, worker);
    const transactionId = await service.begin(7);

    await service.execute(7, 'update messages set content = ?', ['new'], 'run', transactionId);
    expect(emitChange).not.toHaveBeenCalled();
    await service.commit(7, transactionId);
    expect(emitChange).toHaveBeenCalledWith(owner);
  });

  it('does not emit changes for a rolled-back transaction', async () => {
    const { worker } = createWorker();
    const emitChange = jest.fn();
    const service = new DatabaseService('', emitChange, () => ({}) as WebContents, worker);
    const transactionId = await service.begin(7);

    await service.execute(7, 'delete from messages', [], 'run', transactionId);
    await service.rollback(7, transactionId);
    expect(emitChange).not.toHaveBeenCalled();
  });

  it('rejects transaction ids owned by another renderer', async () => {
    const { worker } = createWorker();
    const service = new DatabaseService('', jest.fn(), jest.fn(), worker);
    const transactionId = await service.begin(1);

    await expect(service.commit(2, transactionId)).rejects.toThrow(
      'Invalid or foreign database transaction',
    );
    await service.rollback(1, transactionId);
  });

  it('rolls back and releases the queue when a renderer is destroyed', async () => {
    const { worker, requests } = createWorker();
    const service = new DatabaseService('', jest.fn(), jest.fn(), worker);
    await service.begin(1);
    const outside = service.execute(2, 'select 1', [], 'all');

    await service.cleanupOwner(1);
    await outside;
    expect(requests.map((request) => request.command)).toEqual([
      'begin',
      'rollback',
      'execute',
    ]);
  });
});
