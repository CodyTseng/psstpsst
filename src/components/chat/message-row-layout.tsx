import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import { ATTACHMENT_FAILURE_TARGET_SIZE } from './attachment-layout';
import { BUBBLE_MAX_WIDTH } from './bubble-layout';

const MessageViewportWidth = createContext<number | undefined>(undefined);
const BUBBLE_WIDTH_FRACTION = parseFloat(BUBBLE_MAX_WIDTH) / 100;

export type MessageBodyLayout = {
  quoteMaxWidth: number;
  attachmentMaxWidth: number;
};

/** Quote and attachment constraints have the same row basis but separate action budgets. */
export function messageBodyLayout(
  rowWidth: number,
  attachmentActionWidth = ATTACHMENT_FAILURE_TARGET_SIZE,
  quoteActionWidth = 0,
): MessageBodyLayout {
  return {
    quoteMaxWidth: Math.max(0, Math.min(rowWidth * BUBBLE_WIDTH_FRACTION, rowWidth - quoteActionWidth)),
    attachmentMaxWidth: Math.max(0, rowWidth - attachmentActionWidth),
  };
}

/** Measure the conversation pane once, rather than measuring every virtualized row. */
export function MessageLayoutViewport({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(0);
  return (
    <View style={{ flex: 1 }} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <MessageViewportWidth.Provider value={width}>{children}</MessageViewportWidth.Provider>
    </View>
  );
}

/** Standalone share previews measure locally; list rows reuse their pane's measurement. */
export function useMessageRowWidth(horizontalInset: number) {
  const viewportWidth = useContext(MessageViewportWidth);
  const [localWidth, setLocalWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setLocalWidth(event.nativeEvent.layout.width);
  }, []);
  const width = viewportWidth ?? localWidth;
  return {
    width: width > 0 ? Math.max(0, width - horizontalInset) : undefined,
    onLayout: viewportWidth === undefined ? onLayout : undefined,
  };
}
