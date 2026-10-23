/** JSON object patches merge objects recursively; arrays and scalar values replace. */
import type { JsonObject } from '../ports/file-system';
export type { JsonObject } from '../ports/file-system';

const pending = new Map<string, Promise<void>>();
const MAX_BYTES = 2 * 1024 * 1024;

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function merge(current: JsonObject, patch: JsonObject): JsonObject {
  const result = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('invalid-json-key');
    result[key] = object(value) ? merge(object(result[key]) ? result[key] : {}, value) : value;
  }
  return result;
}

/** The adapter supplies an atomic writer; serialization covers the entire read/merge/write. */
export async function updateJson(
  key: string,
  patch: JsonObject,
  read: () => Promise<string | null>,
  write: (text: string) => Promise<void>,
): Promise<void> {
  // Snapshot caller-owned objects before waiting for another writer.
  const encoded = JSON.stringify(patch);
  if (encoded.length > MAX_BYTES || !object(patch)) throw new Error('invalid-json-patch');
  const snapshot = JSON.parse(encoded) as JsonObject;
  const task = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const text = await read();
    if (text && text.length > MAX_BYTES) throw new Error('json-file-too-large');
    const current: unknown = text ? JSON.parse(text) : {};
    if (!object(current)) throw new Error('invalid-json-file');
    const next = JSON.stringify(merge(current, snapshot));
    if (next.length > MAX_BYTES) throw new Error('json-file-too-large');
    await write(next);
  });
  pending.set(key, task);
  try { await task; }
  finally { if (pending.get(key) === task) pending.delete(key); }
}
