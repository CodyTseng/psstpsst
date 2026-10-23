import { connectApplicationWindows, notifyApplicationChange, subscribeApplicationChanges } from '../application-changes';
import { websiteEntry } from '../model';
import type { ApplicationWindowsPort } from '@/platform/ports/application-window';
import type { ExploreEntry } from '../model';
import { broadcastFavoriteChange, notifyFavoritesChanged, subscribeFavoritesChanged } from '../favorites-events';

let receive: (key: string) => void;
let receiveFavorites: (account: string) => void;
const readMetadata = jest.fn<Promise<ExploreEntry | undefined>, [ExploreEntry]>();
const broadcast = jest.fn(async () => {}), detach = jest.fn();
const broadcastFavorites = jest.fn(async () => {});
const port = { broadcastMetadata: broadcast, onMetadataChange: (listener: typeof receive) => { receive = listener; return detach; },
  broadcastFavorites, onFavoritesChange: (listener: typeof receiveFavorites) => { receiveFavorites = listener; return jest.fn(); } } as unknown as ApplicationWindowsPort;
const entry = websiteEntry('https://app.example/');
const stops: (() => void)[] = [];
beforeEach(() => { jest.resetAllMocks(); broadcast.mockResolvedValue(undefined); broadcastFavorites.mockResolvedValue(undefined); connectApplicationWindows(port, readMetadata); });
afterEach(() => { stops.splice(0).forEach(stop => stop()); connectApplicationWindows(); });
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

it('delivers a local item directly and broadcasts only its key', () => {
  const listener = jest.fn();
  stops.push(subscribeApplicationChanges(listener, key => key === entry.key ? entry : undefined));
  notifyApplicationChange(entry);
  expect(listener).toHaveBeenCalledWith(entry);
  expect(broadcast).toHaveBeenCalledWith(entry.key);
  expect(readMetadata).not.toHaveBeenCalled();
});

it('reads one sibling-host item once for all interested lists without echoing the notification', async () => {
  const favorite = jest.fn(), history = jest.fn(), updated = { ...entry, title: 'Updated' };
  stops.push(subscribeApplicationChanges(favorite, key => key === entry.key ? entry : undefined));
  stops.push(subscribeApplicationChanges(history, key => key === entry.key ? entry : undefined));
  jest.mocked(readMetadata).mockResolvedValueOnce(updated);
  receive(entry.key); await settle();
  expect(readMetadata).toHaveBeenCalledTimes(1);
  expect(readMetadata).toHaveBeenCalledWith(entry);
  expect(favorite).toHaveBeenCalledWith(updated);
  expect(history).toHaveBeenCalledWith(updated);
  expect(broadcast).not.toHaveBeenCalled();
});

it('does not query metadata for keys absent from all loaded lists', async () => {
  receive('unrelated-app'); await settle();
  expect(readMetadata).not.toHaveBeenCalled();
});

it('keeps a newer notification that arrives during an unfinished item read', async () => {
  const listener = jest.fn();
  stops.push(subscribeApplicationChanges(listener, key => key === entry.key ? entry : undefined));
  let finish!: (value: ExploreEntry | undefined) => void;
  jest.mocked(readMetadata).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce({ ...entry, title: 'Newest' });
  receive(entry.key); await settle();
  receive(entry.key);
  finish({ ...entry, title: 'Earlier' }); await settle();
  expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Newest' }));
  expect(readMetadata).toHaveBeenCalledTimes(2);
});

it('does not publish an old host read after disconnecting', async () => {
  const listener = jest.fn();
  stops.push(subscribeApplicationChanges(listener, key => key === entry.key ? entry : undefined));
  let finish!: (value: ExploreEntry | undefined) => void;
  jest.mocked(readMetadata).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  receive(entry.key); await settle();
  connectApplicationWindows();
  finish(entry); await settle();
  expect(listener).not.toHaveBeenCalled();
  expect(detach).toHaveBeenCalled();
});

it('keeps favorite membership separate from metadata updates and never echoes received changes', () => {
  const listener = jest.fn(), account = 'a'.repeat(64);
  stops.push(subscribeFavoritesChanged(listener));
  broadcastFavoriteChange(account);
  expect(listener).not.toHaveBeenCalled();
  expect(broadcastFavorites).toHaveBeenCalledWith(account);
  broadcastFavorites.mockClear();
  receiveFavorites(account);
  expect(listener).toHaveBeenCalledWith(account);
  expect(broadcastFavorites).not.toHaveBeenCalled();
  notifyFavoritesChanged(account);
  expect(broadcastFavorites).toHaveBeenCalledWith(account);
  expect(broadcast).not.toHaveBeenCalled();
  expect(readMetadata).not.toHaveBeenCalled();
});
