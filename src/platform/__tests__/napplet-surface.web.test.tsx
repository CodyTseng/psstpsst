import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { NappletSurface } from '../napplet-surface.web';
import { platform } from '../index';

jest.mock('../index', () => ({ platform: { napplet: { capture: jest.fn(), setBounds: jest.fn(async () => {}) } } }));
jest.mock('react-native', () => {
  const React = jest.requireActual('react');
  const descriptors = Object.getOwnPropertyDescriptors(jest.requireActual('react-native'));
  delete descriptors.View; delete descriptors.Image; delete descriptors.StyleSheet;
  return Object.defineProperties({
    View: React.forwardRef(function View(props: { children?: React.ReactNode }, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ measureInWindow: (cb: (...bounds: number[]) => void) => cb(0, 0, 300, 400) }), []);
      return React.createElement('View', props, props.children);
    }),
    Image: 'Image', StyleSheet: { absoluteFill: { position: 'absolute', inset: 0 } },
  }, descriptors);
});

const uri = 'data:image/png;base64,preview';
const frames: FrameRequestCallback[] = [];
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
beforeEach(() => {
  jest.clearAllMocks(); frames.length = 0;
  jest.mocked(platform.napplet.capture).mockResolvedValue(uri);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener: jest.fn(), removeEventListener: jest.fn() } });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (cb: FrameRequestCallback) => frames.push(cb) });
});
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (originalAnimationFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', originalAnimationFrame);
  else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
});

it('paints the preview before hiding the elevated view and restores the live view before clearing it', async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<NappletSurface id="app" visible />); });
  await act(async () => { renderer.update(<NappletSurface id="app" visible obscured />); });
  expect(platform.napplet.capture).toHaveBeenCalledTimes(1);
  expect(jest.mocked(platform.napplet.setBounds).mock.calls.every(([, , visible]) => visible)).toBe(true);
  expect(jest.mocked(platform.napplet.setBounds).mock.calls.at(-1)![3]).toBe(false);
  const image = renderer.root.findByProps({ resizeMode: 'stretch' });
  act(() => { image.props.onLoad(); });
  act(() => { frames.shift()!(0); });
  expect(jest.mocked(platform.napplet.setBounds).mock.calls.at(-1)![2]).toBe(true);
  await act(async () => { frames.shift()!(0); });
  expect(jest.mocked(platform.napplet.setBounds).mock.calls.at(-1)![2]).toBe(false);
  let restored!: () => void;
  jest.mocked(platform.napplet.setBounds).mockImplementationOnce(() => new Promise<void>((resolve) => { restored = resolve; }));
  act(() => { renderer.update(<NappletSurface id="app" visible />); });
  expect(renderer.root.findByProps({ resizeMode: 'stretch' })).toBeDefined();
  await act(async () => { restored(); });
  expect(renderer.root.findAllByProps({ resizeMode: 'stretch' })).toHaveLength(0);
  act(() => renderer.unmount());
});

it('discards a late preview from a previous container', async () => {
  let finish!: (uri: string) => void;
  jest.mocked(platform.napplet.capture).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<NappletSurface id="old" visible obscured />); });
  await act(async () => { renderer.update(<NappletSurface id="new" visible />); finish(uri); });
  expect(renderer.root.findAllByProps({ resizeMode: 'stretch' })).toHaveLength(0);
  expect(jest.mocked(platform.napplet.setBounds).mock.calls.at(-1)![0]).toBe('new');
  act(() => renderer.unmount());
});

it('retains a fresh preview when a sheet reopens before the live-view acknowledgement arrives', async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<NappletSurface id="app" visible obscured />); });
  const original = renderer.root.findByProps({ resizeMode: 'stretch' });
  let restored!: () => void;
  jest.mocked(platform.napplet.setBounds).mockImplementationOnce(() => new Promise<void>((resolve) => { restored = resolve; }));
  act(() => { renderer.update(<NappletSurface id="app" visible />); });
  await act(async () => { renderer.update(<NappletSurface id="app" visible obscured />); });
  const replacement = renderer.root.findByProps({ resizeMode: 'stretch' });
  expect(replacement).not.toBe(original);
  await act(async () => { restored(); });
  expect(renderer.root.findByProps({ resizeMode: 'stretch' })).toBe(replacement);
  act(() => { replacement.props.onLoad(); frames.shift()!(0); });
  await act(async () => { frames.shift()!(0); });
  expect(jest.mocked(platform.napplet.setBounds).mock.calls.at(-1)![2]).toBe(false);
  act(() => renderer.unmount());
});

it('keeps host overlays accessible when a preview cannot be captured', async () => {
  jest.mocked(platform.napplet.capture).mockRejectedValueOnce(new Error('capture unavailable'));
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<NappletSurface id="app" visible obscured />); });
  expect(renderer.root.findAllByProps({ resizeMode: 'stretch' })).toHaveLength(0);
  expect(jest.mocked(platform.napplet.setBounds).mock.calls.at(-1)![2]).toBe(false);
  act(() => renderer.unmount());
});
