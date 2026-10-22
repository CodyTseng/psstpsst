import { openInlineApplication, subscribeInlineApplicationLaunch } from '../inline-launch';
import type { ExploreEntry } from '../model';

let mockActive: string | null = null;
const mockShowHost = jest.fn(async () => {});
jest.mock('@/platform', () => ({ platform: { napplet: { tasks: { active: () => mockActive, showHost: () => mockShowHost() } } } }));
const entry: ExploreEntry = { kind: 'website', key: 'https://example.com', address: 'https://example.com', title: 'Site',
  description: '', servers: [], required: [], desktopPosition: null, lastUsedAt: null };
beforeEach(() => { jest.clearAllMocks(); mockActive = null; });

it('returns Android task navigation to the main host before delivering the launch', async () => {
  mockActive = 'task';
  const calls: string[] = [];
  mockShowHost.mockImplementationOnce(async () => { calls.push('host'); });
  const open = jest.fn(async () => { calls.push('launch'); });
  const unsubscribe = subscribeInlineApplicationLaunch(open);
  try {
    await openInlineApplication({ entry, account: 'account' });
    expect(calls).toEqual(['host', 'launch']);
    expect(open).toHaveBeenCalledWith({ entry, account: 'account' });
  } finally { unsubscribe(); }
});

it('keeps navigation in the current host and propagates host launch failures', async () => {
  const unsubscribe = subscribeInlineApplicationLaunch(async () => { throw new Error('session-closed'); });
  try {
    await expect(openInlineApplication({ entry, account: 'account' })).rejects.toThrow('session-closed');
    expect(mockShowHost).not.toHaveBeenCalled();
  } finally { unsubscribe(); }
  await expect(openInlineApplication({ entry, account: 'account' })).rejects.toThrow('application-host-unavailable');
});
