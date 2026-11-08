import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useApplicationNavigation } from '../use-application-navigation';
import { platform } from '@/platform';
import type { ApplicationNavigationState } from '@/platform/ports/napplet';

jest.mock('@/platform', () => ({ platform: { napplet: { getNavigationState: jest.fn(), addNavigationListener: jest.fn() } } }));
const root = { canGoBack: false, canGoForward: false }, middle = { canGoBack: true, canGoForward: true };
let renderer: ReactTestRenderer, state: ApplicationNavigationState;
let listener: (id: string, state: ApplicationNavigationState) => void;
const unsubscribe = jest.fn();
function Fixture({ id }: { id?: string }) {
  const value = useApplicationNavigation(id);
  useEffect(() => { state = value; }, [value]);
  return null;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(platform.napplet.addNavigationListener).mockImplementation(callback => { listener = callback; return unsubscribe; });
  jest.mocked(platform.napplet.getNavigationState).mockResolvedValue(root);
});
afterEach(() => { act(() => renderer?.unmount()); });

it('ignores other containers and does not let a stale snapshot replace a newer event', async () => {
  let resolve!: (value: ApplicationNavigationState) => void;
  jest.mocked(platform.napplet.getNavigationState).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(async () => { renderer = create(<Fixture id="a" />); });
  act(() => listener('other', middle));
  expect(state).toEqual(root);
  act(() => listener('a', middle));
  expect(state).toEqual(middle);
  await act(async () => { resolve(root); });
  expect(state).toEqual(middle);
});

it('resets on container replacement and ignores pending reads and notifications after cleanup', async () => {
  let resolve!: (value: ApplicationNavigationState) => void;
  jest.mocked(platform.napplet.getNavigationState).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(async () => { renderer = create(<Fixture id="a" />); });
  const oldListener = listener;
  await act(async () => { renderer.update(<Fixture id="b" />); });
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(middle); oldListener('a', middle); });
  expect(state).toEqual(root);
  act(() => listener('b', middle));
  expect(state).toEqual(middle);
  await act(async () => { renderer.update(<Fixture />); });
  expect(state).toEqual(root);
  expect(unsubscribe).toHaveBeenCalledTimes(2);
});
