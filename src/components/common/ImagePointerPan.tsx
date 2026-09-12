import type { ReactNode } from 'react';

export type ImagePointerPanProps = {
  enabled: boolean;
  onStart: () => void;
  onMove: (translationX: number, translationY: number) => void;
  onWheelPan: (deltaX: number, deltaY: number) => void;
  onWheelZoom: (factor: number, originX: number, originY: number) => void;
  onSingleClick: () => void;
  onDoubleClick: () => void;
  children: ReactNode;
};

/** Native image panning is handled by the nested GestureDetector. */
export function ImagePointerPan({ children }: ImagePointerPanProps) {
  return children;
}
