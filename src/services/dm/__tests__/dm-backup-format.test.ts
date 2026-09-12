import {
  CHAT_ARCHIVE_FORMAT,
  CHAT_ARCHIVE_VERSION,
  backupImportKind,
  createChatArchiveManifest,
  parseChatArchiveManifest,
  parseChatArchiveProximityPeer,
} from '../dm-backup-format';

const PUBKEY = 'a'.repeat(64);

describe('backupImportKind', () => {
  test.each([
    ['history.zip', 'archive'],
    ['history.JSONL', 'messages'],
    ['history.ndjson', 'messages'],
    ['history.json', null],
    ['history.zip.pdf', null],
    ['', null],
  ])('classifies %s as %s', (filename, expected) => {
    expect(backupImportKind(filename)).toBe(expected);
  });
});

describe('dm backup format', () => {
  test('creates and parses Nearby archive counts', () => {
    const manifest = createChatArchiveManifest({
      accountPubkey: PUBKEY,
      messages: 2,
      proximityMessages: 3,
      proximityIdentities: 1,
      proximityPeers: 1,
      attachments: 4,
      attachmentBytes: 5,
    });

    expect(parseChatArchiveManifest(manifest)).toEqual(manifest);
    expect(manifest.version).toBe(CHAT_ARCHIVE_VERSION);
  });

  test('normalizes a version 1 archive to empty Nearby counts', () => {
    expect(
      parseChatArchiveManifest({
        format: CHAT_ARCHIVE_FORMAT,
        version: 1,
        createdAt: new Date(0).toISOString(),
        accountPubkey: PUBKEY,
        counts: { messages: 2, attachments: 0 },
        sizes: { attachments: 0 },
      }),
    ).toMatchObject({
      version: 1,
      counts: {
        messages: 2,
        proximityMessages: 0,
        proximityIdentities: 0,
        proximityPeers: 0,
        attachments: 0,
      },
    });
  });

  test('rejects inconsistent Nearby identity counts', () => {
    const manifest = createChatArchiveManifest({
      accountPubkey: PUBKEY,
      messages: 0,
      proximityMessages: 1,
      proximityIdentities: 1,
      proximityPeers: 0,
      attachments: 0,
      attachmentBytes: 0,
    });

    expect(
      parseChatArchiveManifest({
        ...manifest,
        counts: { ...manifest.counts, proximityIdentities: 0 },
      }),
    ).toBeNull();
  });

  test('parses safe peer labels without transport trust state', () => {
    expect(
      parseChatArchiveProximityPeer({
        pubkey: PUBKEY,
        displayName: 'Alice',
        nickname: 'Laptop Alice',
        lastSeenAt: 123,
      }),
    ).toEqual({
      pubkey: PUBKEY,
      displayName: 'Alice',
      nickname: 'Laptop Alice',
      lastSeenAt: 123,
    });
    expect(
      parseChatArchiveProximityPeer({
        pubkey: PUBKEY,
        displayName: 'Alice',
        nickname: ' unsafe\u202e',
        lastSeenAt: 123,
      }),
    ).toBeNull();
  });
});
