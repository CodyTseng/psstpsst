import * as ImagePicker from 'expo-image-picker';
import { createStore } from 'zustand/vanilla';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { IconButton } from '@/components/common/IconButton';
import { AppText } from '@/components/common/AppText';
import { ChatWallpaperSettings } from '@/components/settings/chat-wallpaper-settings';
import {
  addWallpaperImage, deleteWallpaperImage, saveWallpaper, wallpaperLibraryStore, type WallpaperState,
} from '@/services/preferences/chat-wallpaper.service';
import { platform } from '@/platform';
import * as platformFlags from '@/lib/platform';
import { darkPalette, lightPalette } from '@/theme';

const mockTranslate = (key: string) => key;
let mockScheme: 'light' | 'dark' = 'light';
let mockLocal: WallpaperState;
const mockLocalStore = createStore<WallpaperState>(() => ({
  value: null, uri: null, loaded: true, error: false, saving: false,
}));
const mockGlobal: WallpaperState = {
  value: { kind: 'image', fileName: 'global.jpg' }, uri: 'file:///global.jpg',
  loaded: true, error: false, saving: false,
};
const scope = { accountPubkey: 'account', conversationKey: 'peer' };

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (select: (state: object) => unknown) => select({ accent: 'blue', preference: mockScheme }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@/hooks/use-chat-wallpaper', () => ({
  useWallpaperPreference: (target?: object) => {
    const local = jest.requireActual('zustand').useStore(mockLocalStore);
    return target ? local : mockGlobal;
  },
  useChatWallpaper: () => null,
}));
jest.mock('@/hooks/use-scrolled', () => ({ useScrolled: () => ({ scrolled: false, scrollProps: {} }) }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: ({ right }: { right?: React.ReactNode }) => right ?? null, useScreenHeaderClearance: () => 48 }));
jest.mock('@/services/preferences/chat-wallpaper.service', () => ({
  saveWallpaper: jest.fn(async () => {}), loadWallpaper: jest.fn(async () => {}),
  addWallpaperImage: jest.fn(async () => {}), deleteWallpaperImage: jest.fn(async () => {}), loadWallpaperLibrary: jest.fn(async () => {}),
  wallpaperLibraryStore: jest.requireActual('zustand/vanilla').createStore(() => ({
    images: [], loaded: true, error: false, adding: false, deleting: null,
  })),
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/lib/platform', () => ({ __esModule: true, ...jest.requireActual('@/lib/platform'), IS_ELECTRON: false }));
jest.mock('lucide-react-native/icons/check', () => () => null, { virtual: true });
jest.mock('lucide-react-native/icons/trash-2', () => () => null, { virtual: true });
jest.mock('lucide-react-native/icons/plus', () => () => null, { virtual: true });
jest.mock('react-native-reanimated', () => ({
  __esModule: true, default: { View: jest.requireActual('react-native').View },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: jest.requireActual('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/platform', () => ({ platform: {
  confirmationDialog: { confirm: jest.fn(async () => true) },
  documentPicker: { pickDocument: jest.fn(async () => null) },
  fileSystem: { delete: jest.fn(async () => {}) },
} }));

let renderer: ReactTestRenderer;
function tile(label: string) { return renderer.root.findAllByType(AppButton).find((node) => node.props.accessibilityLabel === label)!; }
function addButton() { return tile('wallpaper.choose_photo'); }
async function render() {
  await act(async () => { renderer = create(<ChatWallpaperSettings scope={scope} />); });
  act(() => {
    const layout = renderer.root.findAllByType(View).find((node) => node.props.onLayout)!;
    layout.props.onLayout({ nativeEvent: { layout: { width: 400 } } });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(platformFlags, 'IS_ELECTRON', false);
  jest.mocked(platform.fileSystem.delete).mockResolvedValue();
  jest.mocked(platform.documentPicker.pickDocument).mockResolvedValue(null);
  mockLocal = { value: null, uri: null, loaded: true, error: false, saving: false };
  mockLocalStore.setState(mockLocal, true);
  wallpaperLibraryStore.setState({
    images: [{ fileName: 'first.jpg', uri: 'file:///first.jpg' }, { fileName: 'second.jpg', uri: 'file:///second.jpg' }],
    loaded: true, error: false, adding: false, deleting: null,
  });
  jest.mocked(saveWallpaper).mockImplementation(async (_scope, choice) => {
    mockLocalStore.setState({ value: choice === 'none' ? { kind: 'none' } : choice === 'inherit' ? null
      : { kind: 'image', fileName: choice.fileName, library: true } });
  });
  jest.mocked(addWallpaperImage).mockResolvedValue();
  jest.mocked(deleteWallpaperImage).mockResolvedValue();
  jest.mocked(platform.confirmationDialog.confirm).mockResolvedValue(true);
});
afterEach(() => { act(() => renderer?.unmount()); });

it.each(['light', 'dark'] as const)('applies a tile immediately without a save button in %s mode', async (scheme) => {
  mockScheme = scheme;
  await render();
  const palette = scheme === 'dark' ? darkPalette : lightPalette;
  expect(renderer.root.findAllByType(View).map((node) => StyleSheet.flatten(node.props.style)?.backgroundColor))
    .toContain(palette.background);
  expect(tile('wallpaper.inherit').props.accessibilityState.checked).toBe(true);
  await act(async () => { tile('wallpaper.none').props.onPress(); });
  expect(saveWallpaper).toHaveBeenCalledWith(scope, 'none');
  expect(tile('wallpaper.none').props.accessibilityState.checked).toBe(true);
  expect(renderer.root.findAllByType(AppButton).some((node) => node.props.label === 'common.save')).toBe(false);
});

it('keeps all thumbnails available when switching photos and returning to inheritance', async () => {
  await render();
  await act(async () => { tile('wallpaper.custom_photo 1').props.onPress(); });
  await act(async () => { tile('wallpaper.custom_photo 2').props.onPress(); });
  await act(async () => { tile('wallpaper.inherit').props.onPress(); });
  expect(saveWallpaper).toHaveBeenLastCalledWith(scope, 'inherit');
  expect(tile('wallpaper.custom_photo 1')).toBeDefined();
  expect(tile('wallpaper.custom_photo 2')).toBeDefined();
  expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
});

it('adds a photo to the library without changing the selected wallpaper', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false, assets: [{ uri: 'file:///picked.jpg', width: 100, height: 100 }],
  });
  await render();
  expect(renderer.root.findByType(FlatList).props.data.at(-1).id).toBe('add');
  expect(addButton().props.accessibilityRole).toBe('button');
  await act(async () => { addButton().props.onPress(); });
  expect(addWallpaperImage).toHaveBeenCalledWith('file:///picked.jpg');
  expect(platform.fileSystem.delete).not.toHaveBeenCalled();
  expect(saveWallpaper).not.toHaveBeenCalled();
  expect(tile('wallpaper.inherit').props.accessibilityState.checked).toBe(true);
});

it('leaves the selection and library unchanged when the picker is cancelled', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: true, assets: null });
  await render();
  await act(async () => { addButton().props.onPress(); });
  expect(addWallpaperImage).not.toHaveBeenCalled();
  expect(saveWallpaper).not.toHaveBeenCalled();
});

it('shows a failed selection without leaving the gallery and allows retry', async () => {
  jest.mocked(saveWallpaper).mockRejectedValueOnce(new Error('disk full'));
  await render();
  await act(async () => { tile('wallpaper.none').props.onPress(); });
  expect(tile('wallpaper.inherit').props.accessibilityState.checked).toBe(true);
  expect(renderer.root.findAllByType(AppText).some((node) => node.props.children === 'wallpaper.save_failed')).toBe(true);
  await act(async () => { tile('wallpaper.none').props.onPress(); });
  expect(tile('wallpaper.none').props.accessibilityState.checked).toBe(true);
});

it('ignores a second selection while the first write is pending', async () => {
  let finish!: () => void;
  jest.mocked(saveWallpaper).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await render();
  await act(async () => {
    tile('wallpaper.none').props.onPress();
    tile('wallpaper.custom_photo 1').props.onPress();
  });
  expect(saveWallpaper).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
});


it('keeps other artwork at full opacity and mounted during a pending selection', async () => {
  let finish!: () => void;
  jest.mocked(saveWallpaper).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await render();
  const artwork = tile('wallpaper.custom_photo 2').props.iconLeft;
  await act(async () => { tile('wallpaper.custom_photo 1').props.onPress(); });
  expect(tile('wallpaper.custom_photo 1').props.accessibilityState.checked).toBe(true);
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  expect(tile('wallpaper.custom_photo 2').props.disabled).not.toBe(true);
  expect(tile('wallpaper.custom_photo 2').props.iconLeft).toBe(artwork);
  expect(addButton().props.disabled).toBe(false);
  await act(async () => { finish(); });
});

it('exposes deletion only for library images in Edit mode and confirms before deleting', async () => {
  await render();
  expect(renderer.root.findAllByType(IconButton)).toHaveLength(0);
  act(() => { renderer.root.findAllByType(AppButton).find((node) => node.props.label === 'common.edit')!.props.onPress(); });
  expect(renderer.root.findAllByType(IconButton)).toHaveLength(2);
  expect(renderer.root.findAllByType(AppButton).some((node) => node.props.accessibilityLabel === 'wallpaper.choose_photo')).toBe(false);
  await act(async () => { tile('wallpaper.custom_photo 1').props.onPress(); });
  expect(saveWallpaper).not.toHaveBeenCalled();
  await act(async () => { renderer.root.findAllByType(IconButton)[0].props.onPress(); });
  expect(platform.confirmationDialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
  expect(deleteWallpaperImage).toHaveBeenCalledWith('first.jpg');
  act(() => { renderer.root.findAllByType(AppButton).find((node) => node.props.label === 'common.done')!.props.onPress(); });
  expect(renderer.root.findAllByType(IconButton)).toHaveLength(0);
  expect(addButton()).toBeDefined();
});

it('preserves the library when deleting is cancelled or fails', async () => {
  await render();
  act(() => { renderer.root.findAllByType(AppButton).find((node) => node.props.label === 'common.edit')!.props.onPress(); });
  jest.mocked(platform.confirmationDialog.confirm).mockResolvedValueOnce(false);
  await act(async () => { renderer.root.findAllByType(IconButton)[0].props.onPress(); });
  expect(deleteWallpaperImage).not.toHaveBeenCalled();
  jest.mocked(deleteWallpaperImage).mockRejectedValueOnce(new Error('database unavailable'));
  await act(async () => { renderer.root.findAllByType(IconButton)[0].props.onPress(); });
  expect(tile('wallpaper.custom_photo 1')).toBeDefined();
  expect(renderer.root.findAllByType(AppText).some((node) => node.props.children === 'wallpaper.delete_failed')).toBe(true);
});

it.each([false, true])('cleans up the desktop staged source after importing, including failure=%s', async (fails) => {
  jest.replaceProperty(platformFlags, 'IS_ELECTRON', true);
  const uri = 'psstpsst-file://cache/imports/original.heic';
  jest.mocked(platform.documentPicker.pickDocument).mockResolvedValue({ uri, name: 'original.heic' });
  if (fails) jest.mocked(addWallpaperImage).mockRejectedValueOnce(new Error('conversion failed'));
  await render();
  await act(async () => { addButton().props.onPress(); });
  expect(addWallpaperImage).toHaveBeenCalledWith(uri);
  expect(platform.fileSystem.delete).toHaveBeenCalledWith(uri, { idempotent: true });
  expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  expect(addButton().props.disabled).toBe(false);
});

it('keeps the staged source readable until the import has finished', async () => {
  jest.replaceProperty(platformFlags, 'IS_ELECTRON', true);
  const uri = 'psstpsst-file://cache/imports/original.jpg';
  jest.mocked(platform.documentPicker.pickDocument).mockResolvedValue({ uri, name: 'original.jpg' });
  let finish!: () => void;
  jest.mocked(addWallpaperImage).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await render();
  await act(async () => { addButton().props.onPress(); });
  expect(platform.fileSystem.delete).not.toHaveBeenCalled();
  await act(async () => { finish(); });
  expect(platform.fileSystem.delete).toHaveBeenCalledWith(uri, { idempotent: true });
});

it('does not import or delete any file when the desktop picker is cancelled', async () => {
  jest.replaceProperty(platformFlags, 'IS_ELECTRON', true);
  await render();
  await act(async () => { addButton().props.onPress(); });
  expect(addWallpaperImage).not.toHaveBeenCalled();
  expect(platform.fileSystem.delete).not.toHaveBeenCalled();
});

it('releases the import control even when staged-source cleanup fails', async () => {
  jest.replaceProperty(platformFlags, 'IS_ELECTRON', true);
  jest.mocked(platform.documentPicker.pickDocument).mockResolvedValue({ uri: 'psstpsst-file://cache/imports/original.jpg', name: 'original.jpg' });
  jest.mocked(platform.fileSystem.delete).mockRejectedValueOnce(new Error('file busy'));
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await render();
    await act(async () => { addButton().props.onPress(); });
    expect(warning).toHaveBeenCalled();
    expect(addButton().props.disabled).toBe(false);
    expect(renderer.root.findAllByType(AppText).some((node) => node.props.children === 'wallpaper.save_failed')).toBe(false);
  } finally { warning.mockRestore(); }
});
