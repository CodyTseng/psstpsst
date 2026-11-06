import { applicationEntryFromAddress, resolveApplicationReference } from '../application-reference';
import { dataEntries, getData, setData } from '@/services/napplet/data-repository';
import { readApplicationHandlers } from '../application-handlers';
import { findCatalogueHandler, readDefaultHandlerCandidates, readDefaultActionHandler, readDefaultHandlers, readHandlerCandidates, setDefaultHandler } from '../default-handlers';
import type { ExploreEntry } from '../model';

jest.mock('../application-reference', () => ({ applicationEntryFromAddress: jest.fn(), resolveApplicationReference: jest.fn() }));

let mockCatalogue: ExploreEntry[] = [];
jest.mock('../discovery', () => ({ getDiscoveryStore: () => ({ getState: () => ({ entries: mockCatalogue }) }) }));
jest.mock('@/services/napplet/data-repository', () => ({ dataEntries: jest.fn(), getData: jest.fn(), setData: jest.fn(async () => {}) }));
jest.mock('../application-handlers', () => ({ readApplicationHandlers: jest.fn(async () => []) }));
const app = { key: 'app', address: 'address', title: 'Editor', kind: 'napp', manifest: { tags: [['action', 'edit']] } } as ExploreEntry;
beforeEach(() => { jest.clearAllMocks(); mockCatalogue = []; });

it('scopes preferences by account, exact action, and mode without storing request content', async () => {
  await setDefaultHandler('first', { kind: 'action', name: 'edit', auxiliary: true }, app);
  expect(setData).toHaveBeenCalledWith({ accountPubkey: 'first', appKey: 'host:action-defaults' }, 'defaults', '["edit",true]',
    JSON.stringify({ sourceId: 'app', title: 'Editor', address: 'address' }));
  jest.mocked(getData).mockResolvedValue(JSON.stringify({ sourceId: 'app', title: 'Editor', address: 'address' }));
  expect(await readDefaultActionHandler('second', { name: 'edit', auxiliary: false })).toMatchObject({ sourceId: 'app' });
  expect(getData).toHaveBeenCalledWith({ accountPubkey: 'second', appKey: 'host:action-defaults' }, 'defaults', '["edit",false]');
});

it('clears a preference and ignores malformed values', async () => {
  await setDefaultHandler('account', { kind: 'action', name: 'edit', auxiliary: false }, null);
  expect(setData).toHaveBeenLastCalledWith(expect.anything(), 'defaults', '["edit",false]', null);
  for (const value of ['bad', 'null', '{}']) {
    jest.mocked(getData).mockResolvedValue(value);
    expect(await readDefaultActionHandler('account', { name: 'edit', auxiliary: false })).toBeNull();
  }
});

it('lists action defaults alongside existing intent defaults, including unavailable apps', async () => {
  jest.mocked(dataEntries).mockImplementation(async scope => scope.appKey === 'host:action-defaults'
    ? new Map([['["edit",false]', JSON.stringify({ sourceId: 'app', title: 'Editor', address: 'address' })], ['bad', '{}']])
    : new Map([['napplet:profile/open', 'removed']]));
  expect(await readDefaultHandlers('account')).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceId: 'app', title: 'Editor' }),
    { type: { kind: 'intent', name: 'napplet:profile/open' }, sourceId: 'removed', title: '' },
  ]));
});

it('offers only compatible saved handlers when replacing a preference', async () => {
  jest.mocked(readApplicationHandlers).mockResolvedValue([app, { ...app, key: 'other', manifest: { tags: [['action', 'view']] } } as ExploreEntry]);
  expect(await readHandlerCandidates('account', { kind: 'action', name: 'edit', auxiliary: false })).toEqual([app]);
  expect(await readHandlerCandidates('account', { kind: 'action', name: 'edit', auxiliary: true })).toEqual([]);
});


it('rechecks the verified catalogue for the exact action and mode before accepting a replacement', () => {
  mockCatalogue = [app];
  expect(findCatalogueHandler({ kind: 'action', name: 'edit', auxiliary: false }, app.key)).toBe(app);
  expect(findCatalogueHandler({ kind: 'action', name: 'edit', auxiliary: true }, app.key)).toBeUndefined();
  expect(findCatalogueHandler({ kind: 'action', name: 'profile', auxiliary: false }, app.key)).toBeUndefined();
  expect(findCatalogueHandler({ kind: 'intent', name: 'napplet:profile/open' }, app.key)).toBeUndefined();
  mockCatalogue = [];
  expect(findCatalogueHandler({ kind: 'action', name: 'edit', auxiliary: false }, app.key)).toBeUndefined();
});


it('pins the current catalogue default ahead of saved apps when reopening the picker', async () => {
  const current = { ...app, key: 'current', title: 'Current reader' };
  mockCatalogue = [current];
  jest.mocked(readApplicationHandlers).mockResolvedValue([app]);
  const preference = { type: { kind: 'action' as const, name: 'edit', auxiliary: false }, sourceId: current.key, title: current.title, address: current.address };
  expect(await readDefaultHandlerCandidates('account', preference, new AbortController().signal)).toEqual([current, app]);
  expect(resolveApplicationReference).not.toHaveBeenCalled();
});

it('resolves the saved default address after the catalogue cache is lost', async () => {
  jest.mocked(readApplicationHandlers).mockResolvedValue([]);
  jest.mocked(applicationEntryFromAddress).mockReturnValue(app);
  jest.mocked(resolveApplicationReference).mockResolvedValue(app);
  const preference = { type: { kind: 'action' as const, name: 'edit', auxiliary: false }, sourceId: app.key, title: app.title, address: app.address };
  expect(await readDefaultHandlerCandidates('account', preference, new AbortController().signal)).toEqual([app]);
  expect(applicationEntryFromAddress).toHaveBeenCalledWith(app.address);
});

it('keeps one copy of a current default that is also saved in My apps', async () => {
  jest.mocked(readApplicationHandlers).mockResolvedValue([app]);
  const preference = { type: { kind: 'action' as const, name: 'edit', auxiliary: false }, sourceId: app.key, title: app.title };
  expect(await readDefaultHandlerCandidates('account', preference, new AbortController().signal)).toEqual([app]);
});
