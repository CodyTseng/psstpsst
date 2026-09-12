let mockResults: boolean[] = [];
const mockSetCount = jest.fn(async (_count: number) => mockResults.shift() ?? true);

jest.mock('@/platform', () => ({
  platform: {
    unreadIndicator: {
      setCount: (count: number) => mockSetCount(count),
    },
  },
}));

type UnreadIndicatorModule = typeof import('../unread-indicator.service');

function loadService(): UnreadIndicatorModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module state per test
  return require('../unread-indicator.service') as UnreadIndicatorModule;
}

describe('unread indicator synchronization', () => {
  beforeEach(() => {
    jest.resetModules();
    mockResults = [];
    mockSetCount.mockClear();
  });

  it('does not repeat a successful identical write', async () => {
    const { syncUnreadIndicator } = loadService();

    await syncUnreadIndicator(4);
    await syncUnreadIndicator(4);

    expect(mockSetCount).toHaveBeenCalledTimes(1);
    expect(mockSetCount).toHaveBeenCalledWith(4);
  });

  it('retries the requested count after a failed write', async () => {
    mockResults = [false, true];
    const { retryUnreadIndicator, syncUnreadIndicator } = loadService();

    await syncUnreadIndicator(4);
    await retryUnreadIndicator();

    expect(mockSetCount).toHaveBeenCalledTimes(2);
    expect(mockSetCount).toHaveBeenNthCalledWith(1, 4);
    expect(mockSetCount).toHaveBeenNthCalledWith(2, 4);
  });
});
