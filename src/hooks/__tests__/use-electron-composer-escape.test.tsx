import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useElectronComposerEscape } from '../use-electron-composer-escape';

jest.mock('@/lib/platform', () => ({ IS_ELECTRON: true }));

describe('Electron composer Escape', () => {
  let renderer: ReactTestRenderer | undefined;
  const listeners = new Set<(event: KeyboardEvent) => void>();
  const querySelector = jest.fn();
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

  function Harness({ active, onCancel }: { active: boolean; onCancel: () => void }) {
    useElectronComposerEscape({ active, onCancel });
    return null;
  }

  function keyDown(key: string, overrides: Partial<KeyboardEvent> = {}) {
    const event = {
      key,
      preventDefault: jest.fn(),
      stopImmediatePropagation: jest.fn(),
      ...overrides,
    } as unknown as KeyboardEvent;
    act(() => listeners.forEach((listener) => listener(event)));
    return event;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    querySelector.mockReturnValue(null);
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        addEventListener: (_type: string, listener: (event: KeyboardEvent) => void) =>
          listeners.add(listener),
        removeEventListener: (_type: string, listener: (event: KeyboardEvent) => void) =>
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

  it('consumes Escape and cancels an active reply', () => {
    const onCancel = jest.fn();
    act(() => {
      renderer = create(<Harness active onCancel={onCancel} />);
    });

    const escape = keyDown('Escape');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(escape.preventDefault).toHaveBeenCalledTimes(1);
    expect(escape.stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  it('ignores handled, composing, and non-Escape key events', () => {
    const onCancel = jest.fn();
    act(() => {
      renderer = create(<Harness active onCancel={onCancel} />);
    });

    keyDown('Enter');
    keyDown('Escape', { defaultPrevented: true });
    keyDown('Escape', { isComposing: true });

    expect(onCancel).not.toHaveBeenCalled();
  });

  it('leaves Escape to an open menu or modal', () => {
    const onCancel = jest.fn();
    querySelector.mockReturnValue({});
    act(() => {
      renderer = create(<Harness active onCancel={onCancel} />);
    });

    const escape = keyDown('Escape');

    expect(onCancel).not.toHaveBeenCalled();
    expect(escape.preventDefault).not.toHaveBeenCalled();
    expect(escape.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it('listens only while a reply is active', () => {
    const onCancel = jest.fn();
    act(() => {
      renderer = create(<Harness active={false} onCancel={onCancel} />);
    });
    expect(listeners.size).toBe(0);

    act(() => {
      renderer?.update(<Harness active onCancel={onCancel} />);
    });
    expect(listeners.size).toBe(1);

    act(() => {
      renderer?.update(<Harness active={false} onCancel={onCancel} />);
    });
    expect(listeners.size).toBe(0);
  });
});
