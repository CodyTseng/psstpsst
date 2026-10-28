import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';
import { ApplicationIdentity } from '../ApplicationIdentity';

jest.mock('@/components/common/AppText', () => ({ AppText: 'Text' }));
jest.mock('../ApplicationIcon', () => ({ ApplicationIcon: 'Icon' }));
jest.mock('@/theme', () => ({ spacing: { xs: 4, md: 12, lg: 16, '2xl': 32, '3xl': 48 } }));

it('keeps placement and action order in sync across resizes and changing button widths', () => {
  const onPlacementReady = jest.fn();
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<ApplicationIdentity release={{ title: 'Notes', servers: [] }} wrapActions onPlacementReady={onPlacementReady}
    action={inline => <View testID="buttons">{inline ? 'secondary,primary' : 'primary,secondary'}</View>} />); });
  const root = () => renderer.root.findByProps({ testID: 'application-identity' });
  const actionBounds = () => renderer.root.findAllByType(View).find(node => node.props.onLayout && node.props.testID !== 'application-identity')!;
  const expectPlacement = (inline: boolean) => {
    expect(root().props.style.flexDirection).toBe(inline ? 'row' : 'column');
    expect(renderer.root.findByProps({ testID: 'buttons' }).props.children).toBe(inline ? 'secondary,primary' : 'primary,secondary');
  };
  act(() => { root().props.onLayout({ nativeEvent: { layout: { width: 360 } } }); });
  expect(onPlacementReady).not.toHaveBeenCalled();
  act(() => { actionBounds().props.onLayout({ nativeEvent: { layout: { width: 180 } } }); });
  expectPlacement(false);
  expect(onPlacementReady).toHaveBeenCalledTimes(1);
  act(() => { root().props.onLayout({ nativeEvent: { layout: { width: 700 } } }); });
  expectPlacement(true);
  act(() => { root().props.onLayout({ nativeEvent: { layout: { width: 360 } } }); });
  expectPlacement(false);
  act(() => { root().props.onLayout({ nativeEvent: { layout: { width: 700 } } }); });
  expectPlacement(true);
  act(() => { actionBounds().props.onLayout({ nativeEvent: { layout: { width: 400 } } }); });
  expectPlacement(false);
  act(() => { actionBounds().props.onLayout({ nativeEvent: { layout: { width: 180 } } }); });
  expectPlacement(true);
  act(() => renderer.unmount());
});
