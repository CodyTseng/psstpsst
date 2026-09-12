import { router, Tabs } from 'expo-router';
import { PlatformPressable } from 'expo-router/build/react-navigation/elements';
import { ChatRound as ChatRoundBold } from '@solar-icons/react-native/category/messages/Bold/ChatRound';
import { ChatRound as ChatRoundLinear } from '@solar-icons/react-native/category/messages/Linear/ChatRound';
import { UserCircle as UserCircleBold } from '@solar-icons/react-native/category/users/Bold/UserCircle';
import { UserCircle as UserCircleLinear } from '@solar-icons/react-native/category/users/Linear/UserCircle';
import { type ComponentProps, type ComponentType, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountSwitcherSheet } from '@/components/account/AccountSwitcherSheet';
import { AccountTabIcon } from '@/components/account/AccountTabIcon';
import { ChromeBackdrop } from '@/components/common/ChromeBackdrop';
import { SCREENSHOT_UNREAD_COUNT } from '@/components/marketing/screenshot-preview-data';
import { TabIconWithBadge } from '@/components/navigation/tab-icon-with-badge';
import { PrimaryPaneNavigationProvider } from '@/components/navigation/primary-pane-navigation';
import { useTotalUnread, useUnreadRequestCount } from '@/hooks/use-conversations';
import { getBottomChromeInset } from '@/lib/layout/bottom-chrome';
import { isWideLayoutSize } from '@/lib/layout/wide-layout';
import { useIsRTL } from '@/i18n/direction';
import { type DesktopContextMenuEvent, IS_ELECTRON } from '@/lib/platform';
import { useActiveAccount } from '@/stores/active-account.store';
import { useScreenshotPreviewStore } from '@/stores/screenshot-preview.store';
import {
  bottomBarHeight,
  fontWeight,
  spacing,
  typography,
  uiDensity,
  useThemeColors,
} from '@/theme';

export default function TabsLayout() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const isRTL = useIsRTL();
  const insets = useSafeAreaInsets();
  const bottomInset = getBottomChromeInset(insets.bottom);
  const { width, height } = useWindowDimensions();
  const wide = isWideLayoutSize(width, height);
  const accountPubkey = useActiveAccount((s) => s.activePubkey) ?? '';
  const screenshotPreviewEnabled = useScreenshotPreviewStore((state) => state.enabled);
  const screenshotReadUnreadCount = useScreenshotPreviewStore((state) => state.readUnreadCount);
  // Chats badge = total unread messages; Contacts badge = people with unread
  // pending requests (a read-but-unanswered request stays listed but no longer
  // contributes to the badge).
  const totalUnread = useTotalUnread(accountPubkey);
  const displayedTotalUnread = screenshotPreviewEnabled
    ? Math.max(0, SCREENSHOT_UNREAD_COUNT - screenshotReadUnreadCount)
    : totalUnread;
  const unreadRequestCount = useUnreadRequestCount(accountPubkey);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <PrimaryPaneNavigationProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: c.accent,
          tabBarInactiveTintColor: c.textMuted,
          // React Navigation enables an Android ripple by default. Keep tab
          // feedback limited to the selected icon and tint on every runtime.
          tabBarButton: QuietTabBarButton,
          tabBarStyle: {
            backgroundColor: 'transparent',
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.border,
            // React Navigation adds Android elevation to bottom tabs by default.
            // Keep this edge identical to the app's other chrome hairlines.
            elevation: 0,
            boxShadow: 'none',
            position: 'absolute',
            // Pin to the shared bottom-bar height (+ safe area) so the tab bar and
            // the chat composer's input row are exactly the same height. Breathing
            // room above the icon keeps the iOS/WeChat feel; label stays `micro`.
            height: bottomBarHeight + bottomInset,
            paddingTop: IS_ELECTRON ? 0 : spacing.sm,
            paddingBottom: bottomInset,
            // React Navigation safely pads both sides for a full-width bottom
            // bar. In the persistent primary pane only its physical outer edge
            // needs that inset; the pane divider is not a device safe area.
            paddingLeft: wide && isRTL ? 0 : insets.left,
            paddingRight: wide && !isRTL ? 0 : insets.right,
          },
          tabBarBackground: () => <ChromeBackdrop scrollbarOcclusion="bottom" />,
          tabBarLabelStyle: {
            fontSize: typography.micro.fontSize,
            lineHeight: IS_ELECTRON ? typography.micro.lineHeight : undefined,
            fontWeight: fontWeight.medium,
            fontFamily: typography.micro.fontFamily,
          },
          // Lift the complete item as one unit so icon, label, and either badge
          // keep their relative geometry while the bar height/safe area stay fixed.
          tabBarItemStyle: {
            transform: [{ translateY: IS_ELECTRON ? 0 : -spacing.xs }],
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('tabs.conversations'),
            tabBarIcon: ({ color, focused, size }) => {
              const Icon = focused ? ChatRoundBold : ChatRoundLinear;
              const iconSize = IS_ELECTRON ? uiDensity.tabIconSize : size;
              return (
                <TabIconWithBadge count={displayedTotalUnread}>
                  <Icon
                    color={color as string}
                    size={iconSize}
                    style={focused ? styles.selectedTabIcon : undefined}
                  />
                </TabIconWithBadge>
              );
            },
          }}
        />
        <Tabs.Screen
          name="contacts"
          options={{
            title: t('tabs.contacts'),
            tabBarIcon: ({ color, focused, size }) => {
              const Icon = focused ? UserCircleBold : UserCircleLinear;
              const iconSize = IS_ELECTRON ? uiDensity.tabIconSize : size;
              return (
                <TabIconWithBadge count={unreadRequestCount}>
                  <Icon
                    color={color as string}
                    size={iconSize}
                    style={focused ? styles.selectedTabIcon : undefined}
                  />
                </TabIconWithBadge>
              );
            },
          }}
        />
        <Tabs.Screen
          name="me"
          listeners={{
            tabLongPress: () => setSwitcherOpen(true),
          }}
          options={{
            title: t('tabs.me'),
            // Electron adds a right-click entry to the account switcher,
            // mirroring the long-press entry; the button is otherwise the
            // default PlatformPressable.
            tabBarButton: IS_ELECTRON
              ? (props) => (
                  <MeTabBarButton {...props} onOpenSwitcher={() => setSwitcherOpen(true)} />
                )
              : QuietTabBarButton,
            tabBarIcon: ({ focused, size }) => {
              const iconSize = IS_ELECTRON ? uiDensity.tabIconSize : size;
              return <AccountTabIcon focused={focused} size={iconSize} />;
            },
          }}
        />
      </Tabs>

      <AccountSwitcherSheet
        visible={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        onAddAccount={() => router.push('/welcome')}
      />
    </PrimaryPaneNavigationProvider>
  );
}

const styles = StyleSheet.create({
  selectedTabIcon: {
    transform: [{ scale: 1.06 }],
  },
});

function QuietTabBarButton(props: ComponentProps<typeof PlatformPressable>) {
  return <PlatformPressable {...props} pressColor="transparent" />;
}

type DesktopTabBarPressableProps = ComponentProps<typeof PlatformPressable> & {
  /** React Native Web forwards this browser event, but the shared prop types
   * don't expose it (same cast as `DesktopPressable` in ConversationListItem). */
  onContextMenu?: (event: DesktopContextMenuEvent) => void;
};

type MeTabBarButtonProps = DesktopTabBarPressableProps & {
  onOpenSwitcher: () => void;
};

const DesktopTabBarPressable = PlatformPressable as ComponentType<DesktopTabBarPressableProps>;

/** The Electron Me tab button: the default tab button plus a right-click entry
 * to the account switcher, mirroring the touch long-press. */
function MeTabBarButton({ onOpenSwitcher, ...props }: MeTabBarButtonProps) {
  return (
    <DesktopTabBarPressable
      {...props}
      onContextMenu={(event: DesktopContextMenuEvent) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        onOpenSwitcher();
      }}
    />
  );
}
