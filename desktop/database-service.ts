import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import type { WebContents } from 'electron';

import type { SqlBindValue, SqliteQueryMethod } from '../src/platform/ports/database';

type WorkerResponse = { id: number; result?: unknown; error?: string };
type Transaction = {
  id: string;
  ownerId: number;
  parentId?: string;
  savepoint?: string;
  dirty: boolean;
  release?: () => void;
};

export interface DatabaseWorkerClient {
  request<T>(command: string, payload?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

class WorkerClient implements DatabaseWorkerClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  constructor(databasePath: string) {
    const bundledWorkerPath = path.join(__dirname, 'database-worker.js');
    const workerPath = bundledWorkerPath.includes('app.asar')
      ? bundledWorkerPath.replace('app.asar', 'app.asar.unpacked')
      : bundledWorkerPath;
    this.worker = new Worker(workerPath, {
      workerData: { databasePath },
    });
    this.worker.on('message', (response: WorkerResponse) => {
      const request = this.pending.get(response.id);
      if (!request) return;
      this.pending.delete(response.id);
      if (response.error) request.reject(new Error(response.error));
      else request.resolve(response.result);
    });
    this.worker.on('error', (error) => {
      const workerError = error instanceof Error ? error : new Error(String(error));
      for (const request of this.pending.values()) request.reject(workerError);
      this.pending.clear();
    });
  }

  request<T>(command: string, payload: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.worker.postMessage({ id, command, payload });
    });
  }

  async close(): Promise<void> {
    await this.request('close').catch(() => undefined);
    await this.worker.terminate();
  }
}

function mutatesDatabase(sql: string, method?: SqliteQueryMethod): boolean {
  if (method === 'run') return true;
  return /^\s*(?:insert|update|delete|replace|create|drop|alter|vacuum|reindex)\b/i.test(sql);
}

export class DatabaseService {
  private readonly worker: DatabaseWorkerClient;
  private readonly transactions = new Map<string, Transaction>();
  private serializedTail: Promise<void> = Promise.resolve();
  private readonly streams = new Map<string, number>();

  constructor(
    databasePath: string,
    private readonly emitChange: (owner: WebContents) => void,
    private readonly resolveWebContents: (id: number) => WebContents | null,
    worker?: DatabaseWorkerClient,
  ) {
    this.worker = worker ?? new WorkerClient(databasePath);
  }

  private acquire(): Promise<() => void> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waitingFor = this.serializedTail;
    this.serializedTail = waitingFor.then(() => gate);
    return waitingFor.then(() => release);
  }

  private transaction(id: string, ownerId: number): Transaction {
    const transaction = this.transactions.get(id);
    if (!transaction || transaction.ownerId !== ownerId) {
      throw new Error('Invalid or foreign database transaction');
    }
    return transaction;
  }

  private markDirty(transaction: Transaction): void {
    transaction.dirty = true;
  }

  async execute(
    ownerId: number,
    sql: string,
    params: SqlBindValue[],
    method: SqliteQueryMethod,
    transactionId?: string,
  ): Promise<{ rows: unknown }> {
    if (transactionId) {
      const transaction = this.transaction(transactionId, ownerId);
      const result = await this.worker.request<{ rows: unknown }>('execute', {
        sql,
        params,
        method,
      });
      if (mutatesDatabase(sql, method)) this.markDirty(transaction);
      return result;
    }
    const release = await this.acquire();
    try {
      const result = await this.worker.request<{ rows: unknown }>('execute', {
        sql,
        params,
        method,
      });
      if (mutatesDatabase(sql, method)) {
        const owner = this.resolveWebContents(ownerId);
        if (owner) this.emitChange(owner);
      }
      return result;
    } finally {
      release();
    }
  }

  async exec(ownerId: number, sql: string, transactionId?: string): Promise<void> {
    if (transactionId) {
      const transaction = this.transaction(transactionId, ownerId);
      await this.worker.request('exec', { sql });
      if (mutatesDatabase(sql)) this.markDirty(transaction);
      return;
    }
    const release = await this.acquire();
    try {
      await this.worker.request('exec', { sql });
      if (mutatesDatabase(sql)) {
        const owner = this.resolveWebContents(ownerId);
        if (owner) this.emitChange(owner);
      }
    } finally {
      release();
    }
  }

  async runBatch(
    ownerId: number,
    sql: string,
    paramsBatch: SqlBindValue[][],
    transactionId?: string,
  ): Promise<void> {
    if (transactionId) {
      const transaction = this.transaction(transactionId, ownerId);
      await this.worker.request('runBatch', { sql, paramsBatch });
      if (paramsBatch.length) this.markDirty(transaction);
      return;
    }
    const id = await this.begin(ownerId);
    try {
      await this.runBatch(ownerId, sql, paramsBatch, id);
      await this.commit(ownerId, id);
    } catch (error) {
      await this.rollback(ownerId, id);
      throw error;
    }
  }

  async begin(ownerId: number, parentId?: string): Promise<string> {
    const id = randomUUID();
    if (parentId) {
      this.transaction(parentId, ownerId);
      const savepoint = `psstpsst_nested_${id.replace(/-/g, '')}`;
      await this.worker.request('savepoint', { name: savepoint });
      this.transactions.set(id, { id, ownerId, parentId, savepoint, dirty: false });
      return id;
    }
    const release = await this.acquire();
    try {
      await this.worker.request('begin');
    } catch (error) {
      release();
      throw error;
    }
    this.transactions.set(id, { id, ownerId, dirty: false, release });
    return id;
  }

  async commit(ownerId: number, id: string): Promise<void> {
    const transaction = this.transaction(id, ownerId);
    if (transaction.parentId) {
      await this.worker.request('release', { name: transaction.savepoint });
      if (transaction.dirty) {
        this.transaction(transaction.parentId, ownerId).dirty = true;
      }
      this.transactions.delete(id);
      return;
    }
    try {
      await this.worker.request('commit');
      if (transaction.dirty) {
        const owner = this.resolveWebContents(ownerId);
        if (owner) this.emitChange(owner);
      }
    } finally {
      this.transactions.delete(id);
      transaction.release?.();
    }
  }

  async rollback(ownerId: number, id: string): Promise<void> {
    const transaction = this.transaction(id, ownerId);
    try {
      if (transaction.parentId) {
        await this.worker.request('rollbackSavepoint', { name: transaction.savepoint });
      } else {
        await this.worker.request('rollback');
      }
    } finally {
      this.transactions.delete(id);
      transaction.release?.();
    }
  }

  async streamOpen(ownerId: number, sql: string, params: SqlBindValue[]): Promise<string> {
    const id = randomUUID();
    await this.worker.request('streamOpen', { streamId: id, sql, params });
    this.streams.set(id, ownerId);
    return id;
  }

  streamNext<T>(ownerId: number, id: string): Promise<{ rows: T[]; done: boolean }> {
    if (this.streams.get(id) !== ownerId) throw new Error('Invalid or foreign database stream');
    return this.worker.request('streamNext', { streamId: id });
  }

  async streamClose(ownerId: number, id: string): Promise<void> {
    if (this.streams.get(id) !== ownerId) return;
    this.streams.delete(id);
    await this.worker.request('streamClose', { streamId: id });
  }

  async cleanupOwner(ownerId: number): Promise<void> {
    for (const [id, streamOwnerId] of this.streams) {
      if (streamOwnerId === ownerId) await this.streamClose(ownerId, id);
    }
    const outer = [...this.transactions.values()].find(
      (transaction) => transaction.ownerId === ownerId && !transaction.parentId,
    );
    if (outer) await this.rollback(ownerId, outer.id).catch(() => undefined);
    for (const [id, transaction] of this.transactions) {
      if (transaction.ownerId === ownerId) this.transactions.delete(id);
    }
  }

  close(): Promise<void> {
    return this.worker.close();
  }
}
