import type { Rumor } from '@/db/schema/types';
import { filterNotifiableMessages } from '../notification-filter';

let mockRows: { conversationKey: string; muted: boolean; hasReplied: boolean }[] = [];
const mockWhere = jest.fn(async () => mockRows);

jest.mock('@/db/client', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({ where: mockWhere })),
    })),
  },
}));

const ACCOUNT = 'account-pubkey';

function rumor(id: string, pubkey = 'sender-pubkey', overrides: Partial<Rumor> = {}): Rumor {
  return {
    id,
    pubkey,
    kind: 14,
    created_at: 1_700_000_000,
    tags: [['p', ACCOUNT]],
    content: 'hi',
    ...overrides,
  } as Rumor;
}

describe('filterNotifiableMessages', () => {
  beforeEach(() => {
    mockRows = [];
    mockWhere.mockClear();
  });

  it('rejects self-copies, reactions, and group messages without querying SQLite', async () => {
    const result = await filterNotifiableMessages(
      [
        rumor('self', ACCOUNT),
        rumor('reaction', 'sender-a', { kind: 7 }),
        rumor('group', 'sender-a', { tags: [['p', ACCOUNT], ['p', 'sender-b']] }),
      ],
      ACCOUNT,
    );

    expect(result).toEqual([]);
    expect(mockWhere).not.toHaveBeenCalled();
  });

  it('allows only replied, unmuted conversations in one batch query', async () => {
    mockRows = [
      { conversationKey: 'sender-a', muted: false, hasReplied: true },
      { conversationKey: 'sender-b', muted: true, hasReplied: true },
      { conversationKey: 'sender-c', muted: false, hasReplied: false },
    ];
    const allowed = rumor('a', 'sender-a');

    const result = await filterNotifiableMessages(
      [allowed, rumor('b', 'sender-b'), rumor('c', 'sender-c')],
      ACCOUNT,
    );

    expect(result).toEqual([allowed]);
    expect(mockWhere).toHaveBeenCalledTimes(1);
  });

  it('deduplicates repeated rumor ids before querying and returning', async () => {
    mockRows = [{ conversationKey: 'sender-a', muted: false, hasReplied: true }];
    const first = rumor('same', 'sender-a');

    const result = await filterNotifiableMessages(
      [first, rumor('same', 'sender-a')],
      ACCOUNT,
    );

    expect(result).toEqual([first]);
    expect(mockWhere).toHaveBeenCalledTimes(1);
  });

  it('chunks large conversation sets into bounded SQLite queries', async () => {
    const rumors = Array.from({ length: 501 }, (_, index) =>
      rumor(`rumor-${index}`, `sender-${index}`),
    );

    await filterNotifiableMessages(rumors, ACCOUNT);

    expect(mockWhere).toHaveBeenCalledTimes(2);
  });
});
