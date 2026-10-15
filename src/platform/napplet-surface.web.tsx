import { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { platform } from './index';

export function NappletSurface({ id, visible }: { id: string; visible: boolean }) {
  const ref = useRef<View>(null);
  const place = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => {
      void platform.napplet.setBounds(id, { x, y, width, height }, visible).catch(() => {});
    });
  }, [id, visible]);
  useEffect(() => {
    place();
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      void platform.napplet
        .setBounds(id, { x: 0, y: 0, width: 0, height: 0 }, false)
        .catch(() => {});
    };
  }, [id, place]);
  return <View ref={ref} onLayout={place} style={{ flex: 1 }} />;
}
