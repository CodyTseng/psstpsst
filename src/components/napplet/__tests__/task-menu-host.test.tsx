import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ApplicationTaskRoot } from '../ApplicationTaskRoot';
import { ApplicationRuntimePage } from '../ApplicationRuntimePage';
import { ExploreApplicationSheet } from '../ExploreApplicationSheet';
import { NappletOverlays } from '../NappletOverlays';

jest.mock('react-native-get-random-values', () => ({}));
jest.mock('@/i18n', () => ({}));
jest.mock('zustand', () => ({ useStore: (_store: unknown, selector: (state: unknown) => unknown) => selector({
  sessions: new Map([['task', { account: 'account', containerId: 'container', loading: false,
    entry: { key: 'site', address: 'https://example.com/', title: 'Website', kind: 'website', required: [], servers: [], description: '' } }]]),
}) }));
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('react-native-keyboard-controller', () => ({ KeyboardProvider: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/services/explore/application-tasks', () => ({ applicationTasks: { start: jest.fn(async () => {}), back: jest.fn(), forward: jest.fn() }, applicationTaskStore: {} }));
jest.mock('@/stores/napplet.store', () => ({ useNapplets: () => ({ prompt: null, configuration: null, panel: null, overlayActive: false }) }));
jest.mock('@/platform/napplet-surface', () => ({ NappletSurface: () => null }));
jest.mock('@/theme', () => ({ SystemColorSchemeProvider: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/i18n/direction', () => ({ useLanguageDirection: () => 'ltr' }));
jest.mock('../ApplicationTaskContext', () => ({ ApplicationTaskContext: jest.requireActual('react').createContext(null), useOwnsApplicationTaskOverlays: () => true }));
jest.mock('../ApplicationRuntimePage', () => ({ ApplicationRuntimePage: ({ overlay }: { overlay: React.ReactNode }) => overlay }));
jest.mock('../ExploreApplicationSheet', () => ({ ExploreApplicationSheet: () => null }));
jest.mock('../NappletOverlays', () => ({ NappletOverlays: () => null }));

it('opens task app information from More and retains modal input ownership through closing', () => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<ApplicationTaskRoot taskId="task" />); });
  const runtime = () => renderer.root.findByType(ApplicationRuntimePage);
  const sheet = () => renderer.root.findByType(ExploreApplicationSheet);
  expect(runtime().props.menuEnabled).toBe(true);
  expect(sheet().props.page).toBeNull();
  act(() => { runtime().props.onMore(); });
  expect(sheet().props.page).toBe('about');
  expect(runtime().props.navigationBlocked).toBe(true);
  expect(renderer.root.findAllByType(NappletOverlays)).toHaveLength(0);
  act(() => { sheet().props.onPageChange('settings'); });
  expect(sheet().props.page).toBe('settings');
  act(() => { sheet().props.onPageChange(null); });
  expect(runtime().props.navigationBlocked).toBe(true);
  act(() => { sheet().props.onClosed(); });
  expect(runtime().props.navigationBlocked).toBe(false);
  act(() => renderer.unmount());
});
