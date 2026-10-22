import { createElectronAdapters } from '..';
import { getElectronBridge } from '../bridge';

jest.mock('../../expo', () => ({
  createExpoAdapters: () => { throw new Error('Electron must not use Expo adapters'); },
}));
jest.mock('../bridge', () => ({ getElectronBridge: jest.fn() }));
jest.mock('../video-thumbnail', () => ({ electronVideoThumbnailAdapter: {} }));

it('tracks BrowserWindow presence even when the embedded application owns document focus', async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { hidden: false, hasFocus: () => false, addEventListener: jest.fn() },
  });
  let changed: (focused: boolean) => void = () => {};
  const remove = jest.fn();
  const windowFocus = {
    isFocused: jest.fn(() => true),
    onChange: jest.fn((listener: (focused: boolean) => void) => { changed = listener; return remove; }),
  };
  jest.mocked(getElectronBridge).mockReturnValue({ windowFocus } as unknown as ReturnType<typeof getElectronBridge>);
  try {
    const chrome = createElectronAdapters().windowChrome;
    await expect(chrome.getFocusState()).resolves.toBe(true);
    const listener = jest.fn();
    const unsubscribe = chrome.addFocusListener(listener);
    changed(false);
    changed(true);
    expect(listener.mock.calls).toEqual([[false], [true]]);
    windowFocus.isFocused.mockReturnValue(false);
    await expect(chrome.getFocusState()).resolves.toBe(false);
    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
