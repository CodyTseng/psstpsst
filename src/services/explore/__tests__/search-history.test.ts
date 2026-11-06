import type { applicationTestDatabase } from '../testing/database';
import { matchSearchHistory, readSearchHistory } from '../search-history';

let mockDatabase: ReturnType<typeof applicationTestDatabase>;
jest.mock('@/db/client', () => mockDatabase = jest.requireActual('../testing/database').applicationTestDatabase());

beforeEach(() => { mockDatabase.sqlite.exec('DELETE FROM explore_history; DELETE FROM explore_entries;'); });
afterAll(() => { mockDatabase.sqlite.close(); });
function entry(account: string, address: string, usedAt?: number, kind = 'website') {
  mockDatabase.sqlite.prepare('INSERT INTO explore_entries(account_pubkey, source_id, address, title, kind) VALUES (?, ?, ?, ?, ?)')
    .run(account, address, address, address, kind);
  if (usedAt !== undefined) mockDatabase.sqlite.prepare('INSERT INTO explore_history VALUES (?, ?, ?)').run(account, address, usedAt);
}

it('matches fragments without scheme or case and bounds suggestions', () => {
  const addresses = Array.from({ length: 12 }, (_, i) => `https://www.example.com/Notes/${i}`);
  expect(matchSearchHistory(addresses, 'EXAMPLE.com/no')).toEqual(addresses.slice(0, 5));
  expect(matchSearchHistory(addresses, 'https://example.com')).toHaveLength(5);
  for (const input of ['', '   ', 'https://', 'missing']) expect(matchSearchHistory(addresses, input)).toEqual([]);
});

it('excludes the complete current address including normalized host, scheme and root slash', () => {
  const addresses = ['https://example.com/', 'https://example.com/Notes?q=One#top', 'https://example.com/other'];
  for (const input of ['example.com', ' HTTPS://EXAMPLE.COM/ ']) {
    expect(matchSearchHistory(addresses, input)).toEqual(addresses.slice(1));
  }
  expect(matchSearchHistory(addresses, 'example.com/Notes?q=One#top')).toEqual([]);
  expect(matchSearchHistory(addresses, 'example.com/Notes')).toEqual([addresses[1]]);
});

it('returns only visited websites in recency order, isolating accounts and unvisited results', async () => {
  entry('account', 'https://old.example/', 1);
  entry('account', 'https://new.example/Path?q=One#top', 2);
  entry('account', 'https://lookup-only.example/');
  entry('account', 'naddr-signed-site', 3, 'nsite');
  entry('other', 'https://private.example/', 4);
  expect(await readSearchHistory('account')).toEqual(['https://new.example/Path?q=One#top', 'https://old.example/']);
  expect(await readSearchHistory('other')).toEqual(['https://private.example/']);
  mockDatabase.sqlite.exec("DELETE FROM explore_history WHERE source_id='https://old.example/'");
  expect(await readSearchHistory('account')).toEqual(['https://new.example/Path?q=One#top']);
});

it('bounds website reads and cascades visits on account removal', async () => {
  for (let i = 0; i < 205; i++) entry('account', `https://example.com/${i}`, i);
  entry('other', 'https://private.example/', 1);
  const addresses = await readSearchHistory('account');
  expect(addresses).toHaveLength(200);
  expect(addresses[0]).toBe('https://example.com/204');
  expect(addresses).not.toContain('https://example.com/4');
  mockDatabase.sqlite.exec("DELETE FROM accounts WHERE pubkey='other'");
  expect(await readSearchHistory('other')).toEqual([]);
  mockDatabase.sqlite.exec("INSERT INTO accounts VALUES ('other')");
});

it('discards legacy input-only history without changing real visits', async () => {
  const { readFileSync } = jest.requireActual('node:fs');
  entry('account', 'https://opened.example/', 1);
  mockDatabase.sqlite.exec(readFileSync(`${process.cwd()}/src/db/migrations/0080_explore-search-history.sql`, 'utf8'));
  mockDatabase.sqlite.exec("INSERT INTO explore_search_history VALUES ('account', 'https://input-only.example/', 2)");
  mockDatabase.sqlite.exec(readFileSync(`${process.cwd()}/src/db/migrations/0081_website-visit-suggestions.sql`, 'utf8'));
  expect(await readSearchHistory('account')).toEqual(['https://opened.example/']);
  expect(mockDatabase.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='explore_search_history'").get()).toBeUndefined();
});
