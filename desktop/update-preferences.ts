import { promises as fs } from 'node:fs';
import writeFileAtomic from 'write-file-atomic';
import type { AppUpdateStatus } from '../src/platform/ports/app-update';
import { UPDATE_CHECK_INTERVAL_MS } from './app-updater';

type Reminder = { version: string; state: 'available' | 'downloaded'; after: number };
type Preferences = { skippedVersion: string | null; reminder: Reminder | null };

/** Device-wide update choices survive renderer and application restarts. */
export class UpdatePreferences {
  private value: Preferences = { skippedVersion: null, reminder: null };
  private committed = this.value;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string, private readonly now = Date.now) {}

  async load(): Promise<void> {
    try {
      const saved = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      const version = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 64;
      const reminder = saved.reminder;
      this.value = {
        skippedVersion: version(saved.skippedVersion) ? saved.skippedVersion : null,
        reminder: reminder && version(reminder.version) &&
          (reminder.state === 'available' || reminder.state === 'downloaded') &&
          Number.isSafeInteger(reminder.after) && reminder.after > 0 ? reminder : null,
      };
      this.committed = this.value;
    } catch {
      // Missing or damaged preferences must not prevent updating the application.
    }
  }

  shouldPrompt(status: AppUpdateStatus): boolean {
    if (status.state !== 'available' && status.state !== 'downloaded') return false;
    if (status.state === 'available' && status.version === this.value.skippedVersion) return false;
    const reminder = this.value.reminder;
    return !reminder || reminder.version !== status.version || reminder.state !== status.state || this.now() >= reminder.after;
  }

  skip(version: string): Promise<void> {
    return this.save({ ...this.value, skippedVersion: version });
  }

  defer(status: AppUpdateStatus): Promise<void> {
    if (status.state !== 'available' && status.state !== 'downloaded') return Promise.resolve();
    return this.save({ ...this.value, reminder: {
      version: status.version, state: status.state, after: this.now() + UPDATE_CHECK_INTERVAL_MS,
    } });
  }

  flush(): Promise<void> { return this.writes; }

  private save(next: Preferences): Promise<void> {
    this.value = next;
    const task = this.writes.catch(() => {}).then(async () => {
      await writeFileAtomic(this.filePath, JSON.stringify(next));
      this.committed = next;
    });
    this.writes = task;
    return task.catch(error => {
      if (this.value === next) this.value = this.committed;
      throw error;
    });
  }
}
