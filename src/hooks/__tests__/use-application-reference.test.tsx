import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useEffect } from 'react';
import type { NostrEventReference } from '@/lib/nostr/event-reference';
import { peekApplicationReference, resolveApplicationReference } from '@/services/explore/application-reference';
import { useApplicationReference } from '../use-application-reference';

jest.mock('@/stores/active-account.store', () => ({ useActiveAccount: (select: (state: object) => unknown) => select({ activePubkey: 'account' }) }));
jest.mock('@/services/explore/application-reference', () => ({
  applicationReferenceEntry: (reference: NostrEventReference) => ({ key: reference.bech32 }),
  peekApplicationReference: jest.fn(), resolveApplicationReference: jest.fn(),
}));

let state: ReturnType<typeof useApplicationReference>;
let renderer: ReactTestRenderer;
const first = { bech32: 'first' } as NostrEventReference;
const second = { bech32: 'second' } as NostrEventReference;
function Preview({ reference = first, enabled = true }: { reference?: NostrEventReference; enabled?: boolean }) {
  const value = useApplicationReference(reference, enabled);
  useEffect(() => { state = value; }, [value]);
  return null;
}
beforeEach(() => { jest.clearAllMocks(); jest.mocked(peekApplicationReference).mockReturnValue(undefined); });
afterEach(() => { act(() => renderer?.unmount()); });

it('reads warm metadata while held without fetching', () => {
  const entry = { title: 'Cached app' } as never;
  jest.mocked(peekApplicationReference).mockReturnValue(entry);
  act(() => { renderer = create(<Preview enabled={false} />); });
  expect(state.entry).toBe(entry);
  expect(state.loading).toBe(false);
  expect(resolveApplicationReference).not.toHaveBeenCalled();
});

it('aborts a recycled row lookup and never exposes its old application', async () => {
  let finish!: (value: never) => void;
  jest.mocked(resolveApplicationReference).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce({ title: 'Second app' } as never);
  await act(async () => { renderer = create(<Preview />); });
  const signal = jest.mocked(resolveApplicationReference).mock.calls[0][2];
  await act(async () => { renderer.update(<Preview reference={second} />); });
  expect(signal.aborted).toBe(true);
  await act(async () => { finish({ title: 'First app' } as never); });
  expect(state.entry?.title).toBe('Second app');
});

it('keeps retry loading visible until new metadata resolves', async () => {
  jest.mocked(resolveApplicationReference).mockResolvedValueOnce(null);
  await act(async () => { renderer = create(<Preview />); });
  expect(state.loading).toBe(false);
  let finish!: (value: never) => void;
  jest.mocked(resolveApplicationReference).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { state.retry(); });
  expect(state.loading).toBe(true);
  expect(resolveApplicationReference).toHaveBeenLastCalledWith('account', expect.anything(), expect.anything(), true);
  await act(async () => { finish({ title: 'Recovered app' } as never); });
  expect(state.entry?.title).toBe('Recovered app');
  expect(state.loading).toBe(false);
});
