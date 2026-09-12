import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  SystemColorSchemeProvider,
  resolveEffectiveColorScheme,
  useEffectiveColorScheme,
} from '../effective-color-scheme';

let systemScheme: 'light' | 'dark' = 'light';
const mockUseColorScheme = jest.fn(() => systemScheme);

jest.mock('../system-appearance', () => ({
  useSystemColorScheme: () => mockUseColorScheme(),
}));

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { preference: 'system' }) => unknown) =>
    selector({ preference: 'system' }),
}));

function SchemeProbe({ testID }: { testID: string }) {
  const scheme = useEffectiveColorScheme();
  return createElement('scheme-probe', { testID, accessibilityLabel: scheme });
}

function TestTree({ revision }: { revision: number }) {
  void revision;
  return (
    <SystemColorSchemeProvider>
      <SchemeProbe testID="sidebar" />
      <SchemeProbe testID="content" />
    </SystemColorSchemeProvider>
  );
}

describe('effective color scheme', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    systemScheme = 'light';
    mockUseColorScheme.mockClear();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('publishes one system appearance snapshot to every themed region', () => {
    act(() => {
      renderer = create(<TestTree revision={0} />);
    });

    expect(mockUseColorScheme).toHaveBeenCalledTimes(1);
    expect(
      renderer!.root.findByProps({ testID: 'sidebar', accessibilityLabel: 'light' }),
    ).toBeDefined();
    expect(
      renderer!.root.findByProps({ testID: 'content', accessibilityLabel: 'light' }),
    ).toBeDefined();

    systemScheme = 'dark';
    act(() => {
      renderer!.update(<TestTree revision={1} />);
    });

    expect(mockUseColorScheme).toHaveBeenCalledTimes(2);
    expect(
      renderer!.root.findByProps({ testID: 'sidebar', accessibilityLabel: 'dark' }),
    ).toBeDefined();
    expect(
      renderer!.root.findByProps({ testID: 'content', accessibilityLabel: 'dark' }),
    ).toBeDefined();
  });

  it('keeps explicit preferences authoritative', () => {
    expect(resolveEffectiveColorScheme('light', 'dark')).toBe('light');
    expect(resolveEffectiveColorScheme('dark', 'light')).toBe('dark');
    expect(resolveEffectiveColorScheme('system', 'light')).toBe('light');
  });
});
