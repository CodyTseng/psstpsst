import {
  authorizeWalletPin,
  consumeWalletPinAuthorization,
  hasWalletPin,
  removeWalletPin,
  setWalletPin,
  verifyWalletPin,
  walletAuthenticationMode,
} from '../wallet-pin.service';

const mockSecrets = new Map<string, string>();
let mockSystemAuthEnrolled = false;
let mockUuid = 0;

jest.mock('@/platform', () => ({
  platform: {
    localAuth: {
      hasEnrolledAuth: jest.fn(async () => mockSystemAuthEnrolled),
    },
    secureStorage: {
      getItem: jest.fn(async (key: string) => mockSecrets.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        mockSecrets.set(key, value);
      }),
      deleteItem: jest.fn(async (key: string) => {
        mockSecrets.delete(key);
      }),
    },
    deviceCrypto: {
      randomUUID: jest.fn(async () => `test-uuid-${++mockUuid}`),
    },
  },
}));

const ACCOUNT = 'a'.repeat(64);

describe('wallet PIN service', () => {
  beforeEach(() => {
    mockSecrets.clear();
    mockSystemAuthEnrolled = false;
    mockUuid = 0;
  });

  it('requires setup without system authentication and verifies the stored PIN', async () => {
    await expect(walletAuthenticationMode(ACCOUNT)).resolves.toBe('pin_setup_required');

    await setWalletPin(ACCOUNT, '123456');

    await expect(hasWalletPin(ACCOUNT)).resolves.toBe(true);
    await expect(walletAuthenticationMode(ACCOUNT)).resolves.toBe('pin');
    await expect(verifyWalletPin(ACCOUNT, '123456')).resolves.toBe(true);
    await expect(verifyWalletPin(ACCOUNT, '123457')).resolves.toBe(false);
  });

  it('issues a short-lived one-use authorization bound to the account', async () => {
    await setWalletPin(ACCOUNT, '123456');
    const token = await authorizeWalletPin(ACCOUNT, '123456');

    expect(token).not.toBeNull();
    expect(consumeWalletPinAuthorization('b'.repeat(64), token!)).toBe(false);
    expect(consumeWalletPinAuthorization(ACCOUNT, token!)).toBe(false);

    const secondToken = await authorizeWalletPin(ACCOUNT, '123456');
    expect(consumeWalletPinAuthorization(ACCOUNT, secondToken!)).toBe(true);
    expect(consumeWalletPinAuthorization(ACCOUNT, secondToken!)).toBe(false);
  });

  it('prefers enrolled system authentication and removes account PIN data', async () => {
    await setWalletPin(ACCOUNT, '123456');
    mockSystemAuthEnrolled = true;

    await expect(walletAuthenticationMode(ACCOUNT)).resolves.toBe('system');
    await removeWalletPin(ACCOUNT);
    await expect(hasWalletPin(ACCOUNT)).resolves.toBe(false);
  });

  it('rejects PINs that are not exactly six digits', async () => {
    await expect(setWalletPin(ACCOUNT, '12345')).rejects.toThrow('exactly 6 digits');
    await expect(setWalletPin(ACCOUNT, 'abcdef')).rejects.toThrow('exactly 6 digits');
  });
});
