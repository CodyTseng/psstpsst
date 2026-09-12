import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { messages } from '@/db/schema';
import { platform } from '@/platform';

import { useLiveQuery } from '../use-live-query';

jest.mock('@/platform', () => ({
  platform: {
    database: {
      addChangeListener: jest.fn(),
    },
  },
}));

type QueryResult = { version: number }[];

describe('useLiveQuery change coalescing', () => {
  let renderer: ReactTestRenderer | null = null;
  let changeListener: ((event: { tableName?: string }) => void) | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
    changeListener = null;
    jest.mocked(platform.database.addChangeListener).mockImplementation((listener) => {
      changeListener = listener;
      return () => {};
    });
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('reruns once for a burst of row-level changes to the same table', async () => {
    let runs = 0;
    const query = {
      config: { table: messages },
      then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        runs += 1;
        return Promise.resolve([{ version: runs }]).then(onfulfilled, onrejected);
      },
    };

    function Harness() {
      const result = useLiveQuery(query, []);
      useEffect(() => void result.data, [result.data]);
      return null;
    }

    await act(async () => {
      renderer = create(<Harness />);
      await Promise.resolve();
    });
    expect(runs).toBe(1);

    act(() => {
      for (let index = 0; index < 20; index += 1) {
        changeListener?.({ tableName: 'messages' });
      }
      jest.runOnlyPendingTimers();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(runs).toBe(2);
  });

  it('owns no query or database listener while disabled', async () => {
    let runs = 0;
    const query = {
      config: { table: messages },
      then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        runs += 1;
        return Promise.resolve([{ version: runs }]).then(onfulfilled, onrejected);
      },
    };

    function Harness({ enabled }: { enabled: boolean }) {
      useLiveQuery(query, [enabled], { enabled });
      return null;
    }

    await act(async () => {
      renderer = create(<Harness enabled={false} />);
      await Promise.resolve();
    });
    expect(runs).toBe(0);
    expect(platform.database.addChangeListener).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.update(<Harness enabled />);
      await Promise.resolve();
    });
    expect(runs).toBe(1);
    expect(platform.database.addChangeListener).toHaveBeenCalledTimes(1);
  });
});
