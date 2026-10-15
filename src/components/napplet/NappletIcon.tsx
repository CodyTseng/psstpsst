import { memo, useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { Widget } from '@solar-icons/react-native/category/settings/Linear/Widget';
import { loadIcon } from '@/services/napplet/artifacts';
import type { NappletRelease } from '@/services/napplet/protocol';
import { radius, spacing, useThemeColors } from '@/theme';

export const NAPPLET_ICON_SIZE = spacing['3xl'] + spacing.lg;
export const NappletIcon = memo(function NappletIcon({ release, size = NAPPLET_ICON_SIZE }: { release: NappletRelease; size?: number }) {
  const c = useThemeColors();
  const [uri, setUri] = useState<string>();
  useEffect(() => {
    let active = true;
    setUri(undefined);
    void loadIcon(release).then((value) => {
      if (active) setUri(value);
    });
    return () => {
      active = false;
    };
  }, [release]);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.min(radius.xl, size / 4),
        backgroundColor: c.surfaceMuted,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {uri ? (
        <Image
          source={{ uri }}
          onError={() => setUri(undefined)}
          style={{ width: '100%', height: '100%' }}
        />
      ) : (
        <Widget size={spacing.xl} color={c.textMuted} />
      )}
    </View>
  );
});
