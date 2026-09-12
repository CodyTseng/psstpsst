import { parentPort, workerData } from 'node:worker_threads';

import Database from 'better-sqlite3';

type Request = { id: number; command: string; payload: Record<string, unknown> };
type Response = { id: number; result?: unknown; error?: string };

const databasePath = String(workerData.databasePath);
const database = new Database(databasePath);
database.pragma('foreign_keys = ON');
database.pragma('journal_mode = WAL');

let readDatabase: Database.Database | null = null;
const streams = new Map<string, Iterator<unknown>>();

function bindParams(params: unknown): unknown[] {
  return Array.isArray(params)
    ? params.map((value) => (value instanceof Uint8Array ? Buffer.from(value) : value))
    : [];
}

function execute(payload: Record<string, unknown>): { rows: unknown } {
  const statement = database.prepare(String(payload.sql));
  const params = bindParams(payload.params);
  switch (payload.method) {
    case 'run':
      statement.run(...params);
      return { rows: [] };
    case 'get':
      return { rows: statement.raw(true).get(...params) };
    case 'values':
    case 'all':
      return { rows: statement.raw(true).all(...params) };
    default:
      throw new Error('Unsupported SQLite query method');
  }
}

function runBatch(payload: Record<string, unknown>): void {
  const statement = database.prepare(String(payload.sql));
  const batches = Array.isArray(payload.paramsBatch) ? payload.paramsBatch : [];
  for (const params of batches) statement.run(...bindParams(params));
}

function openStream(payload: Record<string, unknown>): string {
  if (!readDatabase) {
    readDatabase = new Database(databasePath, { readonly: true, fileMustExist: true });
    readDatabase.pragma('query_only = ON');
  }
  const id = String(payload.streamId);
  const iterator = readDatabase
    .prepare(String(payload.sql))
    .iterate(...bindParams(payload.params))[Symbol.iterator]();
  streams.set(id, iterator);
  return id;
}

function streamNext(payload: Record<string, unknown>): { rows: unknown[]; done: boolean } {
  const id = String(payload.streamId);
  const iterator = streams.get(id);
  if (!iterator) return { rows: [], done: true };
  const rows: unknown[] = [];
  for (let index = 0; index < 256; index += 1) {
    const next = iterator.next();
    if (next.done) {
      streams.delete(id);
      return { rows, done: true };
    }
    rows.push(next.value);
  }
  return { rows, done: false };
}

function handle(command: string, payload: Record<string, unknown>): unknown {
  switch (command) {
    case 'execute':
      return execute(payload);
    case 'exec':
      database.exec(String(payload.sql));
      return undefined;
    case 'runBatch':
      runBatch(payload);
      return undefined;
    case 'begin':
      database.exec('BEGIN IMMEDIATE');
      return undefined;
    case 'commit':
      database.exec('COMMIT');
      return undefined;
    case 'rollback':
      database.exec('ROLLBACK');
      return undefined;
    case 'savepoint':
      database.exec(`SAVEPOINT ${String(payload.name)}`);
      return undefined;
    case 'release':
      database.exec(`RELEASE SAVEPOINT ${String(payload.name)}`);
      return undefined;
    case 'rollbackSavepoint':
      database.exec(
        `ROLLBACK TO SAVEPOINT ${String(payload.name)}; RELEASE SAVEPOINT ${String(payload.name)}`,
      );
      return undefined;
    case 'streamOpen':
      return openStream(payload);
    case 'streamNext':
      return streamNext(payload);
    case 'streamClose':
      streams.delete(String(payload.streamId));
      return undefined;
    case 'close':
      streams.clear();
      readDatabase?.close();
      database.close();
      return undefined;
    default:
      throw new Error(`Unknown database worker command: ${command}`);
  }
}

parentPort?.on('message', (request: Request) => {
  const response: Response = { id: request.id };
  try {
    response.result = handle(request.command, request.payload);
  } catch (error) {
    response.error = error instanceof Error ? error.message : String(error);
  }
  parentPort?.postMessage(response);
});
