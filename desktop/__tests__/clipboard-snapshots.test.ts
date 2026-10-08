import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ClipboardSnapshots } from '../clipboard-snapshots';

let directory: string;
let root: string;
let source: string;
let clipboardPaths: string[];
let snapshots: ClipboardSnapshots;
const readClipboardPaths = jest.fn<Promise<string[]>, []>();
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'psstpsst-clipboard-'));
  root = path.join(directory, 'snapshots');
  source = path.join(directory, 'source');
  await fs.writeFile(source, 'original');
  clipboardPaths = [];
  readClipboardPaths.mockReset().mockImplementation(async () => clipboardPaths);
  snapshots = new ClipboardSnapshots(root, readClipboardPaths);
});
afterEach(async () => {
  await snapshots.stop();
  await fs.rm(directory, { recursive: true, force: true });
});
const publish = async (file: string) => { clipboardPaths = [file]; };

it('keeps only the currently referenced snapshot after repeated copies', async () => {
  await snapshots.copy(source, 'report.pdf', publish);
  const first = clipboardPaths[0];
  await fs.writeFile(source, 'changed');
  expect(await fs.readFile(first, 'utf8')).toBe('original');
  await snapshots.copy(source, 'report.pdf', publish);
  expect(await fs.readFile(clipboardPaths[0], 'utf8')).toBe('changed');
  await expect(fs.stat(first)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readdir(root)).toHaveLength(1);
});

it('cleans up failed publications without removing the preceding clipboard file', async () => {
  await snapshots.copy(source, 'report.pdf', publish);
  const previous = clipboardPaths[0];
  await expect(snapshots.copy(source, 'new.pdf', async () => { throw new Error('Clipboard busy'); })).rejects.toThrow('Clipboard busy');
  expect(await fs.readdir(root)).toHaveLength(1);
  expect(await fs.readFile(previous, 'utf8')).toBe('original');
});

it('removes partially prepared snapshots when the source is missing', async () => {
  await expect(snapshots.copy(`${source}-missing`, 'file', publish)).rejects.toThrow();
  expect(await fs.readdir(root)).toEqual([]);
});

it('preserves the live clipboard file and removes stale files after a restart', async () => {
  await snapshots.copy(source, 'old.pdf', publish);
  readClipboardPaths.mockRejectedValueOnce(new Error('Clipboard unavailable'));
  await snapshots.copy(source, 'current.pdf', publish);
  expect(await fs.readdir(root)).toHaveLength(2);
  const restarted = new ClipboardSnapshots(root, readClipboardPaths);
  await restarted.start();
  expect(await fs.readdir(root)).toHaveLength(1);
  expect(await fs.readFile(clipboardPaths[0], 'utf8')).toBe('original');
  await restarted.stop();
});

it('periodically cleans up files after another application replaces the clipboard', async () => {
  await snapshots.copy(source, 'report.pdf', publish);
  const intervals = jest.spyOn(global, 'setInterval');
  try {
    await snapshots.start();
    clipboardPaths = [];
    let observed!: () => void;
    const sweepStarted = new Promise<void>((resolve) => { observed = resolve; });
    readClipboardPaths.mockImplementation(async () => { observed(); return clipboardPaths; });
    expect(intervals.mock.calls.at(-1)?.[1]).toBe(60_000);
    const tick = intervals.mock.calls.at(-1)![0] as () => void;
    tick();
    await sweepStarted;
    // Wait behind the timer's asynchronous filesystem cleanup.
    await snapshots.cleanup();
    expect(await fs.readdir(root)).toEqual([]);
  } finally {
    intervals.mockRestore();
  }
});

it('preserves snapshots when clipboard reads fail and retries the next sweep', async () => {
  await snapshots.copy(source, 'report.pdf', publish);
  clipboardPaths = [];
  readClipboardPaths.mockRejectedValueOnce(new Error('Clipboard unavailable'));
  await snapshots.cleanup();
  expect(await fs.readdir(root)).toHaveLength(1);
  await snapshots.cleanup();
  expect(await fs.readdir(root)).toEqual([]);
});

it('serializes a cleanup behind a publication still in progress', async () => {
  let release!: () => void;
  let entered!: () => void;
  const publicationEntered = new Promise<void>((resolve) => { entered = resolve; });
  const copying = snapshots.copy(source, 'report.pdf', async (file) => {
    entered();
    await new Promise<void>((resolve) => { release = resolve; });
    clipboardPaths = [file];
  });
  await publicationEntered;
  const cleanup = snapshots.cleanup();
  expect(await fs.readdir(root)).toHaveLength(1);
  release();
  await Promise.all([copying, cleanup]);
  expect(await fs.readFile(clipboardPaths[0], 'utf8')).toBe('original');
});

it('does not delete a snapshot if publication takes effect before reporting an error', async () => {
  await expect(snapshots.copy(source, 'report.pdf', async (file) => {
    clipboardPaths = [file];
    throw new Error('Publication interrupted');
  })).rejects.toThrow('Publication interrupted');
  expect(await fs.readFile(clipboardPaths[0], 'utf8')).toBe('original');
  clipboardPaths = [];
  await snapshots.cleanup();
  expect(await fs.readdir(root)).toEqual([]);
});
