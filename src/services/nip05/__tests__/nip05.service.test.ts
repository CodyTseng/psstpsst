import { base64 } from '@scure/base';

import {
  checkNip05NameAvailability,
  deleteNip05Name,
  lookupNip05Name,
  lookupNip05NameByPubkey,
  Nip05NameError,
  normalizeNip05Name,
  upsertNip05Name,
} from '@/services/nip05/nip05.service';
import type { Signer } from '@/services/signer/signer.interface';

const PUBKEY = 'ab'.repeat(32);

const signer: Signer = {
  getPublicKey: async () => PUBKEY,
  signEvent: async (template) => ({
    ...template,
    id: '00'.repeat(32),
    pubkey: PUBKEY,
    sig: '11'.repeat(64),
  }),
};

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = fetchMock;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** Decode the NIP-98 event out of the `Authorization: Nostr <b64>` header. */
function decodeAuthEvent(init: RequestInit): {
  kind: number;
  pubkey: string;
  tags: string[][];
} {
  const header = (init.headers as Record<string, string>).Authorization;
  expect(header).toMatch(/^Nostr /);
  return JSON.parse(
    new TextDecoder().decode(base64.decode(header.slice('Nostr '.length))),
  );
}

describe('normalizeNip05Name', () => {
  it('accepts valid names and normalizes case and whitespace', () => {
    expect(normalizeNip05Name('alice')).toBe('alice');
    expect(normalizeNip05Name('  Alice.Smith_01 ')).toBe('alice.smith_01');
    expect(normalizeNip05Name('a.b-c')).toBe('a.b-c');
    expect(normalizeNip05Name('a'.repeat(5))).toBe('a'.repeat(5));
    expect(normalizeNip05Name('a'.repeat(30))).toBe('a'.repeat(30));
    expect(normalizeNip05Name('admin')).toBe('admin');
  });

  it('rejects invalid names', () => {
    for (const name of [
      '',
      'a-b', // too short even when punctuation is valid
      'abcd', // too short
      'a'.repeat(31), // too long
      '-alice', // must start with a letter or digit
      '_alice',
      '.alice',
      'alice-', // must end with a letter or digit
      'alice_',
      'alice.',
      'al ice',
      'al@ice',
      'alice!',
    ]) {
      expect(normalizeNip05Name(name)).toBeNull();
    }
  });
});

describe('checkNip05NameAvailability', () => {
  beforeEach(() => fetchMock.mockReset());

  it.each([
    [200, 'available'],
    [400, 'invalid'],
    [403, 'reserved'],
    [409, 'taken'],
  ] as const)('maps %i to %s', async (status, availability) => {
    fetchMock.mockResolvedValue(jsonResponse(status, {}));

    await expect(checkNip05NameAvailability('alice')).resolves.toBe(availability);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://psstpsst.chat/api/names/alice/availability',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws request_failed on network or unexpected HTTP failure', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(checkNip05NameAvailability('alice')).rejects.toMatchObject({
      code: 'request_failed',
    });

    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    await expect(checkNip05NameAvailability('alice')).rejects.toMatchObject({
      code: 'request_failed',
    });
  });
});

describe('lookupNip05Name', () => {
  beforeEach(() => fetchMock.mockReset());

  it('returns the bound pubkey for a registered name', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { names: { alice: PUBKEY } }));
    await expect(lookupNip05Name('alice')).resolves.toBe(PUBKEY);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://psstpsst.chat/.well-known/nostr.json?name=alice',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns null for an unregistered name', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { names: {} }));
    await expect(lookupNip05Name('alice')).resolves.toBeNull();
  });

  it('throws request_failed on network or HTTP failure', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(lookupNip05Name('alice')).rejects.toMatchObject({
      code: 'request_failed',
    });
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    await expect(lookupNip05Name('alice')).rejects.toMatchObject({
      code: 'request_failed',
    });
  });
});

describe('lookupNip05NameByPubkey', () => {
  beforeEach(() => fetchMock.mockReset());

  it('returns the claimed name for an owning pubkey', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { names: { Alice: PUBKEY } }));
    await expect(lookupNip05NameByPubkey(PUBKEY)).resolves.toBe('alice');
    expect(fetchMock).toHaveBeenCalledWith(
      `https://psstpsst.chat/.well-known/nostr.json?pubkey=${PUBKEY}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns a legacy name shorter than the current registration minimum', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { names: { Cody: PUBKEY } }));
    await expect(lookupNip05NameByPubkey(PUBKEY)).resolves.toBe('cody');
  });

  it('returns null when the pubkey owns no name', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { names: {} }));
    await expect(lookupNip05NameByPubkey(PUBKEY)).resolves.toBeNull();
  });

  it('throws request_failed on network or HTTP failure', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(lookupNip05NameByPubkey(PUBKEY)).rejects.toMatchObject({
      code: 'request_failed',
    });
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    await expect(lookupNip05NameByPubkey(PUBKEY)).rejects.toMatchObject({
      code: 'request_failed',
    });
  });
});

describe('upsertNip05Name', () => {
  beforeEach(() => fetchMock.mockReset());

  it.each([201, 200])('accepts %i with a bodyless, NIP-98 authorized PUT', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse(status, { name: 'alice', pubkey: PUBKEY }));

    await expect(upsertNip05Name({ signer, name: ' Alice ' })).resolves.toEqual({
      name: 'alice',
      pubkey: PUBKEY,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://psstpsst.chat/api/names/alice');
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBeUndefined();
    expect(init?.headers).not.toHaveProperty('Content-Type');

    const event = decodeAuthEvent(init!);
    expect(event.kind).toBe(27235);
    expect(event.pubkey).toBe(PUBKEY);
    expect(event.tags).toEqual([
      ['u', 'https://psstpsst.chat/api/names/alice'],
      ['method', 'PUT'],
    ]);
  });

  it('registers, renames, and repeats an owned name using only PUT', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { name: 'alice', pubkey: PUBKEY }))
      .mockResolvedValueOnce(jsonResponse(201, { name: 'bob45', pubkey: PUBKEY }))
      .mockResolvedValueOnce(jsonResponse(200, { name: 'bob45', pubkey: PUBKEY }));

    await upsertNip05Name({ signer, name: 'alice' });
    await expect(upsertNip05Name({ signer, name: 'bob45' })).resolves.toEqual({
      name: 'bob45', pubkey: PUBKEY,
    });
    await expect(upsertNip05Name({ signer, name: ' BOB45 ' })).resolves.toEqual({
      name: 'bob45', pubkey: PUBKEY,
    });

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['https://psstpsst.chat/api/names/alice', 'PUT'],
      ['https://psstpsst.chat/api/names/bob45', 'PUT'],
      ['https://psstpsst.chat/api/names/bob45', 'PUT'],
    ]);
  });

  it.each([
    [400, 'invalid_name'],
    [401, 'auth_failed'],
    [403, 'name_reserved'],
    [409, 'name_taken'],
    [500, 'request_failed'],
  ])('maps %i to %s without deleting or rolling back a name', async (status, code) => {
    fetchMock.mockResolvedValue(jsonResponse(status as number, {}));
    await expect(upsertNip05Name({ signer, name: 'alice' })).rejects.toMatchObject({ code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('PUT');
  });

  it('reports network failure without a rollback request', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(upsertNip05Name({ signer, name: 'alice' })).rejects.toMatchObject({
      code: 'request_failed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid names before signing or sending a request', async () => {
    const signEvent = jest.fn(signer.signEvent);
    await expect(
      upsertNip05Name({ signer: { ...signer, signEvent }, name: 'ab' }),
    ).rejects.toBeInstanceOf(Nip05NameError);
    expect(signEvent).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('deleteNip05Name', () => {
  beforeEach(() => fetchMock.mockReset());

  it('deletes with a NIP-98 authorization event', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { deleted: 'alice' }));

    await expect(deleteNip05Name({ signer, name: 'alice' })).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://psstpsst.chat/api/names/alice');
    expect(init?.method).toBe('DELETE');
    const event = decodeAuthEvent(init!);
    expect(event.kind).toBe(27235);
    expect(event.tags).toContainEqual(['u', 'https://psstpsst.chat/api/names/alice']);
    expect(event.tags).toContainEqual(['method', 'DELETE']);
  });

  it('keeps a forbidden delete distinct from a reserved-name rejection', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, {}));

    await expect(deleteNip05Name({ signer, name: 'alice' })).rejects.toMatchObject({
      code: 'auth_failed',
    });
  });
});
