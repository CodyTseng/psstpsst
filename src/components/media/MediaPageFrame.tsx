import type { ReactNode } from 'react';
import { View } from 'react-native';

export type MediaPageFrameProps = {
  width: number;
  height: number;
  children: ReactNode;
  onReady?: () => void;
};

/** The native pager owns its gesture boundaries. */
export function MediaPageFrame({ width, height, children, onReady }: MediaPageFrameProps) {
  return <View style={{ width, height }} onLayout={onReady}>{children}</View>;
}
