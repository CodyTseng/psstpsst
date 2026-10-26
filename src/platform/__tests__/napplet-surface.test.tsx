import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { NappletSurface } from '../napplet-surface';

const mockSurface = { html: '<main>App</main>', ready: true };
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireNativeViewManager: () => 'NappletNativeView',
}));
jest.mock('../expo/napplet', () => ({ nativeSurface: { get: () => mockSurface, subscribe: () => () => {}, message: jest.fn() } }));
jest.mock('@/theme', () => ({ useThemeColors: () => ({ background: 'host-background' }) }));

it('retains the painted mobile page beneath native modals while blocking input', () => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NappletSurface id="app" visible />); });
  const surface = renderer.root.findByProps({ surfaceId: 'app' });
  expect(surface.props.style.opacity).toBe(1);
  expect(surface.props.pointerEvents).toBe('auto');
  act(() => { renderer.update(<NappletSurface id="app" visible obscured />); });
  expect(surface.props.style.opacity).toBe(1);
  expect(surface.props.pointerEvents).toBe('none');
  act(() => { renderer.update(<NappletSurface id="app" visible />); });
  expect(surface.props.style.opacity).toBe(1);
  expect(surface.props.pointerEvents).toBe('auto');
  act(() => { renderer.update(<NappletSurface id="app" visible={false} />); });
  expect(surface.props.style.opacity).toBe(0);
  expect(surface.props.pointerEvents).toBe('none');
  act(() => renderer.unmount());
});
