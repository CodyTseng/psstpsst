import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import { updateJson, type JsonObject } from '../../src/platform/shared/update-json';

let directory: string;
let file: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'psst-json-'));
  file = path.join(directory, 'metadata.json');
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

const read = async () => {
  try { return await fs.readFile(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
};
const write = async (text: string) => { await writeFileAtomic(file, text, { encoding: 'utf8' }); };
const patch = (value: JsonObject) => updateJson(file, value, read, write);

it('preserves simultaneous version and icon updates to one application', async () => {
  await Promise.all([
    patch({ versions: { first: { files: ['a'], complete: true } } }),
    patch({ versions: { second: { files: ['b'] } } }),
    patch({ versions: {}, icon: { path: 'icon.png' } }),
  ]);
  expect(JSON.parse((await read())!)).toEqual({
    versions: { first: { files: ['a'], complete: true }, second: { files: ['b'] } }, icon: { path: 'icon.png' },
  });
});

it('retains the previous document when replacement fails and permits later updates', async () => {
  await patch({ versions: { first: { complete: true } } });
  await expect(updateJson(file, { icon: { path: 'new.png' } }, read, async () => { throw new Error('disk-full'); }))
    .rejects.toThrow('disk-full');
  expect(JSON.parse((await read())!)).toEqual({ versions: { first: { complete: true } } });
  await patch({ icon: { path: 'next.png' } });
  expect(JSON.parse((await read())!).icon.path).toBe('next.png');
});

it('replaces file lists instead of merging array positions', async () => {
  await patch({ versions: { first: { files: ['a', 'b'] } } });
  await patch({ versions: { first: { files: ['c'], complete: true } } });
  expect(JSON.parse((await read())!).versions.first.files).toEqual(['c']);
});

it('rejects dangerous JSON keys without modifying the file', async () => {
  await patch({ schemaVersion: 1 });
  await expect(patch(JSON.parse('{"versions":{"__proto__":{"polluted":true}}}'))).rejects.toThrow('invalid-json-key');
  expect(JSON.parse((await read())!)).toEqual({ schemaVersion: 1 });
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});
