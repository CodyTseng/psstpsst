import { base64 } from '@scure/base';
import { platform } from '@/platform';
import { assertNotAborted, linkAbort } from '@/platform/abort';
import type { FileWriteHandle } from '@/platform/ports/file-system';
import type { RuntimePrompt } from '@/services/napplet/runtime';
import { randomId } from '@/services/napplet/protocol';
import { getData } from '@/services/napplet/repository';
import { applicationPresentation, applicationRequirements, fileMime, SUPPORTED_NAPP_DOMAINS, type ExploreEntry, type SiteFile } from './model';
import { commitLocalApplication, localApplicationDirectory, readLocalApplication, reapLocalApplicationStorage } from './local-applications';
import { localInstallPath } from './local-path';
export { localInstallPath } from './local-path';

export const LOCAL_INSTALL_MAX_BYTES = 32 * 1024 * 1024;
type File = { path: string; size: number; mime: string; received: number };
type Transfer = { id: string; directory: string; files: File[]; index: number; writer?: FileWriteHandle; busy: boolean; timer: ReturnType<typeof setTimeout>; life: AbortController; committed: boolean; committing?: boolean };


/** One credited installation at a time per authenticated document. No input path reaches the filesystem. */
export class LocalInstaller {
  private transfer?: Transfer;
  private starting = false;
  constructor(private account: string, private caller: ExploreEntry, private signal: AbortSignal,
    private confirm: (prompt: RuntimePrompt, signal: AbortSignal) => Promise<string | false>,
    private installed: (entry: ExploreEntry) => void) {
    signal.addEventListener('abort', () => { void this.discard(); }, { once: true });
  }
  private async checkAccess() {
    assertNotAborted(this.signal);
    if (this.caller.kind !== 'napp' || !this.caller.required.includes('dev')) throw new Error('permission-denied');
    const saved = await getData({ accountPubkey: this.account, appKey: this.caller.key }, 'permissions', 'domains');
    assertNotAborted(this.signal);
    const domains: unknown = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(domains) || domains.some(domain => typeof domain !== 'string') || !domains.includes('dev')) throw new Error('permission-denied');
  }
  async handle(method: string, args: unknown[]): Promise<unknown> {
    try { return await this.dispatch(method, args); }
    catch (error) {
      const reason = error instanceof Error ? error.message : '';
      const safe = new Set(['permission-denied', 'installation-pending', 'invalid-install-files', 'installation-too-large',
        'invalid-install-metadata', 'unsupported-local-format', 'unsupported-local-capability', 'invalid-install-path',
        'installation-unavailable', 'invalid-install-chunk', 'incomplete-installation', 'installation-changed',
        'installation-quota-exceeded', 'account-unavailable']);
      throw new Error(safe.has(reason) ? reason : 'installation-failed');
    }
  }
  private async dispatch(method: string, args: unknown[]): Promise<unknown> {
    assertNotAborted(this.signal);
    if (method === 'begin' || method === 'finish') await this.checkAccess();
    if (method === 'begin') {
      if (this.transfer || this.starting) throw new Error('installation-pending');
      this.starting = true;
      let directory: string | undefined;
      try {
        const raw = args[0];
        if (!Array.isArray(raw) || !raw.length || raw.length > 5000 || JSON.stringify(raw).length > 1024 * 1024) throw new Error('invalid-install-files');
        const seen = new Set<string>(); let size = 0;
        const files: File[] = raw.map(input => {
          const path = localInstallPath(input?.path);
          if (seen.has(path) || !Number.isSafeInteger(input.size) || input.size < 0) throw new Error('invalid-install-files');
          seen.add(path); size += input.size;
          if (size > LOCAL_INSTALL_MAX_BYTES) throw new Error('installation-too-large');
          if (input.type !== undefined && typeof input.type !== 'string') throw new Error('invalid-install-files');
          const mime = typeof input.type === 'string' && input.type ? input.type.split(';')[0].trim().toLowerCase() : fileMime(path);
          if (typeof mime !== 'string' || mime.length > 128 || !/^[\w.+-]+\/[\w.+-]+$/.test(mime)) throw new Error('invalid-install-files');
          return { path, size: input.size, mime, received: 0 };
        });
        const metadata = files.find(file => file.path === '/metadata.json');
        if (!metadata || metadata.size > 64 * 1024) throw new Error('invalid-install-metadata');
        if (!seen.has('/index.html')) throw new Error('unsupported-local-format');
        if (await platform.fileSystem.availableDiskSpace() < size * 2 + 16 * 1024 * 1024) throw new Error('installation-quota-exceeded');
        await reapLocalApplicationStorage(this.account).catch(() => {});
        const id = randomId();
        const root = await localApplicationDirectory(this.account);
        directory = `${root}/staging-${id}`;
        await platform.fileSystem.makeDirectory(directory, { intermediates: true, idempotent: true });
        assertNotAborted(this.signal);
        const timer = setTimeout(() => { if (this.transfer?.id === id) void this.discard(this.transfer); }, 120000);
        this.transfer = { id, directory, files, index: 0, busy: false, timer, life: new AbortController(), committed: false };
        return { id, chunkBytes: 48 * 1024 };
      } catch (error) {
        if (directory) await platform.fileSystem.delete(directory, { idempotent: true }).catch(() => {});
        throw error;
      } finally { this.starting = false; }
    }
    const transfer = this.transfer;
    if (!transfer || args[0] !== transfer.id) throw new Error('installation-unavailable');
    if (method === 'cancel') { await this.discard(transfer); return; }
    if (transfer.busy) throw new Error('installation-pending');
    transfer.busy = true;
    const current = () => {
      assertNotAborted(this.signal);
      if (this.transfer !== transfer) throw new Error('installation-unavailable');
    };
    try {
      if (method === 'chunk') {
        const [, index, encoded] = args;
        if (index !== transfer.index || typeof encoded !== 'string' || encoded.length > 65536 || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('invalid-install-chunk');
        const file = transfer.files[transfer.index];
        if (!file) throw new Error('invalid-install-chunk');
        const bytes = base64.decode(encoded);
        if (file.received + bytes.length > file.size || bytes.length > 48 * 1024 || !bytes.length && file.size > file.received) throw new Error('invalid-install-chunk');
        transfer.writer ??= await platform.fileSystem.openWriteHandle(`${transfer.directory}/part-${transfer.index}`);
        current(); await transfer.writer.writeBytes(bytes); current();
        file.received += bytes.length;
        if (file.received === file.size) { await transfer.writer.close(); transfer.writer = undefined; current(); transfer.index++; }
        return file.received;
      }
      if (method !== 'finish' || transfer.index !== transfer.files.length) throw new Error('incomplete-installation');
      const metadataIndex = transfer.files.findIndex(file => file.path === '/metadata.json');
      let metadata;
      try { metadata = JSON.parse(await platform.fileSystem.readText(`${transfer.directory}/part-${metadataIndex}`)); }
      catch { throw new Error('invalid-install-metadata'); }
      if (!metadata || typeof metadata.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(metadata.id) ||
        metadata.title !== undefined && (typeof metadata.title !== 'string' || metadata.title.length > 256) ||
        metadata.description !== undefined && (typeof metadata.description !== 'string' || metadata.description.length > 4000)) throw new Error('invalid-install-metadata');
      const required = metadata.requires ?? [];
      if (!Array.isArray(required) || required.length > 64 || required.some(domain => typeof domain !== 'string' || !SUPPORTED_NAPP_DOMAINS.includes(domain))) throw new Error('unsupported-local-capability');
      const actions = metadata.actions ?? [];
      if (!Array.isArray(actions) || actions.length > 128 || actions.some(action => typeof action !== 'string' || !action || action.length > 256)) throw new Error('invalid-install-metadata');
      const key = `local~${metadata.id}`, version = randomId() + randomId();
      const previous = await readLocalApplication(this.account, key); current();
      const files: SiteFile[] = [];
      for (const [index, file] of transfer.files.entries()) {
        await new Promise<void>(resolve => setTimeout(resolve, 0)); current();
        const bytes = await platform.fileSystem.readBytes(`${transfer.directory}/part-${index}`); current();
        const hash = await platform.deviceCrypto.sha256Hex(bytes); current();
        files.push({ path: file.path, mime: file.mime, hash });
        await platform.fileSystem.copy(`${transfer.directory}/part-${index}`, `${transfer.directory}/${hash}.blob`, { overwrite: true });
        await platform.fileSystem.delete(`${transfer.directory}/part-${index}`, { idempotent: true });
      }
      const entry: ExploreEntry = { key, address: key, title: metadata.title || metadata.id, kind: 'napp', description: metadata.description || '',
        servers: [], files, required: applicationRequirements('napp', required), desktopPosition: null, lastUsedAt: null,
        local: { version, installer: this.caller.key, actions } };
      const icon = typeof metadata.icon === 'string' ? files.find(file => file.path === `/${metadata.icon.replace(/^\//, '')}`) : undefined;
      if (icon && /^image\//.test(icon.mime)) {
        entry.icon = { hash: icon.hash, mime: icon.mime };
        entry.localIcon = { account: this.account, appId: key, version, hash: icon.hash };
      }
      const linked = linkAbort([this.signal, transfer.life.signal]);
      let answer: string | false;
      try {
        answer = await this.confirm({ title: entry.title, detail: '', accountPubkey: this.account,
          application: applicationPresentation(this.caller), installation: { target: applicationPresentation(entry), id: key,
            replacing: !!previous, otherInstaller: !!previous && previous.local?.installer !== this.caller.key } }, linked.signal);
      } finally { linked.dispose(); }
      current();
      if (answer !== 'allow') return null;
      await this.checkAccess(); current();
      const directory = await localApplicationDirectory(this.account, key, version); current();
      await platform.fileSystem.makeDirectory(directory.slice(0, directory.lastIndexOf('/')), { intermediates: true, idempotent: true }); current();
      await platform.fileSystem.move(transfer.directory, directory);
      transfer.directory = directory; current();
      transfer.committing = true;
      await commitLocalApplication(this.account, entry, previous?.local?.version, current);
      transfer.committed = true;
      // The file-map pointer and reviewed target grants committed in the same transaction.
      setTimeout(() => { if (!this.signal.aborted) this.installed(entry); }, 0);
      void reapLocalApplicationStorage(this.account, entry).catch(() => {});
      return { nappId: key };
    } finally {
      transfer.busy = false;
      if (method === 'finish' || this.transfer !== transfer) {
        await transfer.writer?.close().catch(() => {});
        await this.discard(transfer);
        if (!transfer.committed) await platform.fileSystem.delete(transfer.directory, { idempotent: true }).catch(() => {});
      }
    }
  }
  private async discard(transfer = this.transfer) {
    if (!transfer) return;
    if (this.transfer === transfer) this.transfer = undefined;
    clearTimeout(transfer.timer);
    transfer.life.abort();
    await transfer.writer?.close().catch(() => {});
    if (!transfer.committed && !transfer.committing) await platform.fileSystem.delete(transfer.directory, { idempotent: true }).catch(() => {});
  }
}
