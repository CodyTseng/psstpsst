import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

import { type ProgressData, ZipArchive } from 'archiver';
import {
  BrowserWindow,
  dialog,
  ShareMenu,
  type OpenDialogOptions,
  type WebContents,
} from 'electron';
import sharp from 'sharp';
import yauzl from 'yauzl';

import { createUploadProgressTransform } from './upload-progress';

type OwnedReadHandle = { ownerId: number; handle: FileHandle; offset: number; size: number };
type OwnedWriteHandle = { ownerId: number; handle: FileHandle; offset: number };
type OwnedUpload = { ownerId: number; controller: AbortController };

function encodePath(relativePath: string): string {
  return relativePath
    .split(path.sep)
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

export class FileService {
  private readonly roots: Record<'documents' | 'cache', string>;
  private readonly readHandles = new Map<string, OwnedReadHandle>();
  private readonly writeHandles = new Map<string, OwnedWriteHandle>();
  private readonly uploads = new Map<string, OwnedUpload>();
  private readonly remoteRequests = new Map<string, OwnedUpload>();

  constructor(userDataPath: string) {
    this.roots = {
      documents: path.join(userDataPath, 'documents'),
      cache: path.join(userDataPath, 'cache'),
    };
  }

  async initialize(): Promise<void> {
    await Promise.all(Object.values(this.roots).map((root) => fs.mkdir(root, { recursive: true })));
  }

  directoryUri(kind: 'documents' | 'cache'): string {
    return `psstpsst-file://${kind}/`;
  }

  toUri(nativePath: string): string {
    for (const [kind, root] of Object.entries(this.roots)) {
      const relative = path.relative(root, nativePath);
      if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
        return `psstpsst-file://${kind}/${encodePath(relative)}`;
      }
    }
    throw new Error('Path is outside application storage');
  }

  resolve(uri: string): string {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'psstpsst-file:') throw new Error('Unsupported file URI');
    if (parsed.hostname !== 'documents' && parsed.hostname !== 'cache') {
      throw new Error('Unknown file root');
    }
    const root = this.roots[parsed.hostname];
    const decoded = decodeURIComponent(parsed.pathname).replace(/^[/\\]+/, '');
    const resolved = path.resolve(root, decoded);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error('Path escapes application storage');
    }
    return resolved;
  }

  private resolveMutable(uri: string): string {
    const resolved = this.resolve(uri);
    if (Object.values(this.roots).includes(resolved)) {
      throw new Error('The application storage root cannot be modified');
    }
    return resolved;
  }

  fileUrl(uri: string): string {
    return pathToFileURL(this.resolve(uri)).toString();
  }

  async availableDiskSpace(): Promise<number> {
    const stats = await fs.statfs(this.roots.documents);
    return stats.bavail * stats.bsize;
  }

  async stat(uri: string) {
    try {
      const value = await fs.stat(this.resolve(uri));
      return {
        exists: true,
        isDirectory: value.isDirectory(),
        size: value.isFile() ? value.size : null,
        creationTime: value.birthtimeMs || null,
        modificationTime: value.mtimeMs || null,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          exists: false,
          isDirectory: false,
          size: null,
          creationTime: null,
          modificationTime: null,
        };
      }
      throw error;
    }
  }

  async makeDirectory(
    uri: string,
    options: { intermediates?: boolean; idempotent?: boolean } = {},
  ): Promise<void> {
    try {
      await fs.mkdir(this.resolve(uri), { recursive: options.intermediates ?? false });
    } catch (error) {
      if (options.idempotent && (error as NodeJS.ErrnoException).code === 'EEXIST') return;
      throw error;
    }
  }

  async listDirectory(uri: string) {
    const parent = this.resolve(uri);
    const entries = await fs.readdir(parent, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      uri: this.toUri(path.join(parent, entry.name)),
      isDirectory: entry.isDirectory(),
    }));
  }

  readText(uri: string): Promise<string> {
    return fs.readFile(this.resolve(uri), 'utf8');
  }

  async readBase64(uri: string): Promise<string> {
    return (await fs.readFile(this.resolve(uri))).toString('base64');
  }

  async readBytes(uri: string): Promise<Uint8Array> {
    return fs.readFile(this.resolve(uri));
  }

  async writeText(uri: string, contents: string): Promise<void> {
    await fs.writeFile(this.resolveMutable(uri), contents, 'utf8');
  }

  async writeBytes(uri: string, bytes: Uint8Array): Promise<void> {
    await fs.writeFile(this.resolveMutable(uri), bytes);
  }

  async openReadHandle(ownerId: number, uri: string, offset = 0) {
    const handle = await fs.open(this.resolve(uri), 'r');
    const size = (await handle.stat()).size;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > size) {
      await handle.close();
      throw new Error('Invalid read offset');
    }
    const id = randomUUID();
    this.readHandles.set(id, { ownerId, handle, offset, size });
    return { id, size };
  }

  async readHandle(ownerId: number, id: string, count: number): Promise<Uint8Array> {
    const opened = this.readHandles.get(id);
    if (!opened || opened.ownerId !== ownerId) throw new Error('Invalid or foreign read handle');
    if (!Number.isSafeInteger(count) || count < 0 || count > 16 * 1024 * 1024) {
      throw new Error('Invalid read size');
    }
    const buffer = Buffer.allocUnsafe(Math.min(count, opened.size - opened.offset));
    const result = await opened.handle.read(buffer, 0, buffer.length, opened.offset);
    opened.offset += result.bytesRead;
    return buffer.subarray(0, result.bytesRead);
  }

  async closeReadHandle(ownerId: number, id: string): Promise<void> {
    const opened = this.readHandles.get(id);
    if (!opened || opened.ownerId !== ownerId) return;
    this.readHandles.delete(id);
    await opened.handle.close();
  }

  async openWriteHandle(
    ownerId: number,
    uri: string,
    offset = 0,
    truncate = true,
  ): Promise<string> {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid write offset');
    const filePath = this.resolveMutable(uri);
    let handle: FileHandle;
    if (truncate) {
      handle = await fs.open(filePath, 'w');
    } else {
      try {
        handle = await fs.open(filePath, 'r+');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        handle = await fs.open(filePath, 'w+');
      }
    }
    const size = (await handle.stat()).size;
    if (offset > size) {
      await handle.close();
      throw new Error('Invalid write offset');
    }
    const id = randomUUID();
    this.writeHandles.set(id, { ownerId, handle, offset });
    return id;
  }

  async writeHandle(ownerId: number, id: string, bytes: Uint8Array): Promise<void> {
    const opened = this.writeHandles.get(id);
    if (!opened || opened.ownerId !== ownerId) throw new Error('Invalid or foreign write handle');
    const buffer = Buffer.from(bytes);
    await opened.handle.write(buffer, 0, buffer.length, opened.offset);
    opened.offset += buffer.length;
  }

  async closeWriteHandle(ownerId: number, id: string): Promise<void> {
    const opened = this.writeHandles.get(id);
    if (!opened || opened.ownerId !== ownerId) return;
    this.writeHandles.delete(id);
    await opened.handle.close();
  }

  async copy(fromUri: string, toUri: string, overwrite: boolean): Promise<void> {
    await fs.copyFile(
      this.resolve(fromUri),
      this.resolveMutable(toUri),
      overwrite ? 0 : fs.constants.COPYFILE_EXCL,
    );
  }

  move(fromUri: string, toUri: string): Promise<void> {
    return fs.rename(this.resolveMutable(fromUri), this.resolveMutable(toUri));
  }

  async delete(uri: string, idempotent: boolean): Promise<void> {
    await fs.rm(this.resolveMutable(uri), { recursive: true, force: idempotent });
  }

  private validateRemoteUrl(value: string): URL {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Only HTTP(S) transfers are allowed');
    }
    return url;
  }

  async downloadFile(urlValue: string, toUri: string, overwrite: boolean): Promise<void> {
    const destination = this.resolveMutable(toUri);
    if (!overwrite && (await this.stat(toUri)).exists) throw new Error('Destination exists');
    const response = await fetch(this.validateRemoteUrl(urlValue));
    if (!response.ok || !response.body) throw new Error(`Download failed with HTTP ${response.status}`);
    const temporary = `${destination}.${randomUUID()}.download`;
    try {
      const output = createWriteStream(temporary, { flags: 'wx' });
      await response.body.pipeTo(
        new WritableStream({
          write(chunk) {
            return new Promise<void>((resolve, reject) => {
              output.write(Buffer.from(chunk), (error) => (error ? reject(error) : resolve()));
            });
          },
          close() {
            return new Promise<void>((resolve, reject) =>
              output.end((error: Error | null | undefined) => (error ? reject(error) : resolve())),
            );
          },
          abort() {
            output.destroy();
          },
        }),
      );
      await fs.rename(temporary, destination);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  async uploadFile(
    ownerId: number,
    urlValue: string,
    fileUri: string,
    options: { httpMethod: 'POST' | 'PUT' | 'PATCH'; headers?: Record<string, string> },
    operationId: string,
    onProgress?: (sentBytes: number, totalBytes: number) => void,
  ): Promise<{ status: number; body: string; cancelled?: boolean }> {
    const controller = new AbortController();
    let source: Readable | undefined;
    let input: Readable | undefined;
    this.uploads.set(operationId, { ownerId, controller });
    try {
      const resolved = this.resolve(fileUri);
      const totalBytes = (await fs.stat(resolved)).size;
      source = createReadStream(resolved);
      input = source.pipe(createUploadProgressTransform(totalBytes, onProgress));
      onProgress?.(0, totalBytes);
      const response = await fetch(this.validateRemoteUrl(urlValue), {
        method: options.httpMethod,
        headers: options.headers,
        body: input as unknown as BodyInit,
        duplex: 'half',
        signal: controller.signal,
      } as RequestInit & { duplex: 'half' });
      onProgress?.(totalBytes, totalBytes);
      return { status: response.status, body: await response.text() };
    } catch (error) {
      // Undici normally tears the body down, but explicitly close both sides so
      // TLS/connect failures cannot leave a paused file descriptor behind.
      source?.destroy();
      input?.destroy();
      if (controller.signal.aborted) {
        return { status: 0, body: '', cancelled: true };
      }
      throw error;
    } finally {
      this.uploads.delete(operationId);
    }
  }

  cancelUpload(ownerId: number, operationId: string): void {
    const upload = this.uploads.get(operationId);
    if (upload?.ownerId === ownerId) upload.controller.abort();
  }

  async requestRemoteFile(
    ownerId: number,
    urlValue: string,
    options: {
      method: 'GET' | 'HEAD';
      headers?: Record<string, string>;
      readBody?: boolean;
    },
    operationId: string,
  ): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }> {
    const controller = new AbortController();
    this.remoteRequests.set(operationId, { ownerId, controller });
    try {
      const response = await fetch(this.validateRemoteUrl(urlValue), {
        method: options.method,
        headers: options.headers,
        signal: controller.signal,
      });
      const headers = Object.fromEntries(response.headers.entries());
      if (options.readBody === false || options.method === 'HEAD') {
        await response.body?.cancel();
        return { status: response.status, headers, body: new Uint8Array() };
      }
      return {
        status: response.status,
        headers,
        body: new Uint8Array(await response.arrayBuffer()),
      };
    } finally {
      this.remoteRequests.delete(operationId);
    }
  }

  cancelRemoteFileRequest(ownerId: number, operationId: string): void {
    const request = this.remoteRequests.get(operationId);
    if (request?.ownerId === ownerId) request.controller.abort();
  }

  async pickDocument(owner: WebContents): Promise<{ uri: string; name: string } | null> {
    const window = BrowserWindow.fromWebContents(owner);
    const options: OpenDialogOptions = {
      properties: ['openFile'],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const name = path.basename(result.filePaths[0]);
    const importDirectory = path.join(this.roots.cache, 'imports');
    await fs.mkdir(importDirectory, { recursive: true });
    const destination = path.join(
      importDirectory,
      `${randomUUID()}-${name}`,
    );
    await fs.copyFile(result.filePaths[0], destination, fs.constants.COPYFILE_EXCL);
    return { uri: this.toUri(destination), name };
  }

  async saveFile(owner: WebContents, sourceUri: string, suggestedName: string): Promise<boolean> {
    const window = BrowserWindow.fromWebContents(owner);
    const options = {
      defaultPath: path.basename(suggestedName),
    };
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    await fs.copyFile(this.resolve(sourceUri), result.filePath);
    return true;
  }

  async shareFile(owner: WebContents, sourceUri: string): Promise<boolean> {
    if (process.platform !== 'darwin') return false;
    const window = BrowserWindow.fromWebContents(owner);
    new ShareMenu({ filePaths: [this.resolve(sourceUri)] }).popup(
      window ? { window } : undefined,
    );
    return true;
  }

  async renderImage(
    uri: string,
    options: {
      resize?: { width?: number; height?: number };
      format: 'jpeg' | 'png' | 'webp';
      quality: number;
      includeBase64?: boolean;
    },
  ) {
    let pipeline = sharp(this.resolve(uri), { failOn: 'error' }).rotate();
    if (options.resize) {
      pipeline = pipeline.resize(options.resize.width, options.resize.height, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }
    pipeline =
      options.format === 'png'
        ? pipeline.png()
        : options.format === 'webp'
          ? pipeline.webp({ quality: Math.round(options.quality * 100) })
          : pipeline.jpeg({ quality: Math.round(options.quality * 100) });
    const extension = options.format === 'png' ? 'png' : options.format === 'webp' ? 'webp' : 'jpg';
    const outputPath = path.join(this.roots.cache, `image-${randomUUID()}.${extension}`);
    const info = await pipeline.toFile(outputPath);
    return {
      uri: this.toUri(outputPath),
      width: info.width,
      height: info.height,
      ...(options.includeBase64
        ? { base64: (await fs.readFile(outputPath)).toString('base64') }
        : {}),
    };
  }

  async zip(
    sourceUri: string,
    targetUri: string,
    progress: (value: number) => void,
  ): Promise<void> {
    const source = this.resolve(sourceUri);
    const target = this.resolve(targetUri);
    const stats = await fs.stat(source);
    const output = createWriteStream(target, { flags: 'wx' });
    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.on('progress', (value: ProgressData) =>
      progress(value.entries.total ? value.entries.processed / value.entries.total : 0),
    );
    archive.pipe(output);
    if (stats.isDirectory()) archive.directory(source, false);
    else archive.file(source, { name: path.basename(source) });
    await new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
      void archive.finalize();
    });
    progress(1);
  }

  async unzip(
    sourceUri: string,
    targetUri: string,
    progress: (value: number) => void,
  ): Promise<void> {
    progress(0);
    const target = this.resolve(targetUri);
    await fs.mkdir(target, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      yauzl.open(this.resolve(sourceUri), { lazyEntries: true }, (error, zipFile) => {
        if (error || !zipFile) {
          reject(error ?? new Error('Unable to open ZIP archive'));
          return;
        }
        let processed = 0;
        const fail = (failure: unknown) => {
          zipFile.close();
          reject(failure);
        };
        zipFile.on('error', fail);
        zipFile.on('entry', (entry) => {
          void (async () => {
            const unixType = (entry.externalFileAttributes >>> 16) & 0o170000;
            if (unixType === 0o120000 || entry.fileName.includes('\0')) {
              throw new Error('ZIP archive contains an unsafe entry');
            }
            const destination = path.resolve(target, entry.fileName);
            if (destination !== target && !destination.startsWith(`${target}${path.sep}`)) {
              throw new Error('ZIP archive entry escapes the destination');
            }
            if (entry.fileName.endsWith('/')) {
              await fs.mkdir(destination, { recursive: true });
            } else {
              await fs.mkdir(path.dirname(destination), { recursive: true });
              const input = await new Promise<Readable>((streamResolve, streamReject) =>
                zipFile.openReadStream(entry, (streamError, stream) => {
                  if (streamError || !stream) streamReject(streamError ?? new Error('Invalid ZIP entry'));
                  else streamResolve(stream);
                }),
              );
              await pipeline(input, createWriteStream(destination, { flags: 'wx' }));
            }
            processed += 1;
            progress(zipFile.entryCount ? processed / zipFile.entryCount : 1);
            zipFile.readEntry();
          })().catch(fail);
        });
        zipFile.on('end', () => {
          progress(1);
          resolve();
        });
        zipFile.readEntry();
      });
    });
  }

  uncompressedSize(uri: string): Promise<number> {
    const archivePath = this.resolve(uri);
    return new Promise((resolve, reject) => {
      yauzl.open(archivePath, { lazyEntries: true }, (error, zipFile) => {
        if (error || !zipFile) {
          reject(error ?? new Error('Unable to open ZIP archive'));
          return;
        }
        let total = 0;
        zipFile.on('entry', (entry) => {
          total += entry.uncompressedSize;
          zipFile.readEntry();
        });
        zipFile.on('end', () => resolve(total));
        zipFile.on('error', reject);
        zipFile.readEntry();
      });
    });
  }

  async cleanupOwner(ownerId: number): Promise<void> {
    for (const [id, opened] of this.readHandles) {
      if (opened.ownerId === ownerId) await this.closeReadHandle(ownerId, id);
    }
    for (const [id, opened] of this.writeHandles) {
      if (opened.ownerId === ownerId) await this.closeWriteHandle(ownerId, id);
    }
    for (const [id, upload] of this.uploads) {
      if (upload.ownerId === ownerId) this.cancelUpload(ownerId, id);
    }
    for (const [id, request] of this.remoteRequests) {
      if (request.ownerId === ownerId) this.cancelRemoteFileRequest(ownerId, id);
    }
  }
}
