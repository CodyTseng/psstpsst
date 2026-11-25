import { useState, type ComponentProps } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { ChatComposerFeedbackSlot } from '../ChatComposerFeedbackSlot';

function Feedback({ visible }: { visible: boolean }) {
  const [height, setHeight] = useState(0);
  return (
    <ChatComposerFeedbackSlot height={height} onHeightChange={setHeight}>
      {visible ? <View testID="notice" /> : null}
    </ChatComposerFeedbackSlot>
  );
}

it('retains the transparent measured envelope after dismissal, including stale zero-height events', () => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<Feedback visible />); });
  const slot = () => renderer.root.findByType(ChatComposerFeedbackSlot).findAllByType(View)[0];
  act(() => { slot().props.onLayout({ nativeEvent: { layout: { height: 56 } } }); });
  expect(StyleSheet.flatten(slot().props.style).minHeight).toBe(56);
  act(() => { renderer.update(<Feedback visible={false} />); });
  expect(renderer.root.findAllByProps({ testID: 'notice' })).toHaveLength(0);
  expect(StyleSheet.flatten(slot().props.style).minHeight).toBe(56);
  expect(StyleSheet.flatten(slot().props?.style)?.pointerEvents).toBe('box-none');
  act(() => { slot().props.onLayout({ nativeEvent: { layout: { height: 0 } } }); });
  expect(StyleSheet.flatten(slot().props.style).minHeight).toBe(56);
  act(() => { renderer.unmount(); });
});

it('reports only measured feedback content as occluding the timeline after feedback is dismissed', () => {
  const occlusion = { set: jest.fn() } as unknown as ComponentProps<typeof ChatComposerFeedbackSlot>['occlusion'];
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(
    <ChatComposerFeedbackSlot height={56} onHeightChange={jest.fn()} occlusion={occlusion} occlusionAdjustment={12} />,
  ); });
  const content = () => renderer.root.findByType(ChatComposerFeedbackSlot).findAllByType(View)[1];
  act(() => { content().props.onLayout({ nativeEvent: { layout: { height: 44 } } }); });
  expect(occlusion?.set).toHaveBeenLastCalledWith(56);
  act(() => { content().props.onLayout({ nativeEvent: { layout: { height: 0 } } }); });
  expect(occlusion?.set).toHaveBeenLastCalledWith(12);
  act(() => renderer.unmount());
});
