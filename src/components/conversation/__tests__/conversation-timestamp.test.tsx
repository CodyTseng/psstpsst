import { transformFileSync } from '@babel/core';
import { resolve } from 'node:path';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ComponentType } from 'react';

import i18n from '@/i18n';
import { AppText } from '@/components/common/AppText';
import { dateTimePreferences } from '@/services/preferences/date-time-state';
import { ConversationTimestamp } from '../ConversationTimestamp';

jest.mock('@/platform', () => ({ platform: { localization: { preferredLanguageTag: () => 'en-US' } } }));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));

// Jest normally omits Expo's supportsReactCompiler caller flag. Exercise the production
// compiler path too: a store update must invalidate cached JSX with unchanged props.
const compilerCaller = { name: 'metro', platform: 'ios', supportsReactCompiler: true, supportsStaticESM: false };
const code = transformFileSync(resolve(__dirname, '../ConversationTimestamp.tsx'), {
  caller: compilerCaller,
})!.code!;
const compiled = { exports: {} as { ConversationTimestamp: typeof ConversationTimestamp } };
new Function('require', 'module', 'exports', code)(require, compiled, compiled.exports);

const unix = (year: number, month: number, day: number, hour = 12, minute = 0) =>
  Math.floor(new Date(year, month - 1, day, hour, minute).getTime() / 1000);

describe.each([
  ['uncompiled', ConversationTimestamp],
  ['React Compiler', compiled.exports.ConversationTimestamp],
] as [string, ComponentType<{ timestamp: number; nowTs?: number }> ][])('%s conversation timestamps', (_mode, Timestamp) => {
  let renderer: ReactTestRenderer;
  const initialPreferences = dateTimePreferences.getState();
  const initialLanguage = i18n.language;
  beforeEach(async () => {
    dateTimePreferences.setState({ timeFormat: '12h', dateFormat: 'ymd' });
    await i18n.changeLanguage('en');
  });
  afterEach(async () => {
    act(() => renderer?.unmount());
    dateTimePreferences.setState(initialPreferences);
    await i18n.changeLanguage(initialLanguage);
  });
  const label = () => renderer.root.findByType(AppText).props.children;

  it('updates a mounted clock immediately without changing its timestamp or minute', () => {
    act(() => { renderer = create(<Timestamp timestamp={unix(2026, 10, 20, 13, 5)} nowTs={unix(2026, 10, 20, 15)} />); });
    expect(label()).toBe('1:05 PM');
    act(() => { dateTimePreferences.setState({ timeFormat: '24h' }); });
    expect(label()).toBe('13:05');
  });

  it('updates the system clock when a native preference refresh arrives', () => {
    dateTimePreferences.setState({ timeFormat: 'system', system24Hour: false, systemLocale: 'en-US' });
    act(() => { renderer = create(<Timestamp timestamp={unix(2026, 10, 20, 13, 5)} nowTs={unix(2026, 10, 20, 15)} />); });
    expect(label()).toBe('1:05 PM');
    act(() => { dateTimePreferences.setState({ system24Hour: true }); });
    expect(label()).toBe('13:05');
  });

  it('updates mounted absolute dates when either the selection or custom pattern changes', () => {
    act(() => { renderer = create(<Timestamp timestamp={unix(2026, 10, 5)} nowTs={unix(2026, 10, 20)} />); });
    expect(label()).toBe('2026-10-05');
    act(() => { dateTimePreferences.setState({ dateFormat: 'custom', customDateFormat: 'D.M.YYYY' }); });
    expect(label()).toBe('5.10.2026');
    act(() => { dateTimePreferences.setState({ customDateFormat: 'MM/DD/YY' }); });
    expect(label()).toBe('10/05/26');
  });

  it('updates the complete automatic date when only the UI language changes', async () => {
    dateTimePreferences.setState({ dateFormat: 'system', systemLocale: 'en-US' });
    act(() => { renderer = create(<Timestamp timestamp={unix(2026, 10, 22)} nowTs={unix(2026, 10, 31)} />); });
    expect(label()).toBe('Oct 22');
    await act(async () => { await i18n.changeLanguage('zh'); });
    expect(label()).toBe('10月22日');
  });

  it('updates localized day periods when only the app language changes', async () => {
    act(() => { renderer = create(<Timestamp timestamp={unix(2026, 10, 20, 13, 5)} nowTs={unix(2026, 10, 20, 15)} />); });
    await act(async () => { await i18n.changeLanguage('zh'); });
    expect(label()).toBe('下午1:05');
  });
});
