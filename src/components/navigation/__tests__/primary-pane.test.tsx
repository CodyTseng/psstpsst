import React from 'react';
import { PrimaryPane } from '../PrimaryPane.web';
import { useDesktopLayoutStore } from '@/stores/desktop-layout.store';
import { trySetDevicePreference } from '@/services/preferences/device-preferences.service';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

jest.mock('@/services/preferences/device-preferences.service', () => ({
  getDevicePreference: jest.fn(),
  trySetDevicePreference: jest.fn(async () => {}),
}));


let mockRTL = false;
let mockDark = false;
jest.mock('@/i18n/direction', () => ({ useIsRTL: () => mockRTL }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({
  useThemeColors: () => mockDark
    ? { border: 'dark-border', interactionOverlay: 'dark-hover' }
    : { border: 'light-border', interactionOverlay: 'light-hover' },
}));

it('resizes without rendering content again, clamps on shrink, and supports RTL and both themes', () => {
  jest.useFakeTimers();
  const contentRender = jest.fn();
  function Content() { contentRender(); return <span />; }
  const child = <Content />;
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<PrimaryPane windowWidth={1000}>{child}</PrimaryPane>); });
  const divider = () => renderer.root.findByProps({ role: 'separator' });
  const shell = () => renderer.root.findAllByType('div')[0];
  const target = {
    focus: jest.fn(), setPointerCapture: jest.fn(),
    hasPointerCapture: () => true, releasePointerCapture: jest.fn(),
  };
  const pointer = (clientX: number) => ({
    clientX, pointerId: 1, button: 0, currentTarget: target, preventDefault: jest.fn(),
  });
  act(() => { divider().props.onPointerDown(pointer(320)); });
  act(() => { divider().props.onPointerMove(pointer(460)); jest.runOnlyPendingTimers(); });
  expect(divider().props['aria-valuenow']).toBe(460);
  expect(trySetDevicePreference).not.toHaveBeenCalled();
  expect(contentRender).toHaveBeenCalledTimes(1);
  act(() => { divider().props.onPointerUp(pointer(460)); jest.runOnlyPendingTimers(); });
  expect(trySetDevicePreference).toHaveBeenCalledWith('desktop.primaryPaneWidth', '460');
  expect(target.releasePointerCapture).toHaveBeenCalledWith(1);

  act(() => { renderer.update(<PrimaryPane windowWidth={600}>{child}</PrimaryPane>); });
  expect(divider().props['aria-valuenow']).toBe(320);
  act(() => { renderer.update(<PrimaryPane windowWidth={1000}>{child}</PrimaryPane>); });
  expect(divider().props['aria-valuenow']).toBe(460);

  act(() => { divider().props.onPointerEnter(); });
  expect(divider().props.style.backgroundColor).toBe('light-hover');
  expect(shell().props.style.borderInlineEnd).toBe('1px solid light-border');
  mockRTL = true;
  mockDark = true;
  act(() => { renderer.update(<PrimaryPane windowWidth={1000}>{child}</PrimaryPane>); });
  expect(divider().props.style.backgroundColor).toBe('dark-hover');
  expect(shell().props.style.borderInlineEnd).toBe('1px solid dark-border');
  expect(shell().props.dir).toBe('rtl');
  act(() => { divider().props.onPointerDown(pointer(540)); });
  act(() => { divider().props.onPointerMove(pointer(740)); jest.runOnlyPendingTimers(); });
  expect(divider().props['aria-valuenow']).toBe(280);
  act(() => { divider().props.onPointerCancel(pointer(740)); });
  act(() => { divider().props.onPointerMove(pointer(0)); jest.runOnlyPendingTimers(); });
  expect(divider().props['aria-valuenow']).toBe(280);
  act(() => {
    divider().props.onKeyDown({ key: 'ArrowLeft', preventDefault: jest.fn() });
    jest.runOnlyPendingTimers();
  });
  expect(divider().props['aria-valuenow']).toBe(296);
  act(() => { divider().props.onDoubleClick(); jest.runOnlyPendingTimers(); });
  expect(divider().props['aria-valuenow']).toBe(320);
  act(() => { renderer.unmount(); });
  jest.useRealTimers();
});

it('uses the restored width on mount without saving temporary window constraints', () => {
  jest.mocked(trySetDevicePreference).mockClear();
  useDesktopLayoutStore.setState({ primaryWidth: 900, loaded: true });
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<PrimaryPane windowWidth={1000}><span /></PrimaryPane>); });
  expect(renderer.root.findByProps({ role: 'separator' }).props['aria-valuenow']).toBe(720);
  act(() => { renderer.unmount(); });
  expect(useDesktopLayoutStore.getState().primaryWidth).toBe(900);
  expect(trySetDevicePreference).not.toHaveBeenCalled();
  act(() => { renderer = create(<PrimaryPane windowWidth={1400}><span /></PrimaryPane>); });
  expect(renderer.root.findByProps({ role: 'separator' }).props['aria-valuenow']).toBe(900);
  act(() => { renderer.unmount(); });
});
