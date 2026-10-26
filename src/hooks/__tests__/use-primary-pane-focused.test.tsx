import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';

import { SearchTransition } from '@/components/search/SearchTransition';
import { usePrimaryPaneFocused } from '../use-primary-pane-focused';

let mockWide = true;
let mockFocused = false;
let mockSelected = 'chats';
const mockListeners = new Set<() => void>();
const mockNavigation = {
  getState: () => ({ index: mockSelected === 'chats' ? 0 : 1, routes: [{ key: 'chats' }, { key: 'contacts' }] }),
  addListener: jest.fn((_event: string, listener: () => void) => {
    mockListeners.add(listener);
    return () => { mockListeners.delete(listener); };
  }),
};
jest.mock('expo-router', () => ({
  useIsFocused: () => mockFocused,
  useNavigation: () => mockNavigation,
  useRoute: () => ({ key: 'chats' }),
}));
jest.mock('@/components/navigation/primary-pane-navigation', () => ({
  usePrimaryPaneNavigation: () => ({ wide: mockWide }),
}));

beforeEach(() => {
  mockWide = true;
  mockFocused = false;
  mockSelected = 'chats';
  mockNavigation.addListener.mockClear();
  mockListeners.clear();
});

it('keeps primary search active beside a focused detail, then cancels on tab change', () => {
  const onCancel = jest.fn();
  function Search() {
    return <SearchTransition active focused={usePrimaryPaneFocused()} onActivate={() => {}} onCancel={onCancel}
      activeContent={<View testID="search-results" />}><View /></SearchTransition>;
  }
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<Search />); });
  expect(renderer.root.findByType(SearchTransition).props.focused).toBe(true);
  expect(onCancel).not.toHaveBeenCalled();
  act(() => {
    mockSelected = 'contacts';
    mockListeners.forEach(listener => listener());
  });
  expect(renderer.root.findByType(SearchTransition).props.focused).toBe(false);
  expect(onCancel).toHaveBeenCalledTimes(1);
  act(() => { renderer.unmount(); });
  expect(mockListeners.size).toBe(0);
});

it('uses ordinary route focus in a compact layout and updates when resized', () => {
  let value = false;
  function Probe() { value = usePrimaryPaneFocused(); return null; }
  mockWide = false;
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<Probe />); });
  expect(value).toBe(false);
  expect(mockNavigation.addListener).not.toHaveBeenCalled();
  mockFocused = true;
  act(() => { renderer.update(<Probe />); });
  expect(value).toBe(true);
  mockFocused = false;
  mockWide = true;
  act(() => { renderer.update(<Probe />); });
  expect(value).toBe(true);
  mockWide = false;
  act(() => { renderer.update(<Probe />); });
  expect(value).toBe(false);
  expect(mockListeners.size).toBe(0);
  act(() => { renderer.unmount(); });
});
