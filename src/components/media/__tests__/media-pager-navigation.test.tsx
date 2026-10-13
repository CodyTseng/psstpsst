/** @jest-environment jsdom */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { IconButton } from '@/components/common/IconButton';
import { MediaPagerNavigation } from '../MediaPagerNavigation';

let mockElectron = true;
let mockRTL = false;
let mockForeground = 'light-overlay-foreground';
jest.mock('@/lib/platform', () => ({ get IS_ELECTRON() { return mockElectron; } }));
jest.mock('@/i18n/direction', () => ({ useIsRTL: () => mockRTL }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({
  useThemeColors: () => ({ onOverlay: mockForeground }),
  spacing: { lg: 16 }, uiDensity: { headerActionSize: 40, headerActionIconSize: 20 },
}));
jest.mock('@/components/common/IconButton', () => ({ IconButton: () => null }));
jest.mock('lucide-react-native/icons/chevron-left', () => ({ __esModule: true, default: () => null }));
jest.mock('lucide-react-native/icons/chevron-right', () => ({ __esModule: true, default: () => null }));

const onPage = jest.fn();
let renderer: ReactTestRenderer | undefined;
function render(props: Partial<Parameters<typeof MediaPagerNavigation>[0]> = {}) {
  act(() => {
    const element = <MediaPagerNavigation hasPrevious hasNext disabled={false} onPage={onPage} {...props} />;
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
}
function key(key: string, target: EventTarget = document, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  act(() => { target.dispatchEvent(event); });
  return event;
}
beforeEach(() => {
  jest.clearAllMocks(); mockElectron = true; mockRTL = false; mockForeground = 'light-overlay-foreground';
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  document.body.innerHTML = '';
});

it('shows only available directions and sends pointer navigation steps', () => {
  render({ hasPrevious: false });
  const buttons = renderer!.root.findAllByType(IconButton);
  expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual(['media.next']);
  act(() => { buttons[0].props.onPress(); });
  expect(onPage).toHaveBeenLastCalledWith(1);
  render({ hasNext: false });
  act(() => { renderer!.root.findByType(IconButton).props.onPress(); });
  expect(onPage).toHaveBeenLastCalledWith(-1);
  render({ hasPrevious: false, hasNext: false });
  expect(renderer!.root.findAllByType(IconButton)).toHaveLength(0);
});

it('handles both arrow keys, blocks scrolling at boundaries, and uses updated availability', () => {
  render();
  expect(key('ArrowLeft').defaultPrevented).toBe(true);
  expect(onPage).toHaveBeenLastCalledWith(-1);
  key('ArrowRight');
  expect(onPage).toHaveBeenLastCalledWith(1);
  onPage.mockClear();
  render({ hasPrevious: false, hasNext: false });
  expect(key('ArrowLeft').defaultPrevented).toBe(true);
  expect(key('ArrowRight').defaultPrevented).toBe(true);
  expect(onPage).not.toHaveBeenCalled();
});

it('disables pointer and keyboard paging while zoomed, loading, or closing', () => {
  render({ disabled: true });
  expect(renderer!.root.findAllByType(IconButton).every((button) => button.props.disabled)).toBe(true);
  key('ArrowLeft'); key('ArrowRight');
  expect(onPage).not.toHaveBeenCalled();
});

it('preserves text editing, dialogs, modified shortcuts, and unrelated keys', () => {
  render();
  for (const markup of ['<input>', '<textarea></textarea>', '<select></select>',
    '<div contenteditable="true"><span></span></div>', '<div role="dialog"><button></button></div>',
    '<div role="menu"><button></button></div>']) {
    document.body.innerHTML = markup;
    expect(key('ArrowLeft', document.body.firstElementChild!.lastElementChild ?? document.body.firstElementChild!).defaultPrevented).toBe(false);
  }
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
    expect(key('ArrowRight', document, { [modifier]: true }).defaultPrevented).toBe(false);
  }
  expect(key('Escape').defaultPrevented).toBe(false);
  expect(onPage).not.toHaveBeenCalled();
});

it('prioritizes media paging over seeking when native video controls have focus', () => {
  render();
  const video = document.createElement('video');
  video.controls = true;
  video.tabIndex = 0;
  document.body.appendChild(video);
  video.focus();
  expect(document.activeElement).toBe(video);
  const seek = jest.fn();
  video.addEventListener('keydown', seek);
  expect(key('ArrowRight', video).defaultPrevented).toBe(true);
  expect(key('ArrowLeft', video).defaultPrevented).toBe(true);
  expect(onPage.mock.calls).toEqual([[1], [-1]]);
  expect(seek).not.toHaveBeenCalled();
  render({ hasPrevious: false, hasNext: false });
  expect(key('ArrowRight', video).defaultPrevented).toBe(true);
  expect(seek).not.toHaveBeenCalled();
});

it('mirrors the arrow icons and keyboard direction for RTL', () => {
  render();
  const leftIcon = renderer!.root.findAllByType(IconButton)[0].props.icon.type;
  const rightIcon = renderer!.root.findAllByType(IconButton)[1].props.icon.type;
  mockRTL = true; render();
  expect(renderer!.root.findAllByType(IconButton).map((button) => button.props.icon.type)).toEqual([rightIcon, leftIcon]);
  key('ArrowLeft'); expect(onPage).toHaveBeenLastCalledWith(1);
  key('ArrowRight'); expect(onPage).toHaveBeenLastCalledWith(-1);
});

it.each(['light-overlay-foreground', 'dark-overlay-foreground'])('uses shared media styling in %s', (foreground) => {
  mockForeground = foreground; render();
  for (const button of renderer!.root.findAllByType(IconButton)) {
    expect(button.props.variant).toBe('overlay');
    expect(button.props.icon.props.color).toBe(foreground);
  }
});

it('removes the keyboard listener on close and provides no navigation on mobile', () => {
  render();
  act(() => renderer!.unmount());
  expect(key('ArrowRight').defaultPrevented).toBe(false);
  mockElectron = false;
  act(() => { renderer = create(<MediaPagerNavigation hasPrevious hasNext disabled={false} onPage={onPage} />); });
  expect(renderer!.toJSON()).toBeNull();
  expect(key('ArrowRight').defaultPrevented).toBe(false);
  expect(onPage).not.toHaveBeenCalled();
});
