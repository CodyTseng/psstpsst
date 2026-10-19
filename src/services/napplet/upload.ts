import type { Event, EventTemplate } from 'nostr-tools';
import type { UploadInfo, UploadStatus } from '@napplet/core';
import { base64 } from '@scure/base';
import { platform } from '@/platform';
import { assertNotAborted, linkAbort } from '@/platform/abort';
import { createBlossomUploadPlan } from '@/lib/nostr/blossom-url';
import { publicUrl, randomId } from './protocol';
import { UPLOAD_CHUNK_BYTES } from './upload-transport';

type Metadata = { mimeType: string; filename: string; caption: string };
type Transfer = { bytes: Uint8Array; offset: number; seq: number; metadata: Metadata; timer: ReturnType<typeof setTimeout> };
type Job = { status: UploadStatus; controller: AbortController; authorizationVersion?: number };
type Approval = { event: Event; check(): void };
type Options = {
  accountPubkey: string;
  signal: AbortSignal;
  send(message: Record<string, unknown>): void;
  version(): number;
  authorize(template: EventTemplate, metadata: Metadata & { size: number; sha256: string }, servers: string[], signal: AbortSignal): Promise<Approval>;
};

function metadata(value: unknown): Metadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-request');
  const request = value as Record<string, unknown>;
  if (request.rail != null && request.rail !== 'blossom') throw new Error('unsupported-rail');
  const mimeType = request.mimeType ?? 'application/octet-stream';
  if (typeof mimeType !== 'string' || mimeType.length > 128 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mimeType)) throw new Error('invalid-mime');
  if (request.filename != null && (typeof request.filename !== 'string' || request.filename.length > 256 || /[\u0000-\u001f\u007f]/.test(request.filename))) throw new Error('invalid-filename');
  if (request.caption != null && (typeof request.caption !== 'string' || request.caption.length > 2048)) throw new Error('invalid-caption');
  if (request.noTransform != null && typeof request.noTransform !== 'boolean') throw new Error('invalid-request');
  return { mimeType: mimeType.toLowerCase(), filename: typeof request.filename === 'string' ? request.filename : '', caption: typeof request.caption === 'string' ? request.caption : '' };
}

/** Endpoint-owned bytes, authorization and upload statuses; no file handles reach the app. */
export class NappletUploads {
  private transfers = new Map<string, Transfer>();
  private jobs = new Map<string, Job>();
  private active = 0;
  constructor(private options: Options) {}

  close() {
    for (const transfer of this.transfers.values()) clearTimeout(transfer.timer);
    this.transfers.clear();
    for (const job of this.jobs.values()) job.controller.abort();
    this.jobs.clear();
  }
  authorizationChanged() {
    for (const job of this.jobs.values()) {
      if (job.authorizationVersion !== undefined && job.authorizationVersion !== this.options.version()) job.controller.abort();
    }
  }
  private async servers(): Promise<string[]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- keep account/database services lazy until upload is used
    const { loadAccountMediaServers } = require('@/services/files/media-server.service') as typeof import('@/services/files/media-server.service');
    const configured = await loadAccountMediaServers(this.options.accountPubkey);
    assertNotAborted(this.options.signal);
    return [...new Set(createBlossomUploadPlan(configured).uploadCandidates.flatMap((server) => {
      try { return [publicUrl(server)]; } catch { return []; }
    }))].slice(0, 8);
  }
  async info(): Promise<UploadInfo> {
    return { rails: [{ rail: 'blossom', enabled: (await this.servers()).length > 0 }, { rail: 'nip96', enabled: false }] };
  }
  status(id: unknown): UploadStatus {
    const job = typeof id === 'string' ? this.jobs.get(id) : undefined;
    if (!job) throw new Error('unknown-upload');
    return { ...job.status };
  }

  /** The immutable wrapper converts structured-cloned binary values into credited chunks. */
  transfer(message: Record<string, any>) {
    const id = message.id;
    const seq = message.seq;
    if (typeof id !== 'string' || !id || id.length > 128 || !Number.isSafeInteger(seq)) return;
    try {
      assertNotAborted(this.options.signal);
      if (message.type === 'upload.transfer.start') {
        if (seq !== -1 || this.transfers.has(id)) throw new Error('invalid-transfer');
        if (!Number.isSafeInteger(message.size) || message.size < 1) throw new Error('invalid-upload-data');
        if (this.transfers.size + this.active >= 2) throw new Error('quota-exceeded');
        const meta = metadata(message.request);
        this.transfers.set(id, { bytes: new Uint8Array(message.size), offset: 0, seq: 0, metadata: meta, timer: this.expiry(id) });
      } else {
        const transfer = this.transfers.get(id);
        if (!transfer || seq !== transfer.seq) throw new Error('invalid-transfer');
        clearTimeout(transfer.timer);
        if (message.type === 'upload.transfer.chunk') {
          if (typeof message.data !== 'string' || message.data.length > UPLOAD_CHUNK_BYTES * 4 / 3) throw new Error('invalid-chunk');
          const bytes = base64.decode(message.data);
          if (!bytes.length || bytes.length > UPLOAD_CHUNK_BYTES || transfer.offset + bytes.length > transfer.bytes.length) throw new Error('invalid-chunk');
          transfer.bytes.set(bytes, transfer.offset);
          transfer.offset += bytes.length;
          transfer.seq++;
          transfer.timer = this.expiry(id);
        } else if (message.type === 'upload.transfer.end') {
          if (transfer.offset !== transfer.bytes.length) throw new Error('incomplete-transfer');
          this.transfers.delete(id);
          const status = this.begin(transfer.bytes, transfer.metadata);
          this.options.send({ type: 'upload.upload.result', id, result: status });
        } else throw new Error('invalid-transfer');
      }
      this.options.send({ type: 'psst.upload.ack', id, seq });
    } catch (error) {
      const transfer = this.transfers.get(id);
      if (transfer) clearTimeout(transfer.timer);
      this.transfers.delete(id);
      if (!this.options.signal.aborted) this.options.send({ type: 'psst.upload.ack', id, seq, error: error instanceof Error ? error.message : 'invalid-request' });
    }
  }
  private expiry(id: string) {
    return setTimeout(() => { this.transfers.delete(id); }, 10000);
  }
  private begin(bytes: Uint8Array, meta: Metadata): UploadStatus {
    if (this.active >= 2) throw new Error('quota-exceeded');
    for (const [id, job] of this.jobs) {
      if (this.jobs.size < 16) break;
      if (['complete', 'failed', 'cancelled'].includes(job.status.status)) this.jobs.delete(id);
    }
    const job: Job = { controller: new AbortController(), status: {
      uploadId: randomId(), rail: 'blossom', ok: true, status: 'pending', bytesSent: 0, bytesTotal: bytes.length, updatedAt: Date.now(),
    } };
    this.jobs.set(job.status.uploadId, job);
    this.active++;
    // Paint pending state before hashing, staging or signing work begins.
    void new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => this.run(job, bytes, meta)).catch(() => {});
    return { ...job.status };
  }
  private update(job: Job, patch: Partial<UploadStatus>) {
    if (this.options.signal.aborted || this.jobs.get(job.status.uploadId) !== job) return;
    job.status = { ...job.status, ...patch, updatedAt: Date.now() };
    this.options.send({ type: 'upload.status.changed', status: job.status });
  }
  private async run(job: Job, bytes: Uint8Array, meta: Metadata): Promise<void> {
    const linked = linkAbort([this.options.signal, job.controller.signal]);
    const signal = linked.signal;
    const timer = setTimeout(() => job.controller.abort(), 120000);
    let path: string | undefined;
    try {
      assertNotAborted(signal);
      const servers = await this.servers();
      assertNotAborted(signal);
      if (!servers.length) throw new Error('upload-unavailable');
      const hash = await platform.deviceCrypto.sha256Hex(bytes);
      assertNotAborted(signal);
      const now = Math.floor(Date.now() / 1000);
      const template = { kind: 24242, created_at: now, content: 'Upload public file', tags: [
        ['t', 'upload'], ['x', hash], ['size', String(bytes.length)], ['expiration', String(now + 300)],
      ] };
      const approval = await this.options.authorize(template, { ...meta, size: bytes.length, sha256: hash }, servers, signal);
      approval.check();
      job.authorizationVersion = this.options.version();
      const root = await platform.fileSystem.cacheDirectoryUri();
      approval.check();
      if (!root) throw new Error('storage-unavailable');
      const directory = `${root.replace(/\/$/, '')}/napplet-uploads`;
      await platform.fileSystem.makeDirectory(directory, { intermediates: true, idempotent: true });
      approval.check();
      path = `${directory}/${job.status.uploadId}`;
      const writer = await platform.fileSystem.openWriteHandle(path);
      try {
        for (let offset = 0; offset < bytes.length; offset += 65536) {
          approval.check();
          await writer.writeBytes(bytes.subarray(offset, offset + 65536));
          if (offset % 262144 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      } finally { await writer.close(); }
      approval.check();
      this.update(job, { status: 'uploading' });
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- evaluate the backend only after upload consent
      const { uploadPublicBlob } = require('@/services/files/blossom.service') as typeof import('@/services/files/blossom.service');
      approval.check();
      let reported = 0;
      const result = await uploadPublicBlob({ fileUri: path, mime: meta.mimeType, sha256: hash, size: bytes.length,
        servers, authorization: approval.event, signal,
        onProgress: (sent, total) => {
          try { approval.check(); } catch { job.controller.abort(); return; }
          if (Date.now() - reported < 100 && sent < total) return;
          reported = Date.now();
          this.update(job, { bytesSent: Math.min(bytes.length, Math.max(job.status.bytesSent ?? 0, sent)), bytesTotal: bytes.length });
        },
      });
      approval.check();
      const url = publicUrl(result.url);
      if (!new URL(url).pathname.toLowerCase().includes(hash)) throw new Error('invalid-response');
      const nip94 = [['url', url], ['x', hash], ['m', meta.mimeType], ['size', String(bytes.length)]];
      if (meta.caption) nip94.push(['alt', meta.caption]);
      this.update(job, { ok: true, status: 'complete', url, sha256: hash, originalSha256: hash, size: bytes.length,
        mimeType: meta.mimeType, nip94, bytesSent: bytes.length, bytesTotal: bytes.length });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'upload-failed';
      const safe = ['permission-denied', 'timeout', 'upload-unavailable', 'invalid-response', 'storage-unavailable'].includes(reason) ? reason : 'upload-failed';
      this.update(job, { ok: false, status: signal.aborted ? 'cancelled' : 'failed', error: signal.aborted ? 'cancelled' : safe });
    } finally {
      clearTimeout(timer); linked.dispose(); this.active--;
      if (path) await platform.fileSystem.delete(path, { idempotent: true }).catch(() => {});
    }
  }
}
