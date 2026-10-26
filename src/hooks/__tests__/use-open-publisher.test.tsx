import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useEffect } from 'react';
import { platform } from '@/platform';
import { pushOnce } from '@/lib/navigation';
import { useOpenPublisher } from '../use-open-publisher';

jest.mock('@/platform', () => ({ platform: { napplet: {} } }));
jest.mock('@/lib/navigation', () => ({ pushOnce: jest.fn() }));
jest.mock('@/stores/toast.store', () => ({ showToast: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const pubkey = 'a'.repeat(64);
let open!: ReturnType<typeof useOpenPublisher>;
let renderer: ReactTestRenderer;
function Probe() { const value = useOpenPublisher(); useEffect(() => { open = value; }, [value]); return null; }
beforeEach(() => { jest.clearAllMocks(); delete platform.napplet.windows; delete platform.napplet.tasks; act(() => { renderer = create(<Probe />); }); });
afterEach(() => { act(() => renderer.unmount()); });

it('opens the publisher catalogue from ordinary application details', async () => {
  await act(async () => { open(pubkey); });
  expect(pushOnce).toHaveBeenCalledWith({ pathname: '/explore-publisher', params: { pubkey } });
});

it('delegates desktop application windows to the main host', async () => {
  const action = jest.fn(async () => {});
  platform.napplet.windows = { isHost: true, action } as unknown as NonNullable<typeof platform.napplet.windows>;
  await act(async () => { open(pubkey); });
  expect(action).toHaveBeenCalledWith({ type: 'publisher', pubkey });
  expect(pushOnce).not.toHaveBeenCalled();
});

it('waits for the Android main host before navigating', async () => {
  let finish!: () => void;
  const showHost = jest.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  platform.napplet.tasks = { active: () => 'task', showHost } as unknown as NonNullable<typeof platform.napplet.tasks>;
  await act(async () => { open(pubkey); });
  expect(showHost).toHaveBeenCalledTimes(1);
  expect(pushOnce).not.toHaveBeenCalled();
  await act(async () => { finish(); });
  expect(pushOnce).toHaveBeenCalledWith({ pathname: '/explore-publisher', params: { pubkey } });
});

it('ignores invalid publisher identifiers', async () => {
  await act(async () => { open('invalid'); });
  expect(pushOnce).not.toHaveBeenCalled();
});
