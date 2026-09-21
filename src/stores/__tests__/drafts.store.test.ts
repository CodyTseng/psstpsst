const mockDelete = jest.fn((_table: unknown) => ({ where: jest.fn(() => Promise.resolve()) }));
const mockInsert = jest.fn((_table: unknown) => ({
  values: jest.fn(() => ({ onConflictDoUpdate: jest.fn(() => Promise.resolve()) })),
}));

jest.mock('@/db/client', () => ({
  db: {
    delete: (table: unknown) => mockDelete(table),
    insert: (table: unknown) => mockInsert(table),
  },
}));
jest.mock('@/platform', () => ({
  platform: { appState: { addChangeListener: jest.fn(() => () => {}) } },
}));

// Jest must install the database and platform factories before this module's
// process-wide app-state listener is evaluated.
// eslint-disable-next-line import/first
import { useDraftsStore } from '../drafts.store';

describe('draft persistence', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockDelete.mockClear();
    mockInsert.mockClear();
    useDraftsStore.setState({ account: 'account', drafts: {} });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('does not write an untouched composer when it unmounts', () => {
    useDraftsStore.getState().flush('conversation');
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('flushes the pending value once and cancels its debounce', async () => {
    useDraftsStore.getState().setDraft('conversation', 'hello');
    useDraftsStore.getState().flush('conversation');
    await Promise.resolve();
    expect(mockInsert).toHaveBeenCalledTimes(1);
    jest.runOnlyPendingTimers();
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });
});
