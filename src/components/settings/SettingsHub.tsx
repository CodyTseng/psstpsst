import { router, useNavigation } from 'expo-router';
import Constants from 'expo-constants';
import { TransferHorizontal as ArrowLeftRight } from '@solar-icons/react-native/category/arrows/Linear/TransferHorizontal';
import { DirectionalChevron as ChevronRight } from '@/components/common/DirectionalChevron';
import { Bell } from '@solar-icons/react-native/category/notifications/Linear/Bell';
import { ChatRound as MessageCircle } from '@solar-icons/react-native/category/messages/Linear/ChatRound';
import { Wallet } from '@solar-icons/react-native/category/money/Linear/Wallet';
import { Sun2 as SunMoon } from '@solar-icons/react-native/category/weather/Linear/Sun2';
import { CloudUpload } from '@solar-icons/react-native/category/weather/Linear/CloudUpload';
import { Database } from '@solar-icons/react-native/category/ui/Linear/Database';
import { ForbiddenCircle as Ban } from '@solar-icons/react-native/category/ui/Linear/ForbiddenCircle';
import { InfoCircle } from '@solar-icons/react-native/category/ui/Linear/InfoCircle';
import { Camera } from '@solar-icons/react-native/category/video/Linear/Camera';
import { QrCode } from '@solar-icons/react-native/category/security/Linear/QrCode';
import { ServerSquare } from '@solar-icons/react-native/category/devices/Linear/ServerSquare';
import Languages from 'lucide-react-native/icons/languages';
import { UserCircle as CircleUserRound } from '@solar-icons/react-native/category/users/Linear/UserCircle';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountSwitcherSheet } from '@/components/account/AccountSwitcherSheet';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { IconButton } from '@/components/common/IconButton';
import { ListGroup } from '@/components/common/ListGroup';
import { InteractionOverlay } from '@/components/common/InteractionOverlay';
import { ListRow } from '@/components/common/ListRow';
import { MiddleEllipsizedText } from '@/components/common/MiddleEllipsizedText';
import { ScreenHeader } from '@/components/common/ScreenHeader';
import { usePrimaryPaneNavigation } from '@/components/navigation/primary-pane-navigation';
import { Nip05Label } from '@/components/profile/Nip05Label';
import { NpubQrSheet } from '@/components/profile/NpubQrSheet';
import { useProfile } from '@/hooks/use-profile';
import { useScrolled } from '@/hooks/use-scrolled';
import { useWidePaneSelection } from '@/hooks/use-wide-pane-selection';
import { IS_DEVELOPMENT_BUILD } from '@/lib/environment';
import { resolveName } from '@/lib/nostr/display-name';
import { pubkeyToNpub } from '@/lib/nostr/keys';
import { useActiveAccount } from '@/stores/active-account.store';
import { useScreenshotPreviewStore } from '@/stores/screenshot-preview.store';
import { iconStrokeWidth } from '@/theme/icons';
import { bottomBarHeight, headerHeight, radius, spacing, uiDensity, useThemeColors } from '@/theme';

export function SettingsHub() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const topClearance = headerHeight + insets.top;
  const activePubkey = useActiveAccount((s) => s.activePubkey);
  const screenshotPreviewEnabled = useScreenshotPreviewStore((state) => state.enabled);
  const setScreenshotPreviewEnabled = useScreenshotPreviewStore((state) => state.setEnabled);
  const profile = useProfile(activePubkey);
  const navigation = useNavigation();
  const scrollRef = useRef<ScrollView>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const selection = useWidePaneSelection();
  const { open: openInDetailPane } = usePrimaryPaneNavigation();
  // Header gains a bottom hairline once the content scrolls under it.
  const { scrolled, scrollProps } = useScrolled();

  const npub = activePubkey ? pubkeyToNpub(activePubkey) : '—';
  const name = resolveName(profile) ?? t('profile.unnamed');
  const profileActive = selection.profilePubkey === activePubkey;
  const appVersion = Constants.expoConfig?.version;

  useEffect(() => {
    return navigation.addListener('tabPress' as never, () => {
      // The press that switches into this tab also fires `tabPress`; only a
      // re-press of the already-selected tab scrolls to top.
      const tabState = navigation.getState();
      const selectedTab = tabState?.index != null ? tabState.routes[tabState.index] : undefined;
      if (selectedTab?.name !== 'me') return;
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, [navigation]);

  function openMyProfile() {
    if (activePubkey) openInDetailPane(`/profile/${encodeURIComponent(activePubkey)}`);
  }

  const chevron = <ChevronRight size={18} color={c.textMuted} />;

  return (
    <AppScreen edges={[]}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: topClearance + spacing.sm,
          paddingBottom: bottomBarHeight + insets.bottom + spacing['2xl'],
          gap: spacing.xl,
        }}
        {...scrollProps}
      >
        {/* profile header — tap to open My Profile */}
        <Pressable
          onPress={openMyProfile}
          pressFeedback="delayed"
          fallbackHoverOpacity={false}
          accessibilityState={{ selected: profileActive }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: uiDensity.settingsIdentityGap,
            padding: uiDensity.settingsIdentityPadding,
            borderRadius: radius.lg,
            backgroundColor: c.surfaceElevated,
          }}
        >
          {({ pressed }) => (
            <>
              {pressed || profileActive ? (
                <InteractionOverlay borderRadius={radius.lg} />
              ) : null}
              <Avatar
                pubkey={activePubkey ?? ''}
                picture={profile?.picture}
                name={name}
                size={uiDensity.settingsIdentityAvatarSize}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="subtitle" weight="semibold" numberOfLines={1}>
                  {name}
                </AppText>
                {profile?.nip05 && activePubkey ? (
                  <Nip05Label nip05={profile.nip05} pubkey={activePubkey} />
                ) : null}
                <MiddleEllipsizedText
                  value={npub}
                  color={c.textMuted}
                  variant="caption"
                />
              </View>
              <IconButton
                variant="plain"
                size={36}
                onPress={() => setQrOpen(true)}
                hitSlop={6}
                icon={<QrCode size={20} color={c.accent} />}
                accessibilityLabel={t('profile.show_qr')}
              />
            </>
          )}
        </Pressable>

        {/* Groups are separated by spacing alone (Signal-style), no section
            headings — the row labels + icons are self-explanatory. Account sits
            at the top (with the identity card), data at the bottom. */}
        <ListGroup>
          <ListRow
            icon={<ArrowLeftRight size={22} color={c.text} />}
            title={t('account.switch')}
            onPress={() => setSwitcherOpen(true)}
          />
          <ListRow
            icon={<CircleUserRound size={22} color={c.text} />}
            title={t('settings.account')}
            trailing={chevron}
            onPress={() => openInDetailPane('/account')}
            active={selection.settingsItem === 'account'}
          />
          <ListRow
            icon={<Ban size={22} color={c.text} />}
            title={t('settings.blocked_users')}
            trailing={chevron}
            onPress={() => openInDetailPane('/blocked-users')}
            active={selection.settingsItem === 'blocked-users'}
          />
        </ListGroup>

        <ListGroup>
          <ListRow
            icon={<Wallet size={22} color={c.text} />}
            title={t('wallet.title')}
            trailing={chevron}
            onPress={() => openInDetailPane('/wallet')}
            active={selection.settingsItem === 'wallet'}
          />
          <ListRow
            icon={<MessageCircle size={22} color={c.text} />}
            title={t('settings.chats')}
            trailing={chevron}
            onPress={() => openInDetailPane('/chats')}
            active={selection.settingsItem === 'chats'}
          />
          <ListRow
            icon={<Bell size={22} color={c.text} />}
            title={t('settings.notifications')}
            trailing={chevron}
            onPress={() => openInDetailPane('/notifications')}
            active={selection.settingsItem === 'notifications'}
          />
          <ListRow
            icon={<SunMoon size={22} color={c.text} />}
            title={t('settings.appearance')}
            trailing={chevron}
            onPress={() => openInDetailPane('/appearance')}
            active={selection.settingsItem === 'appearance'}
          />
          <ListRow
            icon={<Languages size={22} strokeWidth={iconStrokeWidth.default} color={c.text} />}
            title={t('settings.language')}
            trailing={chevron}
            onPress={() => openInDetailPane('/language')}
            active={selection.settingsItem === 'language'}
          />
        </ListGroup>

        <ListGroup>
          <ListRow
            icon={<ServerSquare size={22} color={c.text} />}
            title={t('relays.page_title')}
            trailing={chevron}
            onPress={() => openInDetailPane('/relays')}
            active={selection.settingsItem === 'relays'}
          />
          <ListRow
            icon={<CloudUpload size={22} color={c.text} />}
            title={t('settings.media_servers')}
            trailing={chevron}
            onPress={() => openInDetailPane('/media-servers')}
            active={selection.settingsItem === 'media-servers'}
          />
        </ListGroup>

        <ListGroup>
          <ListRow
            icon={<Database size={22} color={c.text} />}
            title={t('backup.section')}
            trailing={chevron}
            onPress={() => openInDetailPane('/data')}
            active={selection.settingsItem === 'data'}
          />
        </ListGroup>

        <ListGroup>
          {IS_DEVELOPMENT_BUILD ? (
            <ListRow
              icon={<Camera size={22} color={c.text} />}
              title={t(
                screenshotPreviewEnabled
                  ? 'settings.screenshot_preview_exit'
                  : 'settings.screenshot_preview',
              )}
              trailing={chevron}
              onPress={() => {
                setScreenshotPreviewEnabled(!screenshotPreviewEnabled);
                if (router.canDismiss()) router.dismissAll();
                router.navigate(screenshotPreviewEnabled ? '/me' : '/');
              }}
            />
          ) : null}
          <ListRow
            icon={<InfoCircle size={22} color={c.text} />}
            title={t('settings.about')}
            value={appVersion}
            trailing={chevron}
            onPress={() => openInDetailPane('/about')}
            active={selection.settingsItem === 'about'}
          />
        </ListGroup>

      </ScrollView>

      <NpubQrSheet
        visible={qrOpen}
        onClose={() => setQrOpen(false)}
        npub={npub}
        name={resolveName(profile) ?? ''}
        nip05={profile?.nip05}
      />

      <AccountSwitcherSheet
        visible={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        onAddAccount={() => router.push('/welcome')}
      />
      <ScreenHeader back={false} bordered={scrolled} title={t('tabs.me')} />
    </AppScreen>
  );
}
