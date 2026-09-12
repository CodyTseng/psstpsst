import type { ElectronBridge } from '../bridge';
import { electronDatabaseAdapter } from '../database';

function installBridge(database: Partial<ElectronBridge['database']>): void {
  window.psstpsstDesktop = {
    database: database as ElectronBridge['database'],
  } as ElectronBridge;
}

describe('Electron database adapter', () => {
  afterEach(() => {
    delete window.psstpsstDesktop;
  });

  it('scopes operations and nested savepoints to their transaction ids', async () => {
    const begin = jest
      .fn<Promise<string>, [string?]>()
      .mockResolvedValueOnce('outer')
      .mockResolvedValueOnce('nested');
    const execute = jest.fn().mockResolvedValue({ rows: [] });
    const commit = jest.fn().mockResolvedValue(undefined);
    installBridge({ begin, execute, commit, rollback: jest.fn() });

    await electronDatabaseAdapter.transaction(async (outer) => {
      await outer.execute('insert into messages values (?)', ['one'], 'run');
      await outer.transaction(async (nested) => {
        await nested.execute('insert into messages values (?)', ['two'], 'run');
      });
    });

    expect(begin.mock.calls).toEqual([[], ['outer']]);
    expect(execute.mock.calls).toEqual([
      ['insert into messages values (?)', ['one'], 'run', 'outer'],
      ['insert into messages values (?)', ['two'], 'run', 'nested'],
    ]);
    expect(commit.mock.calls).toEqual([['nested'], ['outer']]);
  });

  it('rolls back a failed transaction and preserves the original error', async () => {
    const rollback = jest.fn().mockResolvedValue(undefined);
    installBridge({
      begin: jest.fn().mockResolvedValue('tx'),
      commit: jest.fn(),
      rollback,
    });
    const failure = new Error('task failed');

    await expect(
      electronDatabaseAdapter.transaction(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(rollback).toHaveBeenCalledWith('tx');
  });

  it('pulls streamed rows in bounded batches and always closes the stream', async () => {
    const streamClose = jest.fn().mockResolvedValue(undefined);
    installBridge({
      streamOpen: jest.fn().mockResolvedValue('stream'),
      streamNext: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 1 }], done: false })
        .mockResolvedValueOnce({ rows: [{ id: 2 }], done: true }),
      streamClose,
    });
    const rows: { id: number }[] = [];

    for await (const row of electronDatabaseAdapter.rawQueryEach<{ id: number }>('select id')) {
      rows.push(row);
    }

    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(streamClose).toHaveBeenCalledWith('stream');
  });

  it('collects raw query rows from the object-mode read stream', async () => {
    installBridge({
      streamOpen: jest.fn().mockResolvedValue('stream'),
      streamNext: jest.fn().mockResolvedValue({ rows: [{ count: 2 }], done: true }),
      streamClose: jest.fn().mockResolvedValue(undefined),
    });

    await expect(electronDatabaseAdapter.rawQuery<{ count: number }>('select count(*)')).resolves
      .toEqual([{ count: 2 }]);
  });
});
