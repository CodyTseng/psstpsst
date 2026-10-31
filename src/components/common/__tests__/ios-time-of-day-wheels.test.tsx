import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { HStack, Picker, Text } from '@expo/ui/swift-ui';

import { IOSTimeOfDayWheels } from '../IOSTimeOfDayWheels';

jest.mock('@expo/ui/swift-ui', () => ({
  HStack: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Picker: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Text: () => null,
}));
jest.mock('@expo/ui/swift-ui/modifiers', () => ({
  pickerStyle: (value: string) => ({ style: value }), labelsHidden: () => ({}),
  frame: (value: unknown) => value, clipped: () => ({}),
  contentShape: () => ({}), shapes: { rectangle: () => ({}) },
  tag: (value: number) => ({ tag: value }), accessibilityLabel: (value: string) => ({ label: value }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ spacing: { '3xl': 48, '2xl': 32 } }));

let renderer: ReactTestRenderer;
function Harness({ initial, is24Hour = false, locale = 'en-US' }: { initial: number; is24Hour?: boolean; locale?: string }) {
  const [minutes, setMinutes] = useState(initial);
  return <IOSTimeOfDayWheels minutes={minutes} is24Hour={is24Hour} locale={locale} onChange={setMinutes} />;
}
function mount(initial: number, is24Hour = false, locale = 'en-US') {
  act(() => { renderer = create(<Harness initial={initial} is24Hour={is24Hour} locale={locale} />); });
}
const wheels = () => renderer.root.findAllByType(Picker);
const hour = () => wheels().find(node => node.props.label === 'date_time.hour')!;
const minute = () => wheels().find(node => node.props.label === 'date_time.minute')!;
const period = () => wheels().find(node => !['date_time.hour', 'date_time.minute'].includes(node.props.label))!;
const value = () => renderer.root.findByType(IOSTimeOfDayWheels).props.minutes;
afterEach(() => { act(() => renderer?.unmount()); });

it.each([[0, 12, 0], [720, 12, 1], [1439, 11, 1]])('represents %s minutes in explicit 12-hour wheels', (initial, selectedHour, selectedPeriod) => {
  mount(initial);
  expect(hour().props.selection).toBe(selectedHour);
  expect(period().props.selection).toBe(selectedPeriod);
  expect(hour().findAllByType(Text).map(node => node.props.modifiers[0].tag)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
});

it('exposes exactly 00–23 and 00–59 without a day-period wheel in 24-hour mode', () => {
  mount(1439, true);
  expect(wheels()).toHaveLength(2);
  expect(hour().findAllByType(Text).map(node => node.props.children)).toEqual(Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0')));
  expect(minute().findAllByType(Text)).toHaveLength(60);
});

it('handles midnight and noon without dropping edited minutes', () => {
  mount(23 * 60 + 5);
  act(() => { hour().props.onSelectionChange(12); minute().props.onSelectionChange(15); });
  expect(value()).toBe(12 * 60 + 15);
  act(() => { period().props.onSelectionChange(0); });
  expect(value()).toBe(15);
  act(() => { hour().props.onSelectionChange(1); });
  expect(value()).toBe(75);
});

it('retains the wall time when the clock format changes while open', () => {
  mount(1380);
  act(() => { minute().props.onSelectionChange(45); });
  act(() => { renderer.update(<Harness initial={1380} is24Hour />); });
  expect(value()).toBe(1425);
  expect(hour().props.selection).toBe(23);
  expect(wheels()).toHaveLength(2);
});

it('localizes Chinese day periods and puts the period wheel first', () => {
  mount(1380, false, 'zh-CN');
  expect(period().findAllByType(Text).map(node => node.props.children)).toEqual(['上午', '下午']);
  const children = renderer.root.findByType(HStack).props.children.filter(Boolean);
  expect(children[0].key).toBe('period');
});
