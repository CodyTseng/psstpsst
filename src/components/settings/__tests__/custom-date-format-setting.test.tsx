import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AppInput } from '@/components/common/AppInput';
import { AppText } from '@/components/common/AppText';
import { InputDialog } from '@/components/common/InputDialog';
import { BottomSheet } from '@/components/common/BottomSheet';
import { ListRow } from '@/components/common/ListRow';
import { setDateTimePreferences } from '@/services/preferences/date-time-preferences';
import { CustomDateFormatSetting } from '../CustomDateFormatSetting';

let mockElectron = true;
jest.mock('@/lib/platform', () => ({ get IS_ELECTRON() { return mockElectron; } }));
jest.mock('@/services/preferences/date-time-preferences', () => ({ setDateTimePreferences: jest.fn(async () => {}) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: { date?: string }) => values?.date ?? key }) }));
jest.mock('@/theme', () => ({ spacing: { lg: 16 } }));
jest.mock('@/components/common/AppInput', () => ({ AppInput: () => null }));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/components/common/ListRow', () => ({ ListRow: () => null }));
jest.mock('@/components/common/radio-indicator', () => ({ RadioIndicator: () => null }));
jest.mock('@/components/common/ActionRow', () => ({ ActionRow: () => null }));
jest.mock('@/components/common/InputDialog', () => ({ InputDialog: ({ children }: { children: unknown }) => children }));
jest.mock('@/components/common/BottomSheet', () => ({ BottomSheet: ({ children }: { children: unknown }) => children }));

let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer.unmount()); jest.clearAllMocks(); });

it.each([true, false])('previews drafts locally and saves atomically (desktop: %s)', electron => {
  mockElectron = electron;
  act(() => { renderer = create(<CustomDateFormatSetting selected={false} pattern="YYYY/MM/DD" />); });
  const row = renderer.root.findByType(ListRow);
  act(() => { row.props.onPress(); });
  act(() => { renderer.root.findByType(AppInput).props.onChangeText('D.M.YYYY'); });
  expect(setDateTimePreferences).not.toHaveBeenCalled();
  expect(renderer.root.findByType(AppText).props.children).toBe('5.1.2026');
  act(() => { renderer.root.findByType(AppInput).props.onSubmitEditing(); });
  expect(setDateTimePreferences).toHaveBeenCalledWith({ dateFormat: 'custom', customDateFormat: 'D.M.YYYY' });
  expect(renderer.root.findByType(electron ? InputDialog : BottomSheet).props.visible).toBe(false);
});

it('rejects invalid drafts and discards canceled edits when reopened', () => {
  mockElectron = true;
  act(() => { renderer = create(<CustomDateFormatSetting selected pattern="YYYY/MM/DD" />); });
  act(() => { renderer.root.findByType(ListRow).props.onPress(); });
  act(() => { renderer.root.findByType(AppInput).props.onChangeText('YYYY/MM'); });
  act(() => { renderer.root.findByType(AppInput).props.onSubmitEditing(); });
  expect(renderer.root.findByType(AppInput).props.error).toBe('date_time.custom_invalid');
  expect(renderer.root.findByType(InputDialog).props.visible).toBe(true);
  expect(setDateTimePreferences).not.toHaveBeenCalled();
  act(() => { renderer.root.findByType(InputDialog).props.onClose(); });
  act(() => { renderer.root.findByType(ListRow).props.onPress(); });
  expect(renderer.root.findByType(AppInput).props.value).toBe('YYYY/MM/DD');
  expect(renderer.root.findByType(AppInput).props.error).toBeUndefined();
});
