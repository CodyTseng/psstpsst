import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { platform } from './index';
import { useHasPresentedOverlay } from '@/hooks/use-overlay-presentation';

type CaptureSession = { active: boolean; token: number };
type Preview = { id: string; uri: string; session: CaptureSession };

export function NappletSurface({ id, visible, obscured: localObscured = false }: { id: string; visible: boolean; obscured?: boolean }) {
  const hasOverlay = useHasPresentedOverlay();
  const obscured = localObscured || hasOverlay;
  const ref = useRef<View>(null);
  const sessionRef = useRef<CaptureSession | null>(null);
  const sequence = useRef(0);
  const [presentation, setPresentation] = useState({ id, visible, obscured, preview: null as Preview | null });
  if (presentation.id !== id || presentation.visible !== visible || presentation.obscured !== obscured) {
    setPresentation({ id, visible, obscured, preview: visible && presentation.id === id ? presentation.preview : null });
  }
  const preview = presentation.preview;
  useLayoutEffect(() => {
    const session = { active: true, token: ++sequence.current };
    sessionRef.current = session;
    if (visible && obscured) {
      void platform.napplet.capture(id).then((uri) => {
        if (!session.active) return;
        if(uri)setPresentation((value) => ({ ...value, preview: { id, uri, session } }));
      }).catch(() => {});
    }
    return () => { session.active = false; };
  }, [id, visible, obscured]);
  const nativeVisible = visible && !obscured;
  const place = useCallback(() => {
    const session = sessionRef.current;
    ref.current?.measureInWindow((x, y, width, height) => {
      if (!session?.active) return;
      void platform.napplet.setBounds(id, { x, y, width, height }, nativeVisible, visible && !obscured).then(() => {
        // Reveal the live view before releasing its renderer preview.
        if (session.active && nativeVisible && !obscured) setPresentation((value) => value.preview ? { ...value, preview: null } : value);
      }).catch(() => {});
    });
  }, [id, nativeVisible, obscured, visible]);
  useLayoutEffect(() => {
    place();
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
    };
  }, [place]);
  useEffect(() => () => {
    void platform.napplet.setBounds(id, { x: 0, y: 0, width: 0, height: 0 }, false).catch(() => {});
  }, [id]);
  return <View ref={ref} onLayout={place} style={{ flex: 1 }}>
    {preview?.id === id ? <View style={StyleSheet.absoluteFill} pointerEvents="none"><Image key={preview.session.token} source={{ uri: preview.uri }} style={StyleSheet.absoluteFill}
      resizeMode="stretch" accessible={false}
      onError={() => { if (preview.session.active) setPresentation((value) => ({ ...value, preview: null })); }} /></View> : null}
  </View>;
}
