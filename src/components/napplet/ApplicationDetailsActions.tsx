import { useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
import Copy from 'lucide-react-native/icons/copy';
import { Share } from '@solar-icons/react-native/category/ui/Linear/Share';
import { useTranslation } from 'react-i18next';
import { HeaderActionMenu, HEADER_ACTION_MENU_ICON_SIZE, type HeaderActionMenuAnchor } from '@/components/common/HeaderActionMenu';
import { IconButton } from '@/components/common/IconButton';
import { useClipboard } from '@/hooks/use-clipboard';
import { applicationShareLink, type ExploreEntry } from '@/services/explore/model';
import { showToast } from '@/stores/toast.store';
import { iconStrokeWidth, spacing, uiDensity, useThemeColors } from '@/theme';

export function ApplicationDetailsActions({ entry, onShare }: { entry: ExploreEntry; onShare?: () => void }) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const trigger = useRef<View>(null);
  const [anchor, setAnchor] = useState<HeaderActionMenuAnchor | null>(null);
  const { copyText } = useClipboard({ trackCopied: false, toastTarget: 'detail' });
  const size = HEADER_ACTION_MENU_ICON_SIZE;
  return <View ref={trigger} collapsable={false}>
    <IconButton size={uiDensity.headerActionSize} accessibilityLabel={t('napplets.more')}
      icon={<Ellipsis size={uiDensity.headerActionIconSize} strokeWidth={iconStrokeWidth.default} color={colors.text} />}
      onPress={() => trigger.current?.measureInWindow((x, y, width, height) => setAnchor({
        x: x + width, y: Platform.OS === 'android' ? y : y + height + spacing.xs,
      }))} />
    <HeaderActionMenu visible={anchor !== null} anchor={anchor} onClose={() => setAnchor(null)} items={[
      { key: 'copy', title: t('common.copy'), icon: <Copy size={size} strokeWidth={iconStrokeWidth.default} color={colors.text} />,
        onPress: () => { void copyText(applicationShareLink(entry)).then(copied => {
          if (copied) showToast(t('common.copied'), { target: 'detail' });
        }); } },
      ...(onShare ? [{ key: 'share', title: t('share.title'), icon: <Share size={size} color={colors.text} />, onPress: onShare }] : []),
    ]} />
  </View>;
}
