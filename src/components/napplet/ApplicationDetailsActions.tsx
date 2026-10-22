import { useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
import Copy from 'lucide-react-native/icons/copy';
import Star from 'lucide-react-native/icons/star';
import { ShieldCheck } from '@solar-icons/react-native/category/security/Linear/ShieldCheck';
import { router } from 'expo-router';
import { useExplore } from '@/stores/explore.store';
import { useApplicationFavorite } from '@/hooks/use-application-favorite';
import { exploreService } from '@/services/explore/service';
import { Share } from '@solar-icons/react-native/category/ui/Linear/Share';
import { useTranslation } from 'react-i18next';
import { HeaderActionMenu, HEADER_ACTION_MENU_ICON_SIZE, type HeaderActionMenuAnchor } from '@/components/common/HeaderActionMenu';
import { IconButton } from '@/components/common/IconButton';
import { useClipboard } from '@/hooks/use-clipboard';
import { applicationCopyAddress, type ExploreEntry } from '@/services/explore/model';
import { showToast } from '@/stores/toast.store';
import { iconStrokeWidth, spacing, uiDensity, useThemeColors } from '@/theme';

export function ApplicationDetailsActions({ entry, account, onShare }: { entry: ExploreEntry; account?: string | null; onShare?: () => void }) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const state = useExplore();
  const owner = account === undefined ? state.account : account;
  const ready = !!owner && state.account === owner && state.loaded;
  const saved = ready ? state.entries.find(app => app.key === entry.key) : undefined;
  const favorite = saved?.desktopPosition != null;
  const failed = () => showToast(t('napplets.request_failed'), { target: 'detail' });
  const setFavorite = useApplicationFavorite(owner, 'detail');
  const trigger = useRef<View>(null);
  const [anchor, setAnchor] = useState<HeaderActionMenuAnchor | null>(null);
  const { copyText } = useClipboard({ trackCopied: false, toastTarget: 'detail' });
  const size = HEADER_ACTION_MENU_ICON_SIZE;
  async function openMenu() {
    if (owner && !ready) await exploreService.activate(owner);
    trigger.current?.measureInWindow((x, y, width, height) => setAnchor({
      x: x + width, y: Platform.OS === 'android' ? y : y + height + spacing.xs,
    }));
  }
  return <View ref={trigger} collapsable={false}>
    <IconButton size={uiDensity.headerActionSize} accessibilityLabel={t('napplets.more')}
      icon={<Ellipsis size={uiDensity.headerActionIconSize} strokeWidth={iconStrokeWidth.default} color={colors.text} />}
      onPress={() => { void openMenu().catch(failed); }} />
    <HeaderActionMenu visible={anchor !== null} anchor={anchor} onClose={() => setAnchor(null)} items={[
      { key: 'copy', title: t('common.copy'), icon: <Copy size={size} strokeWidth={iconStrokeWidth.default} color={colors.text} />,
        onPress: () => { void copyText(applicationCopyAddress(entry)).then(copied => {
          if (copied) showToast(t('common.copied'), { target: 'detail' });
        }); } },
      { key: 'permissions', title: t('napplets.permissions_manage'), icon: <ShieldCheck size={size} color={colors.text} />,
        onPress: () => router.push(entry.release ? `/napplet-permissions/${entry.release.event.id}` : `/explore-details?key=${encodeURIComponent(entry.key)}&permissions=1`) },
      ...(onShare ? [{ key: 'share', title: t('share.title'), icon: <Share size={size} color={colors.text} />, onPress: onShare }] : []),
      ...(ready ? [{ key: 'favorite', title: t(favorite ? 'napplets.remove_from_desktop' : 'napplets.add_to_desktop'),
        icon: <Star size={size} strokeWidth={iconStrokeWidth.default} color={colors.text} />,
        onPress: () => { void setFavorite(saved ?? entry, !favorite); } }] : []),
    ]} />
  </View>;
}
