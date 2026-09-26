import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { TextInput } from 'react-native';

import type { BrowserFile, ComposerFile } from '@/lib/attachments/composer-file';
import { useElectronComposerFilePaste } from '../use-electron-composer-file-paste';

jest.mock('@/lib/platform', () => ({ IS_ELECTRON: true }));

describe('Electron composer file paste', () => {
  let renderer: ReactTestRenderer | undefined;
  const listeners = new Set<(event: ClipboardEvent) => void>();
  const inputNode = { contains: jest.fn() };
  const inputRef = { current: inputNode as unknown as TextInput };
  const onPasteFiles = jest.fn<void, [ComposerFile[]]>();
  const querySelector = jest.fn();
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const image = {
    name: 'clipboard.png',
    type: 'image/png',
    size: 42,
  } as BrowserFile;

  function Harness({ enabled = true }: { enabled?: boolean }) {
    useElectronComposerFilePaste({ enabled, inputRef, onPasteFiles });
    return null;
  }

  function paste(
    clipboardData: unknown,
    overrides: Partial<ClipboardEvent> = {},
  ) {
    const event = {
      clipboardData,
      defaultPrevented: false,
      preventDefault: jest.fn(),
      target: { closest: jest.fn(() => null) },
      ...overrides,
    } as unknown as ClipboardEvent;
    act(() => listeners.forEach((listener) => listener(event)));
    return event;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    querySelector.mockReturnValue(null);
    inputNode.contains.mockReturnValue(false);
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        addEventListener: (_type: string, listener: (event: ClipboardEvent) => void) =>
          listeners.add(listener),
        removeEventListener: (_type: string, listener: (event: ClipboardEvent) => void) =>
          listeners.delete(listener),
        querySelector,
      },
    });
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    listeners.clear();
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });

  it('opens the attachment flow when a file is pasted outside the composer', () => {
    act(() => {
      renderer = create(<Harness />);
    });

    const event = paste({ files: [image] });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onPasteFiles).toHaveBeenCalledWith([
      {
        file: image,
        name: 'clipboard.png',
        mime: 'image/png',
        size: 42,
      },
    ]);
  });

  it('leaves ordinary text paste untouched', () => {
    act(() => {
      renderer = create(<Harness />);
    });

    const event = paste({ items: [{ kind: 'string' }] });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onPasteFiles).not.toHaveBeenCalled();
  });

  it('does not steal paste from another editor or a modal task', () => {
    act(() => {
      renderer = create(<Harness />);
    });

    paste(
      { files: [image] },
      { target: { closest: () => ({}) } as unknown as EventTarget },
    );
    querySelector.mockReturnValue({ contains: () => false });
    paste({ files: [image] });

    expect(onPasteFiles).not.toHaveBeenCalled();
  });

  it('listens only while the composer can accept attachments', () => {
    act(() => {
      renderer = create(<Harness enabled={false} />);
    });
    expect(listeners.size).toBe(0);

    act(() => {
      renderer?.update(<Harness />);
    });
    expect(listeners.size).toBe(1);

    act(() => {
      renderer?.update(<Harness enabled={false} />);
    });
    expect(listeners.size).toBe(0);
  });
});
