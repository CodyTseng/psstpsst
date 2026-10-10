import { useState } from 'react';
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
  expect(slot().props.pointerEvents).toBe('box-none');
  act(() => { slot().props.onLayout({ nativeEvent: { layout: { height: 0 } } }); });
  expect(StyleSheet.flatten(slot().props.style).minHeight).toBe(56);
  act(() => { renderer.unmount(); });
});
