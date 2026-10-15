import { requireNativeViewManager } from 'expo-modules-core';
import { useSyncExternalStore } from 'react';
import { type ViewProps } from 'react-native';
import { nativeSurface } from './expo/napplet';

type NativeProps = ViewProps & {
  html: string;
  surfaceId: string;
  onMessage: (event: { nativeEvent: { message?: string; ack?: number } }) => void;
};
let NativeView: React.ComponentType<NativeProps> | undefined;
export function NappletSurface({ id, visible }: { id: string; visible: boolean }) {
  const surface = useSyncExternalStore(nativeSurface.subscribe, () => nativeSurface.get(id));
  if (!surface) return null;
  NativeView ??= requireNativeViewManager<NativeProps>('ExpoNapplet');
  return (
    <NativeView
      key={id}
      style={{ flex: 1, opacity: visible ? 1 : 0 }}
      pointerEvents={visible ? 'auto' : 'none'}
      surfaceId={id}
      html={surface.html}
      onMessage={(event) => {
        if (event.nativeEvent.message) nativeSurface.message(id, event.nativeEvent.message);
      }}
    />
  );
}
