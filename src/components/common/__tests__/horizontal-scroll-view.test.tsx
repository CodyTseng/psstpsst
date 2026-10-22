import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ScrollView, StyleSheet } from 'react-native';
import { HorizontalScrollView } from '../HorizontalScrollView';

let mockDirection: 'ltr' | 'rtl' = 'ltr';
jest.mock('@/i18n/direction', () => ({ useLanguageDirection: () => mockDirection }));
jest.mock('@/lib/platform', () => ({ IS_ELECTRON: true }));

it.each(['ltr', 'rtl'] as const)('preserves physical scroll coordinates and %s content order for tab reveal', direction => {
  mockDirection = direction;
  let renderer!: ReactTestRenderer;
  const onScroll = jest.fn(), onLayout = jest.fn(), onContentSizeChange = jest.fn();
  act(() => {
    renderer = create(<HorizontalScrollView onScroll={onScroll} onLayout={onLayout}
      onContentSizeChange={onContentSizeChange} contentContainerStyle={{ paddingHorizontal: 16 }}>
      <></>
    </HorizontalScrollView>);
  });
  const scroll = renderer.root.findByType(ScrollView);
  expect(StyleSheet.flatten(scroll.props.style).direction).toBe('ltr');
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({ direction, paddingHorizontal: 16 });
  expect(scroll.props.horizontal).toBe(true);
  expect(scroll.props.showsHorizontalScrollIndicator).toBe(false);
  expect(scroll.props.dataSet).toEqual({ psstpsstScrollbarHidden: 'true' });
  expect(scroll.props.onScroll).toBe(onScroll);
  expect(scroll.props.onLayout).toBe(onLayout);
  expect(scroll.props.onContentSizeChange).toBe(onContentSizeChange);
  act(() => renderer.unmount());
});
