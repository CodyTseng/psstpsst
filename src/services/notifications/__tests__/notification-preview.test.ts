import type { Rumor } from '@/db/schema/types';
import { getNotificationPreview } from '../notification-preview';

let mockRows: Record<string, string | null>[] = [];
const mockLimit = jest.fn(async () => mockRows);
type MockQuery = {
  from(): MockQuery;
  leftJoin(): MockQuery;
  where(): MockQuery;
  limit(): Promise<Record<string, string | null>[]>;
};
const mockQuery: MockQuery = {
  from: jest.fn((): MockQuery => mockQuery),
  leftJoin: jest.fn((): MockQuery => mockQuery),
  where: jest.fn((): MockQuery => mockQuery),
  limit: mockLimit,
};

jest.mock('@/db/client', () => ({
  db: { select: jest.fn(() => mockQuery) },
}));

jest.mock('@/i18n', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));

function rumor(overrides: Partial<Rumor> = {}): Rumor {
  return {
    id: 'message-id',
    pubkey: 'sender-pubkey',
    kind: 14,
    created_at: 1_700_000_000,
    tags: [['p', 'account-pubkey']],
    content: ' Hello ',
    ...overrides,
  } as Rumor;
}

describe('getNotificationPreview', () => {
  beforeEach(() => {
    mockRows = [];
    mockLimit.mockClear();
  });

  it('uses the standard private-name priority and cached profile picture', async () => {
    mockRows = [{
      petname: 'Private nickname',
      profileDisplayName: 'Profile display name',
      profileName: 'Profile name',
      picture: 'https://example.com/avatar.png',
    }];

    await expect(getNotificationPreview(rumor(), 'account-pubkey')).resolves.toEqual({
      displayName: 'Private nickname',
      messageContent: 'Hello',
      avatarUrl: 'https://example.com/avatar.png',
    });
    expect(mockLimit).toHaveBeenCalledTimes(1);
  });

  it('uses a localized attachment label instead of exposing an encrypted file URL', async () => {
    mockRows = [{
      petname: null,
      profileDisplayName: 'Alice',
      profileName: null,
      picture: null,
    }];

    await expect(
      getNotificationPreview(
        rumor({
          kind: 15,
          content: 'https://media.example/encrypted-blob',
          tags: [['file-type', 'image/jpeg']],
        }),
        'account-pubkey',
      ),
    ).resolves.toEqual({
      displayName: 'Alice',
      messageContent: 'conversations.attachment_image_preview',
      avatarUrl: null,
    });
  });

  it('does not query identity data when only message content is enabled', async () => {
    await expect(
      getNotificationPreview(rumor(), 'account-pubkey', { includeIdentity: false }),
    ).resolves.toEqual({
      displayName: null,
      messageContent: 'Hello',
      avatarUrl: null,
    });
    expect(mockLimit).not.toHaveBeenCalled();
  });
});
