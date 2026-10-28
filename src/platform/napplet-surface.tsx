import { requireNativeViewManager } from 'expo-modules-core';
import { useSyncExternalStore } from 'react';
import { type ViewProps } from 'react-native';
import { nativeSurface } from './expo/napplet';
import { useThemeColors } from '@/theme';
import { useHasPresentedOverlay } from '@/hooks/use-overlay-presentation';

type NativeProps = ViewProps & {
  html: string;
  page: string;
  surfaceId: string;
  onMessage: (event: { nativeEvent: { message?: string; ack?: number } }) => void;
};
let NativeView: React.ComponentType<NativeProps> | undefined;
export function NappletSurface({ id, visible, obscured: localObscured = false }: { id: string; visible: boolean; obscured?: boolean }) {
  const hasOverlay = useHasPresentedOverlay();
  const obscured = localObscured || hasOverlay;
  const c = useThemeColors();
  const surface = useSyncExternalStore(nativeSurface.subscribe, () => nativeSurface.get(id));
  if (!surface) return null;
  const presented = visible && surface.ready;
  NativeView ??= requireNativeViewManager<NativeProps>('ExpoNapplet');
  return (
    <NativeView
      key={id}
      style={{ flex: 1, backgroundColor: c.background, opacity: presented ? 1 : 0 , pointerEvents: presented && !obscured ? 'auto' : 'none' }}
      surfaceId={id}
      html={surface.html}
      page={surface.page ?? ''}
      onMessage={(event) => {
        if (event.nativeEvent.message) nativeSurface.message(id, event.nativeEvent.message);
      }}
    />
  );
}
