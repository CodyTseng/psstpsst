import { createElectronAdapters } from '..';
import { getElectronBridge } from '../bridge';

jest.mock('../../expo', () => ({ createExpoAdapters: () => { throw new Error('Unexpected Expo adapter'); } }));
jest.mock('../bridge', () => ({ getElectronBridge: jest.fn() }));
jest.mock('../video-thumbnail', () => ({ electronVideoThumbnailAdapter: {} }));

it('reads native settings through the bridge and requests a refresh when the user returns', async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false, addEventListener: jest.fn() } });
  let presenceChanged!: (focused: boolean) => void;
  const remove = jest.fn();
  const dateTimeSettings = jest.fn(async () => ({ locale: 'en-CN', uses24HourClock: true }));
  jest.mocked(getElectronBridge).mockReturnValue({
    system: { dateTimeSettings },
    windowFocus: { onChange: (listener: (focused: boolean) => void) => { presenceChanged = listener; return remove; } },
  } as unknown as ReturnType<typeof getElectronBridge>);
  try {
    const localization = createElectronAdapters().localization;
    await expect(localization.dateTimeSettings()).resolves.toEqual({ locale: 'en-CN', uses24HourClock: true });
    expect(dateTimeSettings).toHaveBeenCalledTimes(1);
    const changed = jest.fn();
    const unsubscribe = localization.addChangeListener!(changed);
    presenceChanged(false);
    expect(changed).not.toHaveBeenCalled();
    presenceChanged(true);
    expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
