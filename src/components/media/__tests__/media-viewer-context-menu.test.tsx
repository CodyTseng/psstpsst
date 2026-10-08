import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';

import { ContextMenu } from '@/components/common/ContextMenu';
import { showToast } from '@/stores/toast.store';
import { darkPalette, lightPalette } from '@/theme';
import { MediaViewerContextMenu } from '../MediaViewerContextMenu';

let mockElectron = true;
let mockColors = lightPalette;
jest.mock('@/lib/platform', () => ({
  get IS_ELECTRON() { return mockElectron; },
  desktopContextMenuPoint: (event: { clientX: number; clientY: number }) => ({ x: event.clientX, y: event.clientY }),
}));
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme'), useThemeColors: () => mockColors,
}));
jest.mock('@/components/common/ContextMenu', () => ({
  ContextMenu: () => null, CONTEXT_MENU_ICON_SIZE: { pointer: 16 },
}));
jest.mock('@solar-icons/react-native/category/ui/Linear/Copy', () => ({ Copy: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/download', () => ({ __esModule: true, default: () => null }), { virtual: true });
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/stores/toast.store', () => ({ showToast: jest.fn() }));
let renderer: ReactTestRenderer;
const copy = jest.fn<Promise<void>, []>();
const save = jest.fn<Promise<void>, []>();
const event = () => ({ clientX: 123, clientY: 45, preventDefault: jest.fn(), stopPropagation: jest.fn() });
function render(disabled = false, onCopy: (() => Promise<void>) | null = copy) {
  act(() => { renderer = create(<MediaViewerContextMenu onCopy={onCopy ?? undefined} onSave={save} disabled={disabled}><View /></MediaViewerContextMenu>); });
}
function open() {
  const e = event();
  act(() => { renderer.root.findAllByType(View)[0].props.onContextMenu(e); });
  return e;
}
beforeEach(() => { jest.clearAllMocks(); mockElectron = true; mockColors = lightPalette; copy.mockResolvedValue(undefined); save.mockResolvedValue(undefined); });
afterEach(() => { act(() => renderer?.unmount()); });

it.each([lightPalette, darkPalette])('opens copy/save at the cursor using theme colors', (colors) => {
  mockColors = colors; render(); const e = open();
  expect(e.preventDefault).toHaveBeenCalled(); expect(e.stopPropagation).toHaveBeenCalled();
  const menu = renderer.root.findByType(ContextMenu);
  expect(menu.props.anchor).toEqual({ x: 123, y: 45 });
  expect(menu.props.items.map((item: { key: string }) => item.key)).toEqual(['copy', 'save']);
  expect(menu.props.items[0].icon.props.color).toBe(colors.text);
  act(() => { menu.props.onClose(); });
  expect(renderer.root.findAllByType(ContextMenu)).toHaveLength(0);
});
it('reports successful image copying', async () => {
  render(); open();
  await act(async () => renderer.root.findByType(ContextMenu).props.items[0].onPress());
  expect(copy).toHaveBeenCalledTimes(1); expect(showToast).toHaveBeenCalledWith('common.copied');
});
it('reports copying failures', async () => {
  copy.mockRejectedValue(new Error('Unavailable')); render(); open();
  await act(async () => renderer.root.findByType(ContextMenu).props.items[0].onPress());
  expect(showToast).toHaveBeenCalledWith('attach.copy_failed');
});
it('suppresses the menu while the viewer is busy or closing', () => {
  render(true); open(); expect(renderer.root.findAllByType(ContextMenu)).toHaveLength(0);
});
it('leaves mobile gesture handling intact', () => {
  mockElectron = false; render();
  expect(renderer.root.findAllByType(View)[0].props.onContextMenu).toBeUndefined();
});
it('offers only saving when the current media cannot be copied', () => {
  render(false, null); open();
  expect(renderer.root.findByType(ContextMenu).props.items.map((item: { key: string }) => item.key)).toEqual(['save']);
});

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue' }) => unknown) => selector({ accent: 'blue' }),
}));

it('saves the media whose menu was opened, even if the current page changes', async () => {
  render(); open();
  const nextSave = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  act(() => { renderer.update(<MediaViewerContextMenu onCopy={copy} onSave={nextSave}><View /></MediaViewerContextMenu>); });
  await act(async () => renderer.root.findByType(ContextMenu).props.items[1].onPress());
  expect(save).toHaveBeenCalledTimes(1);
  expect(nextSave).not.toHaveBeenCalled();
});
