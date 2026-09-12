import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { dmService } from '@/services/dm/dm.service';

import { type DmSupport, useDmSupport } from '../use-dm-support';

jest.mock('@/services/dm/dm.service', () => ({
  dmService: {
    getCachedDmSupport: jest.fn(),
    checkDmSupport: jest.fn(),
  },
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Harness({ onValue }: { onValue: (value: DmSupport) => void }) {
  const value = useDmSupport(['peer']);
  useEffect(() => onValue(value), [onValue, value]);
  return null;
}

describe('useDmSupport', () => {
  let renderer: ReactTestRenderer | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (renderer) {
      act(() => renderer?.unmount());
      renderer = null;
    }
  });

  it('stays silent while reading the local cache and checks only before a relay query', async () => {
    const onValue = jest.fn<void, [DmSupport]>();
    const cache = deferred<null>();
    const relay = deferred<{ encryptionKey: boolean; relays: boolean }>();
    let onRelayQuery: (() => void) | undefined;
    jest.mocked(dmService.getCachedDmSupport).mockReturnValue(cache.promise);
    jest.mocked(dmService.checkDmSupport).mockImplementation((_pubkey, opts) => {
      onRelayQuery = opts?.onRelayQuery;
      return relay.promise;
    });

    act(() => {
      renderer = create(<Harness onValue={onValue} />);
    });
    expect(onValue.mock.calls.at(-1)?.[0].status).toBe('local');
    expect(dmService.checkDmSupport).not.toHaveBeenCalled();

    await act(async () => {
      cache.resolve(null);
      await Promise.resolve();
    });
    expect(onValue.mock.calls.at(-1)?.[0].status).toBe('local');
    expect(dmService.checkDmSupport).toHaveBeenCalledTimes(1);

    act(() => onRelayQuery?.());
    expect(onValue.mock.calls.at(-1)?.[0].status).toBe('checking');

    await act(async () => {
      relay.resolve({ encryptionKey: true, relays: true });
      await Promise.resolve();
    });
    expect(onValue.mock.calls.at(-1)?.[0].status).toBe('ready');
  });

  it('uses a fresh database verdict without entering checking or querying relays', async () => {
    const onValue = jest.fn<void, [DmSupport]>();
    jest.mocked(dmService.getCachedDmSupport).mockResolvedValue({
      encryptionKey: true,
      relays: true,
      at: Date.now(),
    });

    act(() => {
      renderer = create(<Harness onValue={onValue} />);
    });
    expect(onValue.mock.calls.at(-1)?.[0].status).toBe('local');

    await act(async () => {
      await Promise.resolve();
    });
    expect(onValue.mock.calls.at(-1)?.[0].status).toBe('ready');
    expect(onValue.mock.calls.map(([value]) => value.status)).not.toContain('checking');
    expect(dmService.checkDmSupport).not.toHaveBeenCalled();
  });

  it('stays silent when a database miss is satisfied by warm memory caches', async () => {
    const onValue = jest.fn<void, [DmSupport]>();
    jest.mocked(dmService.getCachedDmSupport).mockResolvedValue(null);
    jest.mocked(dmService.checkDmSupport).mockResolvedValue({
      encryptionKey: true,
      relays: true,
    });

    act(() => {
      renderer = create(<Harness onValue={onValue} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onValue.mock.calls.at(-1)?.[0].status).toBe('ready');
    expect(onValue.mock.calls.map(([value]) => value.status)).toEqual(['local', 'ready']);
  });
});
