import { readFavoriteEntries, readHistoryPage } from '../repository';
import { readLocalFavoriteSnapshot } from '../favorites-snapshot';
import { readApplicationCache } from '../application-cache';
import { websiteEntry } from '../model';
import { applicationTestDatabase } from '../testing/database';

let mockDatabase: ReturnType<typeof applicationTestDatabase>;
jest.mock('@/db/client', () => ({ get db() { return mockDatabase.db; } }));
jest.mock('../favorites-snapshot', () => ({ readLocalFavoriteSnapshot: jest.fn(), knownFavoriteSnapshot: jest.fn() }));
jest.mock('../favorites', () => ({ queueFavoritesPublication: jest.fn() }));
jest.mock('../application-cache', () => ({ ...jest.requireActual('../application-event'), readApplicationCache: jest.fn() }));
jest.mock('@/services/relay/private-list-sync.service', () => ({ readPrivateListState: jest.fn(), markPrivateListDirty: jest.fn() }));
jest.mock('@/services/account/account-receive-guard', () => ({ canReceiveForAccount: jest.fn() }));

beforeEach(() => { mockDatabase = applicationTestDatabase(); jest.clearAllMocks(); });
afterEach(() => mockDatabase.sqlite.close());

it('reads only first-page metadata without history while retaining all shortcut positions', async () => {
  const favorites = Array.from({ length: 123 }, (_, index) => ({ entry: websiteEntry(`https://app-${index}.example/`), tag: [] }));
  jest.mocked(readLocalFavoriteSnapshot).mockResolvedValue(favorites);
  jest.mocked(readApplicationCache).mockResolvedValue(new Map());
  const insert = mockDatabase.sqlite.prepare('INSERT INTO explore_entries(account_pubkey,source_id,address,title,kind,manifest) VALUES (?,?,?,?,?,?)');
  favorites.forEach(({ entry }, index) => insert.run('account', entry.key, entry.address, `Saved ${index}`, 'website', index >= 50 ? '{invalid' : null));
  // Missing history makes any accidental join fail instead of silently becoming a prerequisite.
  mockDatabase.sqlite.exec('DROP TABLE explore_history');
  const entries = await readFavoriteEntries('account');
  expect(readApplicationCache).not.toHaveBeenCalled();
  expect(entries).toHaveLength(123);
  expect(entries[49]).toMatchObject({ title: 'Saved 49', desktopPosition: 49, lastUsedAt: null });
  expect(entries[50]).toMatchObject({ title: favorites[50].entry.title, desktopPosition: 50 });
  expect(entries[122].desktopPosition).toBe(122);
});

it('returns an empty resolved grid without reading metadata when there are no favorites', async () => {
  jest.mocked(readLocalFavoriteSnapshot).mockResolvedValue([]);
  await expect(readFavoriteEntries('account')).resolves.toEqual([]);
  expect(readApplicationCache).not.toHaveBeenCalled();
});

it('pages history in timestamp/key order without skipping rows after a deletion', async () => {
  const insert = mockDatabase.sqlite.prepare('INSERT INTO explore_entries(account_pubkey,source_id,address,title,kind) VALUES (?,?,?,?,?)');
  const visit = mockDatabase.sqlite.prepare('INSERT INTO explore_history(account_pubkey,source_id,last_used_at) VALUES (?,?,?)');
  const keys = Array.from({ length: 123 }, (_, i) => `https://app-${String(i).padStart(3, '0')}.example/`);
  keys.forEach((key, index) => { insert.run('account', key, key, key, 'website'); visit.run('account', key, index === 122 ? 200 : 100); });
  const ordered = [keys[122], ...keys.slice(0, 122)];
  insert.run('other', 'https://other.example/', 'https://other.example/', 'Other account', 'website');
  visit.run('other', 'https://other.example/', 999);
  jest.mocked(readApplicationCache).mockResolvedValue(new Map());
  const first = await readHistoryPage('account');
  expect(first.entries.map(app => app.key)).toEqual(ordered.slice(0, 50));
  expect(first.hasMore).toBe(true);
  expect(readApplicationCache).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ key: ordered[49] })]));
  expect(jest.mocked(readApplicationCache).mock.calls[0][0]).toHaveLength(50);
  mockDatabase.sqlite.prepare('DELETE FROM explore_history WHERE source_id=?').run(keys[0]);
  const second = await readHistoryPage('account', first.cursor);
  expect(second.entries.map(app => app.key)).toEqual(ordered.slice(50, 100));
  const last = await readHistoryPage('account', second.cursor);
  expect(last.entries.map(app => app.key)).toEqual(ordered.slice(100));
  expect(last.hasMore).toBe(false);
  expect(readLocalFavoriteSnapshot).not.toHaveBeenCalled();
});
