import { randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';

/** Serialize publication and cleanup so an in-progress snapshot is never evicted. */
export class ClipboardSnapshots {
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly root: string,
    private readonly readClipboardPaths: () => Promise<string[]>,
  ) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => {});
    return next;
  }

  async start(): Promise<void> {
    await this.cleanup();
    // External clipboard changes can invalidate the last snapshot without
    // another copy in this app. Poll only while the process is alive.
    this.timer = setInterval(() => { void this.cleanup(); }, 60_000);
    this.timer.unref();
  }

  stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this.cleanup();
  }

  cleanup(): Promise<void> {
    return this.serialize(() => this.clean()).catch(() => {});
  }

  private async clean(): Promise<void> {
    const entries = await fs.readdir(this.root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    if (!entries.length) return;
    // If the OS clipboard is temporarily inaccessible, preserve every file;
    // the next sweep retries instead of breaking an existing paste operation.
    const paths = await this.readClipboardPaths();
    const retained = new Set(paths.flatMap((file) => {
      const relative = path.relative(this.root, file);
      return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
        ? [relative.split(path.sep)[0]] : [];
    }));
    for (const entry of entries) {
      if (retained.has(entry.name)) continue;
      await fs.rm(path.join(this.root, entry.name), { recursive: true, force: true });
    }
  }

  copy(source: string, originalName: string, publish: (file: string) => Promise<void>): Promise<void> {
    return this.serialize(async () => {
      const name = originalName.replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').slice(0, 180);
      const directory = path.join(this.root, randomUUID());
      const destination = path.join(directory, name && name !== '.' && name !== '..' ? name : 'file');
      let publishing = false;
      try {
        await fs.mkdir(directory, { recursive: true });
        await fs.copyFile(source, destination, constants.COPYFILE_FICLONE);
        publishing = true;
        await publish(destination);
      } catch (error) {
        if (!publishing) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
        else await this.clean().catch(() => {});
        throw error;
      }
      await this.clean().catch(() => {});
    });
  }
}
