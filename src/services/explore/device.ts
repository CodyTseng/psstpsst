import { base64 } from '@scure/base';
import { platform } from '@/platform';
import { assertNotAborted } from '@/platform/abort';
import { randomId } from '@/services/napplet/protocol';
import type { RuntimePrompt } from '@/services/napplet/runtime';
import type { FileWriteHandle } from '@/platform/ports/file-system';
import type { ApplicationInfo } from './model';

type Transfer = { name: string; mime: string; size: number; received: number; uri: string; writer: FileWriteHandle; timer: ReturnType<typeof setTimeout>; busy: boolean };
/** A credited, document-owned file transfer never accepts an application-supplied path. */
export class NappDevice {
  private transfers = new Map<string, Transfer>();
  private starting = 0;
  constructor(private application: ApplicationInfo, private account: string, private signal: AbortSignal,
    private confirm: (prompt: RuntimePrompt, signal: AbortSignal) => Promise<string | false>) {
    signal.addEventListener('abort', () => { for (const id of this.transfers.keys()) void this.discard(id); }, { once: true });
  }
  private check() { assertNotAborted(this.signal); }
  private async consent(operation: 'save-file' | 'copy-text', detail: string) {
    this.check();
    const answer = await this.confirm({ title: this.application.title, application: this.application,
      accountPubkey: this.account, detail, device: { operation } }, this.signal);
    this.check(); if (answer !== 'allow') throw new Error('permission-denied');
  }
  async handle(method: string, args: any[]) {
    this.check();
    if (method === 'copyText') {
      const text = args[0];
      if (typeof text !== 'string' || text.length > 64000) throw new Error('invalid-text');
      await this.consent('copy-text', text);
      await platform.clipboard.writeText(text); this.check();
      return { length: text.length };
    }
    if (method === 'saveFile.begin') {
      const [input, size, inputMime] = args;
      if (typeof input !== 'string' || input.length > 4096 || !Number.isSafeInteger(size) || size < 0 || size > 64 * 1024 * 1024 ||
        typeof inputMime !== 'string' || inputMime.length > 256 || !/^[\w.+-]+\/[\w.+-]+$/.test(inputMime)) throw new Error('invalid-file');
      if (this.transfers.size + this.starting >= 2) throw new Error('file-quota-exceeded');
      this.starting++;
      let uri: string | undefined, writer: FileWriteHandle | undefined;
      try {
        const name = input.split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f\u007f:*?"<>|]/g, '').replace(/^\.+/, '').trim().slice(0, 200) || 'download';
        await this.consent('save-file', `${name}\n${inputMime}\n${size.toLocaleString()} B`);
        const cache = await platform.fileSystem.cacheDirectoryUri(); this.check();
        if (!cache) throw new Error('storage-unavailable');
        const id = randomId(); uri = `${cache.replace(/\/$/, '')}/napp-save-${id}`;
        writer = await platform.fileSystem.openWriteHandle(uri); this.check();
        const timer = setTimeout(() => { void this.discard(id); }, 120000);
        this.transfers.set(id, { name, mime: inputMime, size, received: 0, uri, writer, timer, busy: false });
        return { id, chunkBytes: 48 * 1024 };
      } catch (error) { await writer?.close().catch(() => {}); if (uri) await platform.fileSystem.delete(uri, { idempotent: true }).catch(() => {}); throw error; }
      finally { this.starting--; }
    }
    const [id, payload] = args, transfer = this.transfers.get(id);
    if (!transfer) throw new Error('file-transfer-unavailable');
    if (method === 'saveFile.cancel') { await this.discard(id); return; }
    if (transfer.busy) throw new Error('file-transfer-busy');
    transfer.busy = true;
    try {
      if (method === 'saveFile.chunk') {
        if (typeof payload !== 'string' || payload.length > 65536 || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) throw new Error('invalid-file-chunk');
        const bytes = base64.decode(payload);
        if (bytes.length > 48 * 1024 || bytes.length + transfer.received > transfer.size) throw new Error('invalid-file-size');
        await transfer.writer.writeBytes(bytes); this.check();
        if (this.transfers.get(id) !== transfer) throw new Error('file-transfer-unavailable');
        transfer.received += bytes.length; return transfer.received;
      }
      if (method !== 'saveFile.finish') throw new Error('unsupported-method');
      if (transfer.received !== transfer.size) throw new Error('invalid-file-size');
      clearTimeout(transfer.timer);
      await transfer.writer.close(); this.check();
      const saved = await platform.fileSaver.save(transfer.uri, { suggestedName: transfer.name, mimeType: transfer.mime }); this.check();
      if (!saved) throw new Error('save-cancelled');
      return { name: transfer.name, size: transfer.size };
    } catch (error) { await this.discard(id); throw error; }
    finally { transfer.busy = false; if (method === 'saveFile.finish') await this.discard(id); }
  }
  private async discard(id: string) {
    const transfer = this.transfers.get(id);
    if (!transfer) return;
    this.transfers.delete(id); clearTimeout(transfer.timer);
    await transfer.writer.close().catch(() => {});
    await platform.fileSystem.delete(transfer.uri, { idempotent: true }).catch(() => {});
  }
}
