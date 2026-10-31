import type { DatabaseSync } from 'node:sqlite';

import { platform } from '@/platform';
import { deleteWallpaperImage, wallpaperLibraryStore } from '../chat-wallpaper.service';

jest.mock('@/db/client', () => {
  const { DatabaseSync } = jest.requireActual('node:sqlite');
  const { drizzle } = jest.requireActual('drizzle-orm/sqlite-proxy');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE device_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  const db = drizzle(async (query: string, parameters: unknown[], method: string) => {
    const statement = sqlite.prepare(query);
    if (method === 'run') { statement.run(...parameters); return { rows: [] }; }
    if (method === 'get') {
      const row = statement.get(...parameters);
      return { rows: row ? Object.values(row) : [] };
    }
    return { rows: statement.all(...parameters).map((row: object) => Object.values(row)) };
  });
  return { db, sqlite };
});
jest.mock('@/platform', () => ({ platform: { fileSystem: {
  documentDirectoryUri: jest.fn(async () => 'file:///documents/'),
  delete: jest.fn(async () => {}),
} } }));

const sqlite = jest.requireMock('@/db/client').sqlite as DatabaseSync;
function insert(key: string, value: string) {
  sqlite.prepare('INSERT INTO device_preferences VALUES (?, ?, 0)').run(key, value);
}
function stored(key: string) {
  return sqlite.prepare('SELECT value FROM device_preferences WHERE key = ?').get(key)?.value;
}
const image = JSON.stringify({ kind: 'image', fileName: 'shared.jpg', library: true });

beforeEach(() => {
  sqlite.exec('DROP TRIGGER IF EXISTS reject_wallpaper_update; DELETE FROM device_preferences');
  wallpaperLibraryStore.setState({ images: [{ fileName: 'shared.jpg', uri: 'file:///documents/chat-wallpapers/library/shared.jpg' }],
    loaded: true, error: false, adding: false, deleting: null });
  jest.clearAllMocks();
});
afterAll(() => sqlite.close());

it('resets all referencing accounts while retaining unrelated and malformed preferences', async () => {
  insert('chat.wallpaper.default', image);
  insert('chat.wallpaper.account-one.peer', image);
  insert('chat.wallpaper.inactive-account.group', image);
  const other = JSON.stringify({ kind: 'image', fileName: 'other.jpg', library: true });
  insert('chat.wallpaper.other.peer', other);
  insert('chat.wallpaper.legacy.peer', JSON.stringify({ kind: 'image', fileName: 'shared.jpg' }));
  insert('chat.wallpaper.corrupt', 'not JSON');
  insert('unrelated.preference', image);
  await deleteWallpaperImage('shared.jpg');
  expect(stored('chat.wallpaper.default')).toBe('{"kind":"none"}');
  expect(stored('chat.wallpaper.account-one.peer')).toBe('null');
  expect(stored('chat.wallpaper.inactive-account.group')).toBe('null');
  expect(stored('chat.wallpaper.other.peer')).toBe(other);
  expect(stored('chat.wallpaper.legacy.peer')).toBe('{"kind":"image","fileName":"shared.jpg"}');
  expect(stored('chat.wallpaper.corrupt')).toBe('not JSON');
  expect(stored('unrelated.preference')).toBe(image);
  expect(stored('chat.wallpaper.removed.shared.jpg')).toBe('true');
  expect(platform.fileSystem.delete).toHaveBeenCalledWith('file:///documents/chat-wallpapers/library/shared.jpg', { idempotent: true });
});

it('rolls back the removal marker and retains image bytes if clearing references fails', async () => {
  insert('chat.wallpaper.default', image);
  sqlite.exec(`CREATE TRIGGER reject_wallpaper_update BEFORE UPDATE ON device_preferences
    BEGIN SELECT RAISE(ABORT, 'write failed'); END`);
  await expect(deleteWallpaperImage('shared.jpg')).rejects.toThrow();
  expect(stored('chat.wallpaper.default')).toBe(image);
  expect(stored('chat.wallpaper.removed.shared.jpg')).toBeUndefined();
  expect(wallpaperLibraryStore.getState().images).toHaveLength(1);
  expect(platform.fileSystem.delete).not.toHaveBeenCalled();
});
