import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useDefaultHandlers } from '../use-default-handlers';
import { findCatalogueHandler, readDefaultHandlerCandidates, readDefaultHandlers, readHandlerCandidates, setDefaultHandler, type DefaultHandler } from '@/services/explore/default-handlers';
import type { ExploreEntry } from '@/services/explore/model';

jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('@/services/explore/default-handlers', () => ({ findCatalogueHandler: jest.fn(), readDefaultHandlerCandidates: jest.fn(), readDefaultHandlers: jest.fn(), readHandlerCandidates: jest.fn(), setDefaultHandler: jest.fn() }));
const entry: DefaultHandler = { type: { kind: 'action', name: 'edit', auxiliary: false }, sourceId: 'editor', title: 'Editor', address: 'editor' };
const replacement = { key: 'replacement', title: 'Replacement', address: 'replacement', kind: 'napp' } as ExploreEntry;
let state!: ReturnType<typeof useDefaultHandlers>;
function Probe({ account }: { account: string }) {
  const value = useDefaultHandlers(account);
  useEffect(() => { state = value; }, [value]);
  return null;
}
let renderer: ReactTestRenderer;
beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(readDefaultHandlers).mockResolvedValue([entry]);
  jest.mocked(readDefaultHandlerCandidates).mockResolvedValue([replacement]);
  jest.mocked(readHandlerCandidates).mockResolvedValue([replacement]);
  jest.mocked(setDefaultHandler).mockResolvedValue();
  jest.mocked(findCatalogueHandler).mockReturnValue(undefined);
  await act(async () => { renderer = create(<Probe key="account" account="account" />); });
});
afterEach(() => act(() => renderer.unmount()));

it('replaces a default and clears it to ask every time', async () => {
  await act(async () => state.select(entry));
  expect(state.candidates.entries).toEqual([replacement]);
  await act(async () => state.save(replacement));
  expect(setDefaultHandler).toHaveBeenCalledWith('account', entry.type, replacement);
  expect(state.entries[0].sourceId).toBe('replacement');
  expect(state.selected).toBeNull();
  await act(async () => state.select(state.entries[0]));
  await act(async () => state.save(null));
  expect(setDefaultHandler).toHaveBeenLastCalledWith('account', entry.type, null);
  expect(state.entries).toEqual([]);
});

it('keeps the selection and current preference on failure, then permits retry', async () => {
  await act(async () => state.select(entry));
  jest.mocked(setDefaultHandler).mockRejectedValueOnce(new Error('database unavailable'));
  await act(async () => state.save(replacement));
  expect(state.saveError).toBe(true);
  expect(state.selected).toBe(entry);
  expect(state.entries).toEqual([entry]);
  await act(async () => state.save(replacement));
  expect(state.saveError).toBe(false);
  expect(state.selected).toBeNull();
});

it('rejects a candidate removed since the picker opened', async () => {
  await act(async () => state.select(entry));
  jest.mocked(readHandlerCandidates).mockResolvedValue([]);
  await act(async () => state.save(replacement));
  expect(state.saveError).toBe(true);
  expect(setDefaultHandler).not.toHaveBeenCalled();
});

it('does not let a late previous-account read populate the next account', async () => {
  let finish!: (value: DefaultHandler[]) => void;
  jest.mocked(readDefaultHandlers).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce([]);
  await act(async () => { renderer.update(<Probe key="first" account="first" />); });
  await act(async () => { renderer.update(<Probe key="second" account="second" />); });
  await act(async () => finish([entry]));
  expect(state.entries).toEqual([]);
});


it('saves a compatible catalogue application without requiring My apps membership', async () => {
  await act(async () => state.select(entry));
  jest.mocked(readHandlerCandidates).mockResolvedValue([]);
  jest.mocked(findCatalogueHandler).mockReturnValue(replacement);
  await act(async () => state.save({ key: replacement.key }, true));
  expect(findCatalogueHandler).toHaveBeenCalledWith(entry.type, replacement.key);
  expect(setDefaultHandler).toHaveBeenCalledWith('account', entry.type, replacement);
  expect(state.entries[0].title).toBe('Replacement');
  expect(state.selected).toBeNull();
});

it('keeps the old default when a catalogue selection disappears or stops matching', async () => {
  await act(async () => state.select(entry));
  await act(async () => state.save({ key: replacement.key }, true));
  expect(state.saveError).toBe(true);
  expect(state.entries).toEqual([entry]);
  expect(setDefaultHandler).not.toHaveBeenCalled();
});
