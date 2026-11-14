import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { FileService } from '../file-service';

jest.mock('electron', () => ({}));
jest.mock('archiver', () => ({}));
jest.mock('sharp', () => ({}));
jest.mock('yauzl', () => ({}));
jest.mock('write-file-atomic', () => ({}));

it.each([undefined, '999'])('sends the actual streamed file length instead of %s', async suppliedLength => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'psst-upload-'));
  const files = new FileService(root);
  const bytes = Buffer.from('Upload \uffff bytes');
  let received = Buffer.alloc(0);
  const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
    const chunks: Buffer[] = [];
    for await (const chunk of init!.body as unknown as Readable) chunks.push(Buffer.from(chunk));
    received = Buffer.concat(chunks);
    const headers = new Headers(init!.headers);
    expect(headers.get('content-length')).toBe(String(received.length));
    expect(headers.get('authorization')).toBe('Nostr token');
    return { status: 200, headers: new Headers(), text: async () => '{}' } as Response;
  });
  try {
    await files.initialize();
    await files.writeBytes('psstpsst-file://cache/blob.bin', bytes);
    await expect(files.uploadFile(1, 'https://files.example/upload', 'psstpsst-file://cache/blob.bin', {
      httpMethod: 'PUT', headers: { Authorization: 'Nostr token', ...(suppliedLength ? { 'content-length': suppliedLength } : {}) },
    }, 'upload-1')).resolves.toMatchObject({ status: 200 });
    expect(received).toEqual(bytes);
  } finally {
    fetchMock.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  }
});
