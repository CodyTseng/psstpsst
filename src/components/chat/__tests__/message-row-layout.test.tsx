import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';

import { fitAttachmentMediaBox, ATTACHMENT_FAILURE_TARGET_SIZE } from '../attachment-layout';
import { MessageLayoutViewport, messageBodyLayout, useMessageRowWidth } from '../message-row-layout';

jest.mock('@/services/preferences/device-preferences.service', () => ({
  getDevicePreference: jest.fn(), trySetDevicePreference: jest.fn(async () => {}),
}));

let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); });

it.each([320, 360, 375, 390, 393])('fits media and action targets inside a %s-wide group conversation', width => {
  const rowWidth = width - 32 - 42;
  const layout = messageBodyLayout(rowWidth);
  expect(layout.quoteMaxWidth).toBeCloseTo(rowWidth * 0.85);
  for (const aspect of [1 / 3, 1, 4 / 3, 16 / 9]) {
    const media = fitAttachmentMediaBox(aspect, layout.attachmentMaxWidth);
    expect(media.width + ATTACHMENT_FAILURE_TARGET_SIZE).toBeLessThanOrEqual(rowWidth);
    expect(media.height).toBeGreaterThanOrEqual(120);
  }
  expect(Math.min(240, layout.attachmentMaxWidth) + ATTACHMENT_FAILURE_TARGET_SIZE).toBeLessThanOrEqual(rowWidth);
  expect(Math.min(220, layout.attachmentMaxWidth) + ATTACHMENT_FAILURE_TARGET_SIZE).toBeLessThanOrEqual(rowWidth);
});

it('preserves normal card geometry when the full row has enough room', () => {
  expect(fitAttachmentMediaBox(4 / 3, messageBodyLayout(328).attachmentMaxWidth)).toEqual({ width: 240, height: 180 });
});

it('keeps pending quote and card budgets clear of their separate action slot', () => {
  const rowWidth = 248;
  const layout = messageBodyLayout(rowWidth, 44, 44);
  expect(layout.quoteMaxWidth + 44).toBeLessThanOrEqual(rowWidth);
  expect(layout.attachmentMaxWidth + 44).toBe(rowWidth);
});

it('shares one pane measurement across rows and only updates for width changes', () => {
  const reads: ReturnType<typeof useMessageRowWidth>[] = [];
  function Row({ inset }: { inset: number }) {
    const row = useMessageRowWidth(inset);
    reads.push(row);
    return <View onLayout={row.onLayout} />;
  }
  act(() => { renderer = create(<MessageLayoutViewport><Row inset={32} /><Row inset={74} /></MessageLayoutViewport>); });
  const pane = renderer.root.findAllByType(View)[0];
  act(() => { pane.props.onLayout({ nativeEvent: { layout: { width: 390, height: 600 } } }); });
  expect(reads.slice(-2).map(row => row.width)).toEqual([358, 316]);
  expect(reads.slice(-2).every(row => row.onLayout === undefined)).toBe(true);
  const count = reads.length;
  act(() => { pane.props.onLayout({ nativeEvent: { layout: { width: 390, height: 400 } } }); });
  expect(reads).toHaveLength(count);
  act(() => { pane.props.onLayout({ nativeEvent: { layout: { width: 320, height: 400 } } }); });
  expect(reads.slice(-2).map(row => row.width)).toEqual([288, 246]);
});
