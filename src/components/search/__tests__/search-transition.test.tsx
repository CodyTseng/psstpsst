import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Animated, View } from 'react-native';

import {
  getSearchActivationShortcutLabel,
  isSearchActivationShortcut,
  resolveSearchPlaceholder,
} from '../search-shortcut';
import { SearchTransition } from '../SearchTransition';

describe('SearchTransition', () => {
  let renderer: ReactTestRenderer | undefined;
  const onActivate = jest.fn();
  const onCancel = jest.fn();

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    jest.restoreAllMocks();
    onActivate.mockClear();
    onCancel.mockClear();
  });

  it('keeps resting content mounted and swaps pointer ownership on activation', () => {
    act(() => {
      renderer = create(
        <SearchTransition
          active={false}
          activeContent={<View testID="active-content" />}
          onActivate={onActivate}
          onCancel={onCancel}
        >
          <View testID="resting-content" />
        </SearchTransition>,
      );
    });

    const restingContent = renderer!.root.findByProps({ testID: 'resting-content' });
    expect(restingContent.parent?.props.pointerEvents).toBe('auto');
    expect(renderer!.root.findAllByProps({ testID: 'active-content' })).toHaveLength(0);

    act(() => {
      renderer!.update(
        <SearchTransition
          active
          activeContent={<View testID="active-content" />}
          activeChrome={<View testID="active-chrome" />}
          onActivate={onActivate}
          onCancel={onCancel}
        >
          <View testID="resting-content" />
        </SearchTransition>,
      );
    });

    expect(renderer!.root.findByProps({ testID: 'resting-content' })).toBeTruthy();
    expect(
      renderer!.root.findByProps({ testID: 'resting-content' }).parent?.props
        .pointerEvents,
    ).toBe('none');
    expect(
      renderer!.root.findAllByProps({ testID: 'active-content' }).length,
    ).toBeGreaterThan(0);
  });

  it('keeps resting content visible until the query has searchable text', () => {
    act(() => {
      renderer = create(
        <SearchTransition
          active
          contentActive={false}
          activeContent={<View testID="active-content" />}
          activeChrome={<View testID="active-chrome" />}
          onActivate={onActivate}
          onCancel={onCancel}
        >
          <View testID="resting-content" />
        </SearchTransition>,
      );
    });

    expect(
      renderer!.root.findByProps({ testID: 'resting-content' }).parent?.props
        .pointerEvents,
    ).toBe('auto');
    expect(renderer!.root.findAllByProps({ testID: 'active-content' })).toHaveLength(0);
    expect(renderer!.root.findByProps({ testID: 'active-chrome' })).toBeTruthy();

    act(() => {
      renderer!.update(
        <SearchTransition
          active
          contentActive
          activeContent={<View testID="active-content" />}
          activeChrome={<View testID="active-chrome" />}
          onActivate={onActivate}
          onCancel={onCancel}
        >
          <View testID="resting-content" />
        </SearchTransition>,
      );
    });

    expect(
      renderer!.root.findByProps({ testID: 'resting-content' }).parent?.props
        .pointerEvents,
    ).toBe('none');
    expect(renderer!.root.findByProps({ testID: 'active-content' })).toBeTruthy();
  });

  it('keeps active content mounted until the exit animation finishes', () => {
    const completions: ((result: { finished: boolean }) => void)[] = [];
    jest.spyOn(Animated, 'timing').mockImplementation(
      () =>
        ({
          start: (completion?: (result: { finished: boolean }) => void) => {
            if (completion) completions.push(completion);
          },
          stop: jest.fn(),
          reset: jest.fn(),
        }) as Animated.CompositeAnimation,
    );

    act(() => {
      renderer = create(
        <SearchTransition
          active
          activeContent={<View testID="active-content" />}
          onActivate={onActivate}
          onCancel={onCancel}
        >
          <View testID="resting-content" />
        </SearchTransition>,
      );
    });

    act(() => {
      renderer!.update(
        <SearchTransition
          active={false}
          activeContent={<View testID="active-content" />}
          activeChrome={<View testID="active-chrome" />}
          onActivate={onActivate}
          onCancel={onCancel}
        >
          <View testID="resting-content" />
        </SearchTransition>,
      );
    });

    const exitingContent = renderer!.root.findByProps({ testID: 'active-content' });
    const exitingChrome = renderer!.root.findByProps({ testID: 'active-chrome' });
    expect(exitingContent.parent?.props.pointerEvents).toBe('none');
    expect(exitingChrome.parent?.props.pointerEvents).toBe('none');

    act(() => completions.at(-1)?.({ finished: true }));

    expect(renderer!.root.findAllByProps({ testID: 'active-content' })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ testID: 'active-chrome' })).toHaveLength(0);
  });

  it('uses the platform-native modifier for search activation', () => {
    expect(isSearchActivationShortcut({ key: 'k', metaKey: true }, 'darwin')).toBe(true);
    expect(isSearchActivationShortcut({ key: 'k', ctrlKey: true }, 'darwin')).toBe(false);
    expect(isSearchActivationShortcut({ key: 'K', ctrlKey: true }, 'win32')).toBe(true);
    expect(isSearchActivationShortcut({ key: 'k', ctrlKey: true }, 'linux')).toBe(true);
    expect(isSearchActivationShortcut({ key: 'k', metaKey: true }, 'win32')).toBe(false);
    expect(
      isSearchActivationShortcut({ key: 'k', ctrlKey: true, shiftKey: true }, 'linux'),
    ).toBe(false);
    expect(getSearchActivationShortcutLabel('darwin')).toBe('⌘K');
    expect(getSearchActivationShortcutLabel('win32')).toBe('Ctrl+K');
    expect(getSearchActivationShortcutLabel('linux')).toBe('Ctrl+K');
  });

  it('hides the shortcut hint while the search field is focused', () => {
    expect(resolveSearchPlaceholder('Search', '⌘K', false)).toBe('Search (⌘K)');
    expect(resolveSearchPlaceholder('Search', '⌘K', true)).toBe('Search');
    expect(resolveSearchPlaceholder('Search', undefined, false)).toBe('Search');
  });

  it('cancels active search when its host tab loses focus', () => {
    act(() => {
      renderer = create(
        <SearchTransition
          active
          activeContent={<View />}
          focused
          onActivate={onActivate}
          onCancel={onCancel}
        >
          <View />
        </SearchTransition>,
      );
    });
    expect(onCancel).not.toHaveBeenCalled();

    act(() => {
      renderer!.update(
        <SearchTransition
          active
          activeContent={<View />}
          focused={false}
          onActivate={onActivate}
          onCancel={onCancel}
        >
          <View />
        </SearchTransition>,
      );
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('routes activation and Escape through the shared handlers', () => {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const listeners = new Set<(event: KeyboardEvent) => void>();
    let captureEnabled = false;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        addEventListener: (
          type: string,
          listener: (event: KeyboardEvent) => void,
          capture?: boolean,
        ) => {
          if (type === 'keydown') {
            listeners.add(listener);
            captureEnabled = capture === true;
          }
        },
        removeEventListener: (
          type: string,
          listener: (event: KeyboardEvent) => void,
          _capture?: boolean,
        ) => {
          if (type === 'keydown') listeners.delete(listener);
        },
      },
    });

    try {
      act(() => {
        renderer = create(
          <SearchTransition
            active={false}
            activeContent={<View />}
            onActivate={onActivate}
            onCancel={onCancel}
          >
            <View />
          </SearchTransition>,
        );
      });
      expect(captureEnabled).toBe(true);

      const activationEvent = {
        key: 'k',
        ctrlKey: true,
        preventDefault: jest.fn(),
      } as unknown as KeyboardEvent;
      act(() => listeners.forEach((listener) => listener(activationEvent)));
      expect(activationEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(onActivate).toHaveBeenCalledTimes(1);

      act(() => {
        renderer!.update(
          <SearchTransition
            active
            activeContent={<View />}
            onActivate={onActivate}
            onCancel={onCancel}
          >
            <View />
          </SearchTransition>,
        );
      });

      const enterEvent = { key: 'Enter', preventDefault: jest.fn() } as unknown as KeyboardEvent;
      act(() => listeners.forEach((listener) => listener(enterEvent)));
      expect(onCancel).not.toHaveBeenCalled();

      const escapeEvent = {
        key: 'Escape',
        preventDefault: jest.fn(),
      } as unknown as KeyboardEvent;
      act(() => listeners.forEach((listener) => listener(escapeEvent)));
      expect(escapeEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(onCancel).toHaveBeenCalledTimes(1);
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      if (originalDocument) {
        Object.defineProperty(globalThis, 'document', originalDocument);
      } else {
        Reflect.deleteProperty(globalThis, 'document');
      }
    }
  });
});
