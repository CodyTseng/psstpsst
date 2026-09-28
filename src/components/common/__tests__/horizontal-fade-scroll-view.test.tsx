import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ScrollView } from 'react-native';

import { EdgeFade } from '../EdgeFade';
import { HorizontalFadeScrollView } from '../HorizontalFadeScrollView';

let mockDirection: 'ltr' | 'rtl' = 'ltr';

jest.mock('@/i18n/direction', () => ({
  useLanguageDirection: () => mockDirection,
}));
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: {
    accent: 'blue';
    preference: 'light';
  }) => unknown) => selector({ accent: 'blue', preference: 'light' }),
}));
jest.mock('../EdgeFade', () => ({ EdgeFade: () => null }));

function fadeEdges(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(EdgeFade).map((fade) => fade.props.edge);
}

function measure(renderer: ReactTestRenderer): void {
  const scroll = renderer.root.findByType(ScrollView);
  act(() => {
    scroll.props.onLayout({ nativeEvent: { layout: { width: 100 } } });
    scroll.props.onContentSizeChange(200, 40);
  });
}

function scrollTo(renderer: ReactTestRenderer, x: number): void {
  const scroll = renderer.root.findByType(ScrollView);
  act(() => {
    scroll.props.onScroll({
      nativeEvent: {
        contentOffset: { x },
        layoutMeasurement: { width: 100 },
        contentSize: { width: 200 },
      },
    });
  });
}

describe('HorizontalFadeScrollView', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    mockDirection = 'ltr';
  });

  it('tracks hidden content at both LTR edges', () => {
    act(() => {
      renderer = create(
        <HorizontalFadeScrollView fadeColor="#000">
          <></>
        </HorizontalFadeScrollView>,
      );
    });

    measure(renderer!);
    expect(
      renderer!.root.findByType(ScrollView).props.showsHorizontalScrollIndicator,
    ).toBe(false);
    expect(fadeEdges(renderer!)).toEqual(['end']);
    scrollTo(renderer!, 50);
    expect(fadeEdges(renderer!)).toEqual(['start', 'end']);
    scrollTo(renderer!, 100);
    expect(fadeEdges(renderer!)).toEqual(['start']);
  });

  it('maps the same physical offsets to logical RTL edges', () => {
    mockDirection = 'rtl';
    act(() => {
      renderer = create(
        <HorizontalFadeScrollView fadeColor="#000">
          <></>
        </HorizontalFadeScrollView>,
      );
    });

    measure(renderer!);
    expect(fadeEdges(renderer!)).toEqual(['start']);
    scrollTo(renderer!, 50);
    expect(fadeEdges(renderer!)).toEqual(['start', 'end']);
    scrollTo(renderer!, 100);
    expect(fadeEdges(renderer!)).toEqual(['end']);
  });
});
