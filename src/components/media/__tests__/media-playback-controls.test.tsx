import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { VideoPlayer } from 'expo-video';
import { StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { IconButton } from '@/components/common/IconButton';
import { MediaSlider } from '../MediaSlider';
import { MediaPlaybackControls } from '../MediaPlaybackControls';

const mockListeners = new Map<string, (event: Record<string, number>) => void>();
jest.mock('expo', () => ({
  useEvent: (_player: unknown, _name: string, initial: unknown) => initial,
  useEventListener: (_player: unknown, name: string, listener: (event: Record<string, number>) => void) => {
    const React = jest.requireActual('react') as typeof import('react');
    React.useEffect(() => {
      mockListeners.set(name, listener);
      return () => { mockListeners.delete(name); };
    }, [name, listener]);
  },
}));
jest.mock('../MediaSlider', () => ({ MediaSlider: () => null }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/components/common/IconButton', () => ({ IconButton: () => null }));
jest.mock('@/components/common/AppText', () => ({ AppText: jest.requireActual('react-native').Text }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, values?: { speed?: number }) => values ? `${key}:${values.speed}` : key }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 44, right: 0 }),
}));
let mockDark = false;
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue'; preference: 'light' | 'dark' }) => unknown) =>
    selector({ accent: 'blue', preference: mockDark ? 'dark' : 'light' }),
}));
jest.mock('@/theme', () => {
  const actual = jest.requireActual('@/theme');
  return { ...actual, useThemeColors: () => mockDark ? actual.darkPalette : actual.lightPalette };
});
jest.mock('lucide-react-native/icons/play', () => ({ __esModule: true, default: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/pause', () => ({ __esModule: true, default: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/volume-2', () => ({ __esModule: true, default: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/volume-x', () => ({ __esModule: true, default: () => null }), { virtual: true });

let renderer: ReactTestRenderer;
let position: number;
let applySeekImmediately: boolean;
const seek = jest.fn();
const player = {
  playing: false, duration: 100, isLive: false, volume: 0.8, muted: false,
  playbackRate: 1, status: 'readyToPlay', scrubbingModeOptions: { scrubbingModeEnabled: false },
  replay: jest.fn(() => { position = 0; player.playing = true; }),
  get currentTime() { return position; },
  set currentTime(value: number) { if (applySeekImmediately) position = value; seek(value); },
  play: jest.fn(() => { player.playing = true; }),
  pause: jest.fn(() => { player.playing = false; }),
};
const element = () => <MediaPlaybackControls player={player as unknown as VideoPlayer} />;
function mount() { act(() => { renderer = create(element()); }); }
function press(label: string) {
  act(() => { renderer.root.findAllByType(IconButton).find((button) => button.props.accessibilityLabel === label)!.props.onPress(); });
}
const progress = () => renderer.root.findAllByType(MediaSlider)[0];
beforeEach(() => {
  jest.clearAllMocks();
  mockListeners.clear();
  mockDark = false;
  position = 10;
  applySeekImmediately = true;
  Object.assign(player, { playing: false, duration: 100, isLive: false, volume: 0.8, muted: false, playbackRate: 1, status: 'readyToPlay', scrubbingModeOptions: { scrubbingModeEnabled: false } });
});
afterEach(() => act(() => renderer?.unmount()));

it('plays, pauses, and restarts an ended clip', () => {
  mount();
  press('voice.play');
  expect(player.play).toHaveBeenCalledTimes(1);
  act(() => renderer.update(element()));
  press('voice.pause');
  expect(player.pause).toHaveBeenCalledTimes(1);
  position = 99.95;
  player.status = 'idle';
  act(() => mockListeners.get('playToEnd')!({}));
  act(() => renderer.update(element()));
  expect(renderer.root.findAllByType(IconButton)[0].props.disabled).toBe(false);
  press('voice.play');
  expect(player.replay).toHaveBeenCalledTimes(1);
});

it('previews video frames while keeping competing playback ticks away from the thumb', () => {
  mount();
  act(() => { progress().props.onValueChange(60); });
  expect(seek).toHaveBeenCalledWith(60);
  expect(player.scrubbingModeOptions.scrubbingModeEnabled).toBe(true);
  act(() => mockListeners.get('timeUpdate')!({ currentTime: 12 }));
  expect(progress().props.value).toBe(60);
  act(() => { progress().props.onSlidingComplete(60); });
  expect(seek).toHaveBeenCalledTimes(2);
  expect(player.scrubbingModeOptions.scrubbingModeEnabled).toBe(false);
  expect(seek).toHaveBeenCalledWith(60);
  act(() => mockListeners.get('timeUpdate')!({ currentTime: 61 }));
  expect(progress().props.value).toBe(61);
  expect(player.play).not.toHaveBeenCalled();
});

it('pauses before scrubbing and resumes only after an asynchronous seek reaches its target', () => {
  player.playing = true;
  applySeekImmediately = false;
  mount();
  act(() => { progress().props.onSlidingStart(); });
  expect(player.pause).toHaveBeenCalledTimes(1);
  expect(player.playing).toBe(false);
  act(() => mockListeners.get('timeUpdate')!({ currentTime: 11 }));
  expect(progress().props.value).toBe(10);
  act(() => {
    progress().props.onValueChange(60);
    progress().props.onSlidingComplete(60);
  });
  expect(player.play).not.toHaveBeenCalled();
  act(() => mockListeners.get('timeUpdate')!({ currentTime: 12 }));
  expect(progress().props.value).toBe(60);
  act(() => mockListeners.get('timeUpdate')!({ currentTime: 60 }));
  expect(player.play).toHaveBeenCalledTimes(1);
  expect(progress().props.value).toBe(60);
});

it('keeps playback intent when a second scrub overtakes an unfinished seek', () => {
  player.playing = true;
  applySeekImmediately = false;
  mount();
  act(() => {
    progress().props.onSlidingStart();
    progress().props.onValueChange(60);
    progress().props.onSlidingComplete(60);
  });
  act(() => {
    progress().props.onSlidingStart();
    progress().props.onValueChange(80);
  });
  act(() => mockListeners.get('timeUpdate')!({ currentTime: 60 }));
  expect(player.play).not.toHaveBeenCalled();
  expect(progress().props.value).toBe(80);
  act(() => { progress().props.onSlidingComplete(80); });
  act(() => mockListeners.get('timeUpdate')!({ currentTime: 80 }));
  expect(player.play).toHaveBeenCalledTimes(1);
});

it('enables progress after the source loads and clamps the committed seek', () => {
  player.duration = 0;
  mount();
  expect(progress().props.disabled).toBe(true);
  act(() => mockListeners.get('sourceLoad')!({ duration: 100 }));
  expect(progress().props.disabled).toBe(false);
  act(() => { progress().props.onSlidingComplete(150); });
  expect(seek).toHaveBeenCalledWith(100);
});

it.each([0, Infinity])('disables seeking for unknown duration %s', (duration) => {
  player.duration = duration;
  mount();
  expect(progress().props.disabled).toBe(true);
  act(() => { progress().props.onSlidingComplete(50); });
  expect(seek).not.toHaveBeenCalled();
});

it('keeps live streams unseekable', () => {
  player.isLive = true;
  mount();
  expect(progress().props.disabled).toBe(true);
});

it('cycles all playback rates while preserving the player', () => {
  mount();
  for (const next of [1.25, 1.5, 2, 0.5, 1]) {
    act(() => { renderer.root.findByType(AppButton).props.onPress(); });
    expect(player.playbackRate).toBe(next);
    act(() => renderer.update(element()));
    expect(renderer.root.findByType(AppButton).props.label).toBe(`media.speed_value:${next}`);
  }
});

it('toggles mute directly without a volume slider', () => {
  mount();
  expect(renderer.root.findAllByType(MediaSlider)).toHaveLength(1);
  press('media.mute');
  expect(player.muted).toBe(true);
  act(() => renderer.update(element()));
  press('media.unmute');
  expect(player.muted).toBe(false);
  expect(player.volume).toBe(0.8);
  expect(renderer.root.findAllByType(MediaSlider)).toHaveLength(1);
});

it.each([false, true])('keeps overlay controls readable and inside safe areas (dark=%s)', (dark) => {
  mockDark = dark;
  mount();
  const panel = StyleSheet.flatten(renderer.root.findAllByType(View)[0].props.style);
  expect(panel).toMatchObject({ start: 60, end: 60, bottom: 42 });
  expect(panel.backgroundColor).toBeUndefined();
  expect(renderer.root.findByType(AppButton).props.variant).toBe('overlay');
  const buttons = renderer.root.findAllByType(IconButton);
  expect(buttons.every((button) => button.props.size === renderer.root.findByType(AppButton).props.minimumSize)).toBe(true);
  expect(renderer.root.findAllByType(IconButton).every((button) => button.props.variant === 'overlay')).toBe(true);
});

it('allows seeking an ended Android clip and keeps seeking enabled while buffering', () => {
  player.status = 'idle';
  mount();
  expect(progress().props.disabled).toBe(false);
  act(() => { progress().props.onSlidingStart(); });
  player.status = 'loading';
  act(() => renderer.update(element()));
  expect(progress().props.disabled).toBe(false);
  act(() => { progress().props.onValueChange(40); progress().props.onSlidingComplete(40); });
  expect(seek).toHaveBeenLastCalledWith(40);
  expect(player.scrubbingModeOptions.scrubbingModeEnabled).toBe(false);
});
