import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AppInput } from '../AppInput';
import { InputDialog } from '../InputDialog';
import { AppButton } from '../AppButton';
import { ContextMenuOverlay } from '../ContextMenu';
import { DesktopTimeOfDayPicker } from '../DesktopTimeOfDayPicker';

jest.mock('react-native/Libraries/Components/View/View', () => ({ default: 'View' }));
jest.mock('lucide-react-native/icons/check', () => () => null);
jest.mock('lucide-react-native/icons/chevron-down', () => () => null);
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/i18n', () => ({ language: 'en' }));
jest.mock('@/theme', () => ({ spacing: { xs: 4, sm: 8, md: 12, '3xl': 48 }, radius: { lg: 12 }, uiDensity: { inputHeight: 40 }, useThemeColors: () => ({}) }));
jest.mock('../AppText', () => ({ AppText: () => null }));
jest.mock('../AppButton', () => ({ AppButton: () => null }));
jest.mock('../ContextMenu', () => ({ ContextMenuOverlay: () => null }));
jest.mock('../use-focused-overlay-dismiss', () => ({ useFocusedOverlayDismiss: jest.fn() }));
jest.mock('../AppInput', () => ({ AppInput: () => null }));
jest.mock('../InputDialog', () => ({ InputDialog: ({ children, overlay }: { children: React.ReactNode; overlay: React.ReactNode }) => <>{children}{overlay}</> }));

let renderer: ReactTestRenderer;
const save = jest.fn();
const close = jest.fn();
function mount(initialMinutes: number, is24Hour = false, locale = 'en-US') {
  act(() => { renderer = create(<DesktopTimeOfDayPicker title="Time" initialMinutes={initialMinutes} is24Hour={is24Hour} locale={locale} onClose={close} onConfirm={save} />, { createNodeMock: () => ({ measureInWindow: (callback: (...args: number[]) => void) => callback(10, 20, 60, 28) }) }); });
}
const field = (label: string) => renderer.root.findAllByType(AppInput).find(node => node.props.accessibilityLabel === label)!;
const dialog = () => renderer.root.findByType(InputDialog);
afterEach(() => { act(() => renderer?.unmount()); jest.clearAllMocks(); });

it.each([[0, '12', 'am'], [720, '12', 'pm'], [1380, '11', 'pm']] as const)('seeds %s minutes as %s %s without typed period text', (minutes, hour, period) => {
  mount(minutes);
  expect(field('date_time.hour').props.value).toBe(hour);
  expect(field('date_time.minute').props.value).toBe('00');
  expect(field('date_time.hour').props.tabIndex).toBe(0);
  expect(field('date_time.minute').props.tabIndex).toBe(0);
  expect(renderer.root.findByType(AppButton).props.label).toBe(period.toUpperCase());
  act(() => { dialog().props.onConfirm(); });
  expect(save).toHaveBeenCalledWith(minutes);
});

it('confirms a freshly selected day period immediately and pads a single-digit minute', () => {
  mount(11 * 60);
  act(() => { field('date_time.minute').props.onChangeText('5'); });
  act(() => { renderer.root.findByType(AppButton).props.onPress(); });
  act(() => { renderer.root.findByType(ContextMenuOverlay).props.items.find((item: { key: string }) => item.key === 'pm').onPress(); });
  act(() => { dialog().props.onConfirm(); });
  expect(save).toHaveBeenCalledWith(23 * 60 + 5);
  expect(close).toHaveBeenCalledTimes(1);
});

it('rejects invalid or empty fields without clamping the saved time', () => {
  mount(660);
  act(() => { field('date_time.hour').props.onChangeText('13'); });
  expect(dialog().props.confirmDisabled).toBe(true);
  act(() => { dialog().props.onConfirm(); });
  expect(save).not.toHaveBeenCalled();
  act(() => { field('date_time.hour').props.onChangeText(''); });
  expect(dialog().props.confirmDisabled).toBe(true);
  act(() => { field('date_time.hour').props.onChangeText('12'); field('date_time.minute').props.onChangeText('60'); });
  expect(dialog().props.confirmDisabled).toBe(true);
});

it('rolls the period at noon when using the minute arrow key', () => {
  mount(11 * 60 + 59);
  const preventDefault = jest.fn();
  act(() => { field('date_time.minute').props.onKeyPress({ nativeEvent: { key: 'ArrowUp' }, preventDefault }); });
  expect(preventDefault).toHaveBeenCalled();
  expect(renderer.root.findByType(AppButton).props.label).toBe('PM');
  expect(field('date_time.hour').props.value).toBe('12');
  act(() => { dialog().props.onConfirm(); });
  expect(save).toHaveBeenCalledWith(720);
});

it('uses 24-hour fields without a day-period selector and wraps at midnight', () => {
  mount(1439, true);
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
  act(() => { field('date_time.minute').props.onKeyPress({ nativeEvent: { key: 'ArrowUp' }, preventDefault: jest.fn() }); });
  expect(field('date_time.hour').props.value).toBe('00');
  act(() => { dialog().props.onConfirm(); });
  expect(save).toHaveBeenCalledWith(0);
});

it('preserves the edited wall time when the clock mode changes while open', () => {
  mount(1380, true);
  act(() => { field('date_time.minute').props.onChangeText('15'); });
  act(() => { renderer.update(<DesktopTimeOfDayPicker title="Time" initialMinutes={1380} is24Hour={false} locale="en-US" onClose={close} onConfirm={save} />); });
  expect(field('date_time.hour').props.value).toBe('11');
  expect(renderer.root.findByType(AppButton).props.label).toBe('PM');
  act(() => { dialog().props.onConfirm(); });
  expect(save).toHaveBeenCalledWith(1395);
});

it('localizes day-period choices and leaves saved values untouched on cancel', () => {
  mount(660, false, 'zh-CN');
  expect(renderer.root.findByType(AppButton).props.label).toBe('上午');
  act(() => { renderer.root.findByType(AppButton).props.onPress(); });
  expect(renderer.root.findByType(ContextMenuOverlay).props.items.map((item: { title: string }) => item.title)).toEqual(['上午', '下午']);
  act(() => { field('date_time.hour').props.onChangeText('9'); });
  act(() => { dialog().props.onClose(); });
  expect(save).not.toHaveBeenCalled();
});
