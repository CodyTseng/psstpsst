import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { platform } from './index';

type CaptureSession = { active: boolean; token: number };
type Preview = { id: string; uri: string; session: CaptureSession };

export function NappletSurface({ id, visible, obscured = false }: { id: string; visible: boolean; obscured?: boolean }) {
  const ref = useRef<View>(null);
  const sessionRef = useRef<CaptureSession | null>(null);
  const sequence = useRef(0);
  const [presentation, setPresentation] = useState({ id, visible, obscured, preview: null as Preview | null, covered: false });
  if (presentation.id !== id || presentation.visible !== visible || presentation.obscured !== obscured) {
    setPresentation({ id, visible, obscured, covered: false, preview: visible && presentation.id === id ? presentation.preview : null });
  }
  const preview = presentation.preview;
  useEffect(() => {
    const session = { active: true, token: ++sequence.current };
    sessionRef.current = session;
    if (visible && obscured) {
      void platform.napplet.capture(id).then((uri) => {
        if (!session.active) return;
        setPresentation((value) => uri ? { ...value, preview: { id, uri, session } } : { ...value, covered: true });
      }).catch(() => { if (session.active) setPresentation((value) => ({ ...value, covered: true })); });
    }
    return () => { session.active = false; };
  }, [id, visible, obscured]);
  const nativeVisible = visible && (!obscured || !presentation.covered);
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
  useEffect(() => {
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
      onLoad={() => {
        const session = preview.session;
        // Keep the native view until the replacement image has crossed a paint boundary.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (session.active) setPresentation((value) => ({ ...value, covered: true }));
        }));
      }}
      onError={() => { if (preview.session.active) setPresentation((value) => ({ ...value, covered: true })); }} /></View> : null}
  </View>;
}
