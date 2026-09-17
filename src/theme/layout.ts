import { DESKTOP_OS } from '@/lib/platform';

/** Responsive two-pane shell geometry. These are layout dimensions rather than
 * spacing values. Touch layouts retain a wider primary pane, while Electron
 * gives more of the window to the active detail surface. */
export const wideLayout = {
  minWidth: 600,
  minHeight: 600,
  primaryFraction: 0.4,
  primaryMinWidth: 280,
  primaryMaxWidth: 420,
  primaryDesktopWidth: 320,
  primaryDesktopMinWidth: 280,
  detailDesktopMinWidth: 280,
  paneResizeHandleWidth: 8,
  paneResizeKeyboardStep: 16,
  onboardingArtworkWidth: '44%',
  onboardingArtworkMaxWidth: 480,
} as const;

/** Maximum widths for surfaces that should not stretch with the window. */
export const contentWidth = {
  focused: 480,
  compactSheet: 480,
  sheet: 640,
  toast: 480,
  dialog: 320,
} as const;

/** Responsive conversation-media gallery geometry shared across runtimes. */
export const mediaGrid = {
  minColumns: 3,
} as const;

/** Bottom chrome geometry outside the fixed 56px control row. */
export const bottomChrome = {
  mobileFallbackInset: 12,
} as const;

/** Electron window chrome: the renderer-drawn title bar above the app. The
 * height is mirrored by `TITLEBAR_OVERLAY_HEIGHT` in `desktop/main.ts` — keep
 * the two in sync. */
export const desktopChrome = {
  titlebarHeight: DESKTOP_OS === 'darwin' ? 28 : 40,
} as const;

/** Mobile remains touch-roomy; Electron uses a tighter information density. */
export const density = {
  mobile: {
    headerHeight: 56,
    bottomBarHeight: 56,
    searchBarHeight: 40,
    conversationRowHeight: 72,
    conversationAvatarSize: 44,
    inAppNotificationAvatarSize: 32,
    conversationStatusIconSize: 18,
    headerActionSize: 40,
    headerActionIconSize: 24,
    composerActionSize: 40,
    tabIconSize: 24,
    iconButtonSize: 36,
    inputHeight: 48,
    multilineInputMinHeight: 96,
    inputHorizontalPadding: 14,
    cardPadding: 16,
    segmentedControlHeight: 40,
    toggleTrackWidth: 50,
    toggleTrackHeight: 30,
    contactRowHeight: 56,
    contactAvatarSize: 40,
    sectionHeaderHeight: 34,
    chatNoticeVerticalPadding: 10,
    listRowHeight: 56,
    listRowTwoLineHeight: 64,
    listRowHorizontalPadding: 18,
    listRowIconGap: 14,
    profileActionSize: 56,
    profileActionWidth: 64,
    settingsIdentityAvatarSize: 64,
    settingsIdentityPadding: 14,
    settingsIdentityGap: 14,
    detailRowHorizontalPadding: 14,
    detailRowVerticalPadding: 11,
    mediaGridMinCellSize: 144,
    accentSwatchSize: 44,
    accentSwatchDotSize: 34,
    selectedRecipientAvatarSize: 48,
    selectedRecipientWidth: 56,
    shareRecipientSummaryAvatarSize: 32,
    countBadge: {
      sm: { size: 18, horizontalPadding: 4 },
      md: { size: 20, horizontalPadding: 6 },
    },
    button: {
      sm: { height: 36, horizontalPadding: 14 },
      md: { height: 46, horizontalPadding: 18 },
      lg: { height: 52, horizontalPadding: 22 },
      xl: { height: 64, horizontalPadding: 22 },
    },
  },
  desktop: {
    headerHeight: 52,
    bottomBarHeight: 56,
    searchBarHeight: 36,
    conversationRowHeight: 64,
    conversationAvatarSize: 40,
    inAppNotificationAvatarSize: 32,
    conversationStatusIconSize: 16,
    headerActionSize: 36,
    headerActionIconSize: 20,
    composerActionSize: 40,
    tabIconSize: 20,
    iconButtonSize: 32,
    inputHeight: 40,
    multilineInputMinHeight: 80,
    inputHorizontalPadding: 12,
    cardPadding: 12,
    segmentedControlHeight: 36,
    toggleTrackWidth: 44,
    toggleTrackHeight: 26,
    contactRowHeight: 48,
    contactAvatarSize: 36,
    sectionHeaderHeight: 32,
    chatNoticeVerticalPadding: 10,
    listRowHeight: 48,
    listRowTwoLineHeight: 56,
    listRowHorizontalPadding: 16,
    listRowIconGap: 12,
    profileActionSize: 48,
    profileActionWidth: 56,
    settingsIdentityAvatarSize: 52,
    settingsIdentityPadding: 12,
    settingsIdentityGap: 12,
    detailRowHorizontalPadding: 12,
    detailRowVerticalPadding: 8,
    mediaGridMinCellSize: 128,
    accentSwatchSize: 36,
    accentSwatchDotSize: 28,
    selectedRecipientAvatarSize: 40,
    selectedRecipientWidth: 48,
    shareRecipientSummaryAvatarSize: 28,
    countBadge: {
      sm: { size: 16, horizontalPadding: 4 },
      md: { size: 20, horizontalPadding: 6 },
    },
    button: {
      sm: { height: 32, horizontalPadding: 12 },
      md: { height: 40, horizontalPadding: 16 },
      lg: { height: 44, horizontalPadding: 16 },
      xl: { height: 56, horizontalPadding: 16 },
    },
  },
} as const;
