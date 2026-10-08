import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Slider as IOSSlider } from '@expo/ui/swift-ui';
import { Slider as AndroidSlider } from '@expo/ui/jetpack-compose';

import { MediaSlider as IOSMediaSlider } from '../MediaSlider.ios';
import { MediaSlider as AndroidMediaSlider } from '../MediaSlider.android';

jest.mock('@expo/ui/swift-ui', () => ({ Slider: () => null }));
jest.mock('@expo/ui/swift-ui/modifiers', () => ({ disabled: (value: boolean) => ({ disabled: value }) }));
jest.mock('@expo/ui/jetpack-compose', () => ({ Slider: () => null }));
jest.mock('../MediaSliderHost', () => ({
  MediaSliderHost: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/theme', () => ({ useThemeColors: () => ({ onOverlay: 'white' }) }));

let renderer: ReactTestRenderer;
const change = jest.fn();
const commit = jest.fn();
const start = jest.fn();
beforeEach(() => jest.clearAllMocks());
afterEach(() => act(() => renderer?.unmount()));

it('commits the last iOS slider value only when editing ends', () => {
  act(() => { renderer = create(<IOSMediaSlider value={20} max={100} accessibilityLabel="Seek"
    onSlidingStart={start} onValueChange={change} onSlidingComplete={commit} />); });
  const slider = renderer.root.findByType(IOSSlider);
  act(() => {
    slider.props.onEditingChanged(true);
    slider.props.onValueChange(60);
    slider.props.onValueChange(70);
  });
  expect(change.mock.calls).toEqual([[60], [70]]);
  expect(start).toHaveBeenCalledTimes(1);
  expect(commit).not.toHaveBeenCalled();
  act(() => { slider.props.onEditingChanged(false); });
  expect(commit).toHaveBeenCalledWith(70);
  expect(commit).toHaveBeenCalledTimes(1);
});

it('commits the last Android slider value only when the gesture finishes', () => {
  act(() => { renderer = create(<AndroidMediaSlider value={20} max={100} accessibilityLabel="Seek"
    onSlidingStart={start} onValueChange={change} onSlidingComplete={commit} />); });
  const slider = renderer.root.findByType(AndroidSlider);
  act(() => {
    slider.props.onValueChange(60);
    slider.props.onValueChange(70);
  });
  expect(commit).not.toHaveBeenCalled();
  expect(start).toHaveBeenCalledTimes(1);
  act(() => { slider.props.onValueChangeFinished(); });
  expect(commit).toHaveBeenCalledWith(70);
  expect(commit).toHaveBeenCalledTimes(1);
});
