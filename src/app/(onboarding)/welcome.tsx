import { router } from 'expo-router';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppBrandMark } from '@/components/common/AppBrandMark';
import { AppButton } from '@/components/common/AppButton';
import { AppContentColumn } from '@/components/common/AppContentColumn';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { useImmersiveDesktopTitlebar } from '@/components/common/DesktopWindowFrame';
import { EdgeFade } from '@/components/common/EdgeFade';
import { InteractionOverlay } from '@/components/common/InteractionOverlay';
import { LegalLinks } from '@/components/common/LegalLinks';
import { OrDivider } from '@/components/common/OrDivider';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SectionLabel } from '@/components/common/SectionLabel';
import { OnboardingArtwork } from '@/components/onboarding/OnboardingArtwork';
import { useAccountList } from '@/hooks/use-account-list';
import { useProfilesMap } from '@/hooks/use-profile';
import { useDirectionalIconStyle } from '@/i18n/direction';
import { resolveName } from '@/lib/nostr/display-name';
import { abbreviateNpub } from '@/lib/nostr/format';
import { pubkeyToNpub } from '@/lib/nostr/keys';
import { isWideLayoutSize } from '@/lib/layout/wide-layout';
import { IS_ELECTRON } from '@/lib/platform';
import { useActiveAccount } from '@/stores/active-account.store';
import { iconStrokeWidth } from '@/theme/icons';
import {
  desktopChrome,
  spacing,
  uiDensity,
  useThemeColors,
} from '@/theme';

// Height of the soft fade at each end of the account list, and the matching
// scroll-content inset so the first/last row still clears the fade at rest.
const FADE_H = 24;
const WELCOME_BRAND_MARK_SIZE = 48;
const WELCOME_ARTWORK_BRAND_MARK_SIZE = 64;

function WelcomeBackButton() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const directionalIconStyle = useDirectionalIconStyle();

  return (
    <View
      ref={(node) => {
        // Exclude only this button from the artwork's native window drag region.
        if (IS_ELECTRON) {
          (node as unknown as HTMLElement | null)?.style.setProperty('-webkit-app-region', 'no-drag');
        }
      }}
    >
      <AppButton
        variant="ghost"
        fullWidth={false}
        corner="full"
        compact
        onPress={() => router.back()}
        accessibilityLabel={t('common.back')}
        iconLeft={
          <ChevronLeft
            strokeWidth={iconStrokeWidth.default}
            size={uiDensity.headerActionIconSize}
            color={c.onOverlay}
            style={directionalIconStyle}
          />
        }
      />
    </View>
  );
}

export default function Welcome() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const accounts = useAccountList();
  const activePubkey = useActiveAccount((s) => s.activePubkey);
  const setActive = useActiveAccount((s) => s.setActive);
  const profiles = useProfilesMap(accounts.map((a) => a.pubkey));
  // Reached as the first-run screen (nothing to go back to) *or* pushed from the
  // account switcher to add another account — only then is there a back target,
  // so only then do we show a way to cancel out.
  const canCancel = router.canGoBack();
  // When signed out (after a log out) with accounts still on the device, offer to
  // re-enter one directly — not just the sign-in options. Hidden while logged in
  // (the add-account push), where the intent is specifically a *new* account.
  const showAccounts = !activePubkey && accounts.length > 0;
  const titleClearance = useScreenHeaderClearance();
  const { width, height } = useWindowDimensions();
  const wide = isWideLayoutSize(width, height);
  const immersiveTitlebar = wide || !showAccounts;
  const titlebarClearance = immersiveTitlebar && IS_ELECTRON ? desktopChrome.titlebarHeight : 0;
  useImmersiveDesktopTitlebar(!wide && !showAccounts);

  function enterAccount(pubkey: string) {
    void setActive(pubkey);
    router.replace('/');
  }

  function renderAccountRows() {
    return accounts.map((account) => {
      const profile = profiles[account.pubkey];
      const name = resolveName(profile) ?? t('profile.unnamed');
      const npub = abbreviateNpub(pubkeyToNpub(account.pubkey));
      return (
        <Pressable
          key={account.pubkey}
          pressFeedback="delayed"
          fallbackHoverOpacity={false}
          onPress={() => enterAccount(account.pubkey)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: uiDensity.listRowIconGap,
            minHeight: uiDensity.listRowTwoLineHeight,
            paddingVertical:
              (uiDensity.listRowTwoLineHeight - uiDensity.conversationAvatarSize) / 2,
            paddingHorizontal: uiDensity.listRowHorizontalPadding,
            borderRadius: 14,
            backgroundColor: c.surfaceElevated,
            marginBottom: 8,
          }}
        >
          {({ pressed }) => (
            <>
              {pressed ? <InteractionOverlay borderRadius={14} /> : null}
              <Avatar
                pubkey={account.pubkey}
                picture={profile?.picture}
                name={name}
                size={uiDensity.conversationAvatarSize}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="body" weight="semibold" numberOfLines={1}>
                  {name}
                </AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1}>
                  {npub}
                </AppText>
              </View>
            </>
          )}
        </Pressable>
      );
    });
  }

  /** Scrollable account list with soft edge fades dissolving the rows. */
  function renderAccountList() {
    return (
      <>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: FADE_H, paddingBottom: FADE_H }}
        >
          {renderAccountRows()}
        </ScrollView>
        <EdgeFade edge="top" color={c.background} height={FADE_H} />
        <EdgeFade edge="bottom" color={c.background} height={FADE_H} />
      </>
    );
  }

  if (showAccounts && wide) {
    // Wide layout mirrors the sign-in hero: centered bounded column, brand row
    // up top, the account list shrinking to fit (and scrolling when long), and
    // the same actions block at the shared focused-form width.
    return (
      <AppScreen edges={['bottom']}>
        <AppContentColumn
          fill
          style={{
            justifyContent: 'center',
            gap: spacing['2xl'],
            paddingHorizontal: spacing['2xl'],
            paddingVertical: spacing['3xl'],
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.sm,
            }}
          >
            <AppBrandMark size={WELCOME_BRAND_MARK_SIZE} />
            <AppText variant="title" weight="semibold">
              {t('welcome.title')}
            </AppText>
          </View>

          <View style={{ flexShrink: 1, minHeight: 0, width: '100%' }}>
            <SectionLabel>{t('account.switch_title')}</SectionLabel>
            <View style={{ flexShrink: 1, minHeight: 0, position: 'relative' }}>
              {renderAccountList()}
            </View>
          </View>

          <View style={{ gap: spacing.md }}>
            <OrDivider label={t('common.or')} />
            <AppButton
              label={t('welcome.login_nsec')}
              variant="primary"
              size="md"
              onPress={() => router.push('/login-nsec')}
            />
            <AppButton
              label={t('welcome.create_new')}
              variant="secondary"
              size="md"
              onPress={() => router.push('/generate')}
            />
            <AppButton
              label={t('welcome.login_remote')}
              variant="ghost"
              size="md"
              onPress={() => router.push('/login-bunker')}
            />
            <LegalLinks />
          </View>
        </AppContentColumn>
        {canCancel ? (
          <ScreenHeader
            overMedia
            topOffset={IS_ELECTRON ? desktopChrome.titlebarHeight : 0}
          />
        ) : null}
      </AppScreen>
    );
  }

  if (showAccounts) {
    return (
      <AppScreen edges={['bottom']}>
        <AppContentColumn>
        {/* Brand mark remains page content; navigation chrome stays in ScreenHeader. */}
        <View
          style={{
            alignItems: 'center',
            paddingHorizontal: spacing.lg,
            paddingTop: titleClearance + titlebarClearance + spacing.sm,
            paddingBottom: spacing.md,
          }}
        >
          <AppBrandMark />
        </View>

        {/* Account list — fills the middle and scrolls when long, so the actions
            below never get pushed off-screen. Soft top/bottom fades dissolve the
            rows into the screen at the scroll edges, with matching content insets
            so the first/last row still clears the fade at rest. */}
        <View style={{ flex: 1, paddingHorizontal: 16 }}>
          <SectionLabel>{t('account.switch_title')}</SectionLabel>
          <View style={{ flex: 1, position: 'relative' }}>
            {renderAccountList()}
          </View>
        </View>

        {/* Actions — fixed at the bottom; original button colours. */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 16, paddingTop: 4, gap: 10 }}>
          <OrDivider label={t('common.or')} />
          <AppButton
            label={t('welcome.login_nsec')}
            variant="primary"
            size="lg"
            onPress={() => router.push('/login-nsec')}
          />
          <AppButton
            label={t('welcome.create_new')}
            variant="secondary"
            size="lg"
            onPress={() => router.push('/generate')}
          />
          <AppButton
            label={t('welcome.login_remote')}
            variant="ghost"
            size="lg"
            onPress={() => router.push('/login-bunker')}
          />
          <LegalLinks />
        </View>
        </AppContentColumn>
        <ScreenHeader
          back={false}
          title={t('welcome.choose_title')}
          topOffset={titlebarClearance}
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen edges={canCancel ? ['bottom'] : ['top', 'bottom']}>
      <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column' }}>
        {/* Artwork blends directly into the page canvas. */}
        {wide ? null : (
          <View style={{ flex: 1 }}>
            <OnboardingArtwork wide={false} fadeColor={c.background} />
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  // Center the lockup at 38% of the artwork height.
                  bottom: '24%',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: spacing.lg,
                },
              ]}
            >
              {/* Account for the SVG's built-in whitespace below the visible mark. */}
              <View style={{ marginBottom: -spacing.xs }}>
                <AppBrandMark size={WELCOME_ARTWORK_BRAND_MARK_SIZE} tone="overlay" />
              </View>
              <AppText variant="title" weight="semibold" align="center" style={{ color: c.onOverlay }}>
                {t('welcome.title')}
              </AppText>
            </View>
          </View>
        )}

        <View
          style={{
            flex: wide ? 1 : undefined,
            width: wide ? undefined : '100%',
            minWidth: 0,
            backgroundColor: c.background,
          }}
        >
          <AppContentColumn
            fill={wide}
            style={
              wide
                ? {
                    justifyContent: 'center',
                    gap: spacing['3xl'],
                    paddingHorizontal: spacing['2xl'],
                    paddingVertical: spacing['3xl'],
                  }
                : {
                    gap: spacing.lg,
                    paddingHorizontal: spacing.lg,
                    paddingTop: spacing.lg,
                    paddingBottom: spacing.lg,
                }
            }
          >
            {wide ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: spacing.sm,
                }}
              >
                <AppBrandMark size={WELCOME_BRAND_MARK_SIZE} />
                <AppText variant="title" weight="semibold">
                  {t('welcome.title')}
                </AppText>
              </View>
            ) : null}

            {/* Actions */}
            <View style={{ gap: spacing.md }}>
              <AppButton
                label={t('welcome.login_nsec')}
                variant="primary"
                size={wide ? 'md' : 'lg'}
                onPress={() => router.push('/login-nsec')}
              />
              <AppButton
                label={t('welcome.create_new')}
                variant="secondary"
                size={wide ? 'md' : 'lg'}
                onPress={() => router.push('/generate')}
              />
              <AppButton
                label={t('welcome.login_remote')}
                variant="ghost"
                size={wide ? 'md' : 'lg'}
                onPress={() => router.push('/login-bunker')}
              />
              <LegalLinks />
            </View>
          </AppContentColumn>
        </View>
      </View>
      {canCancel ? (
        <ScreenHeader
          overMedia
          back={!(IS_ELECTRON && !wide)}
          left={IS_ELECTRON && !wide ? <WelcomeBackButton /> : undefined}
          topOffset={IS_ELECTRON ? desktopChrome.titlebarHeight : 0}
        />
      ) : null}
    </AppScreen>
  );
}
