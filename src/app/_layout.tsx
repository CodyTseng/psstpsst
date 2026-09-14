import 'react-native-get-random-values';
import '../global.css';
import '@/i18n';
// Eagerly evaluate the background-task module so its `defineTask` runs on every
// bundle load — including a cold launch the OS triggers for the task itself.
import '@/services/notifications/background-task';

import { reloadAppAsync } from 'expo';
import Constants from 'expo-constants';
import {
  DarkTheme,
  DefaultTheme,
  type ErrorBoundaryProps,
  router,
  Stack,
  ThemeProvider,
  useSegments,
} from 'expo-router';
import type { Theme } from 'expo-router/react-navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  I18nManager,
  Platform,
  Text,
  View,
  type ViewProps,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AccountSwitchOverlay } from '@/components/account/AccountSwitchOverlay';
import { AppBootScreen } from '@/components/common/AppBootScreen';
import { AppErrorScreen } from '@/components/common/AppErrorScreen';
import { AppUpdatePromptHost } from '@/components/common/AppUpdatePromptHost';
import { ConfirmationDialogHost } from '@/components/common/ConfirmationDialogHost';
import { DesktopWindowFrame } from '@/components/common/DesktopWindowFrame';
import { KeySyncScreen } from '@/components/keysync/KeySyncScreen';
import { AppPasswordScreen } from '@/components/security/AppPasswordScreen';
import { Toast } from '@/components/common/Toast';
import { useAppMigrations } from '@/hooks/use-app-migrations';
import { useLanguageDirection } from '@/i18n/direction';
import { configurePlaybackAudio } from '@/lib/audio/audio-mode';
import { createPerfSpan, profileAsync, startEventLoopLagMonitor } from '@/lib/perf/profiler';
import { normalizeDesktopDeepLink } from '@/lib/navigation/desktop-deep-link';
import { IS_ELECTRON } from '@/lib/platform';
import { platform, type AppStateStatus } from '@/platform';
import { notificationService } from '@/services/notifications/notification.service';
import {
  exportAppErrorDiagnostics,
  recordAppError,
} from '@/services/diagnostics/app-error-diagnostics.service';
import { unreadCountService } from '@/services/conversation/unread-count.service';
import { proximityService } from '@/services/proximity/proximity.service';
import { cleanupInterruptedBackupArtifacts } from '@/services/dm/dm-backup-storage';
import { useActiveAccount } from '@/stores/active-account.store';
import { useChatPrefsStore } from '@/stores/chat-prefs.store';
import { useDraftsStore } from '@/stores/drafts.store';
import { useLanguageStore } from '@/stores/language.store';
import { usePendingAttachmentsStore } from '@/stores/pending-attachments.store';
import { useReactionPrefsStore } from '@/stores/reaction-prefs.store';
import { useDesktopLayoutStore } from '@/stores/desktop-layout.store';
import { useThemeStore } from '@/stores/theme.store';
import {
  SystemColorSchemeProvider,
  useEffectiveColorScheme,
  useThemeColors,
} from '@/theme';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { t } = useTranslation();
  const segments = useSegments();
  const route = segments.join('/') || 'root';
  const [repeated, setRepeated] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void recordAppError({
      errorName: error.name || 'Error',
      stack: error.stack,
      route,
      appVersion: Constants.expoConfig?.version ?? 'unknown',
      build: String(
        Platform.OS === 'ios'
          ? (Constants.expoConfig?.ios?.buildNumber ?? 'unknown')
          : (Constants.expoConfig?.android?.versionCode ?? 'unknown'),
      ),
      platform: Platform.OS,
      platformVersion: String(Platform.Version),
    }).then((count) => {
      if (active) setRepeated(count > 1);
    });
    return () => {
      active = false;
    };
  }, [error, route]);

  async function run(action: () => Promise<void> | void) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (actionError) {
      console.warn('[error-boundary] Recovery action failed.', actionError);
    } finally {
      setBusy(false);
    }
  }

  function retryRoute() {
    void run(retry);
  }

  function returnHome() {
    void run(async () => {
      if (router.canDismiss()) router.dismissAll();
      router.replace('/');
      await retry();
    });
  }

  function exportDiagnostics() {
    void run(async () => {
      const uri = await exportAppErrorDiagnostics();
      if (!uri || !(await platform.sharing.isAvailable())) return;
      await platform.sharing.share(uri);
    });
  }

  return (
    <SystemColorSchemeProvider>
      <SafeAreaProvider>
        <AppErrorScreen
          title={t('error.unexpected_title')}
          message={t('error.unexpected_message')}
          retryLabel={t('common.try_again')}
          homeLabel={t('error.return_to_chats')}
          exportLabel={t('error.export_diagnostics')}
          repeated={repeated}
          busy={busy}
          onRetry={retryRoute}
          onHome={returnHome}
          onExport={exportDiagnostics}
        />
      </SafeAreaProvider>
    </SystemColorSchemeProvider>
  );
}

export default function RootLayout() {
  const direction = useLanguageDirection();
  const webDirectionProps = { dir: direction } as unknown as ViewProps;
  // The desktop frame (theme-matched window title bar) wraps every branch of
  // the app — boot, gates, and the navigator — so the window chrome is always
  // present and draggable; other runtimes render children untouched.
  return (
    <SystemColorSchemeProvider>
      <View {...webDirectionProps} style={{ flex: 1, direction }}>
        <DesktopWindowFrame>
          {/* Keep native event owners mounted while account gates replace screens.
              In particular, dismissing a focused onboarding input must not tear
              down the keyboard animation listeners during its final frames. */}
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <SafeAreaProvider>
                <RootLayoutContent />
              </SafeAreaProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </DesktopWindowFrame>
      </View>
    </SystemColorSchemeProvider>
  );
}

function RootLayoutContent() {
  const { t } = useTranslation();
  const { success: migrationsApplied, error: migrationError } = useAppMigrations();
  const loadFromStorage = useActiveAccount((s) => s.loadFromStorage);
  const status = useActiveAccount((s) => s.status);
  const activePubkey = useActiveAccount((s) => s.activePubkey);
  const bootstrapError = useActiveAccount((s) => s.error);
  const bootPhase = useActiveAccount((s) => s.bootPhase);
  const switchingTo = useActiveAccount((s) => s.switchingTo);
  const desktopLayoutLoaded = useDesktopLayoutStore((s) => s.loaded);
  const layoutReady = !IS_ELECTRON || desktopLayoutLoaded;
  const themeLoaded = useThemeStore((s) => s.loaded);
  const languageLoaded = useLanguageStore((s) => s.loaded);
  const direction = useLanguageDirection();
  const c = useThemeColors();
  const effectiveColorScheme = useEffectiveColorScheme();
  const navigationTheme = useMemo<Theme>(() => {
    const base = effectiveColorScheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: c.accent,
        background: c.background,
        card: c.background,
        text: c.text,
        border: c.border,
        notification: c.notification,
      },
    };
  }, [c, effectiveColorScheme]);
  const [secureStorageAccess, setSecureStorageAccess] = useState<
    'loading' | 'ready' | 'setup' | 'unlock' | 'error'
  >('loading');
  const secureStorageReady = secureStorageAccess === 'ready';
  const isExpoGo = Constants.executionEnvironment === 'storeClient';
  const nativeDirectionMatches = I18nManager.getConstants().isRTL === (direction === 'rtl');
  // Expo Go owns the host process and cannot persist a project's forced native
  // direction. The root `dir`/`direction` still gives it a usable preview.
  const nativeDirectionReady = Platform.OS === 'web' || isExpoGo || nativeDirectionMatches;

  useEffect(() => {
    if (!languageLoaded || Platform.OS === 'web' || isExpoGo || nativeDirectionMatches) return;
    const shouldUseRTL = direction === 'rtl';
    I18nManager.allowRTL(shouldUseRTL);
    I18nManager.forceRTL(shouldUseRTL);
    void reloadAppAsync('Apply language layout direction').catch((error) => {
      console.warn('[language] Failed to reload for layout direction.', error);
    });
  }, [direction, isExpoGo, languageLoaded, nativeDirectionMatches]);

  useEffect(() => {
    if (!IS_ELECTRON) return;
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--psstpsst-scrollbar-thumb', c.border);
    return () => {
      rootStyle.removeProperty('--psstpsst-scrollbar-thumb');
    };
  }, [c.border]);

  useEffect(() => {
    let active = true;
    void platform.secureStorage
      .accessStatus()
      .then((access) => {
        if (!active) return;
        setSecureStorageAccess(
          access === 'available'
            ? 'ready'
            : access === 'password_setup_required'
              ? 'setup'
              : 'unlock',
        );
      })
      .catch(() => {
        if (active) setSecureStorageAccess('error');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    startEventLoopLagMonitor('app');
  }, []);

  useEffect(() => {
    if (status !== 'ready') return;
    let active = true;
    const consume = async () => {
      const value = await platform.deepLink.takePendingUrl();
      if (!active || !value) return;
      const route = normalizeDesktopDeepLink(value);
      if (route) router.navigate(route as never);
    };
    const consumeSafely = () => {
      void consume().catch((error) => {
        console.warn('[deep-link] Failed to consume a pending URL.', error);
      });
    };
    const remove = platform.deepLink.addListener(consumeSafely);
    consumeSafely();
    return () => {
      active = false;
      remove();
    };
  }, [status]);

  useEffect(() => {
    cleanupInterruptedBackupArtifacts().catch((error) => {
      console.error('[backup] Failed to clean interrupted export files', error);
    });
  }, []);

  // Read persisted preferences after migrations create their SQLite table and
  // before app content paints, so the first frame has the right palette and
  // language. Legacy keychain values are moved into SQLite by these reads.
  useEffect(() => {
    if (!migrationsApplied || !secureStorageReady) return;
    const profile = createPerfSpan('app.startupPrefs');
    void Promise.all([
      ...(IS_ELECTRON ? [profileAsync(profile, 'desktopLayout.load', () => useDesktopLayoutStore.getState().load())] : []),
      profileAsync(profile, 'theme.load', () => useThemeStore.getState().load()),
      // Language preference — also gated (see below), so the first frame is already
      // in the chosen language rather than flashing the system default.
      profileAsync(profile, 'language.load', () => useLanguageStore.getState().load()),
      // Composer preference (Enter-to-send) — a plain device pref; read once so the
      // chat input picks it up. No render gating: the default (Enter = newline) is
      // correct until the stored value settles.
      profileAsync(profile, 'chatPrefs.load', () => useChatPrefsStore.getState().load()),
      // Quick-reaction set — a plain device pref; read once so the long-press
      // pill shows the user's chosen emoji. Default set is correct until it lands.
      profileAsync(profile, 'reactionPrefs.load', () => useReactionPrefsStore.getState().load()),
    ])
      .catch((error) => {
        console.warn('[preferences] Failed to restore startup preferences.', error);
      })
      .finally(() => profile?.end());
  }, [migrationsApplied, secureStorageReady]);

  // Default the audio session to playback that ignores the hardware silent
  // switch, so voice messages and the recorder preview play even on silent
  // (like every messenger). Setting the mode only configures the category — it
  // doesn't activate/interrupt anything until a clip actually plays.
  useEffect(() => {
    void configurePlaybackAudio();
  }, []);

  // Load the active account's composer drafts and durable failed uploads into
  // their in-memory read models. Re-runs on account switch; each store replaces
  // its account-scoped view after migrations have created the backing tables.
  useEffect(() => {
    if (!migrationsApplied || !activePubkey) return;
    void useDraftsStore.getState().load(activePubkey).catch((error) => {
      console.warn('[drafts] Failed to restore message drafts.', error);
    });
    void usePendingAttachmentsStore.getState().load(activePubkey).catch((error) => {
      console.warn('[attachments] Failed to restore pending uploads.', error);
    });
  }, [activePubkey, migrationsApplied]);

  // A previously initialized Nearby identity stays discoverable while the app
  // is foregrounded. Each foreground session also performs one bounded scan so
  // known peers reconnect without opening Nearby; screens independently extend
  // that into retry or continuous scanning. A never-used account remains fully
  // radio-silent so its first Bluetooth prompt can only originate in Nearby.
  useEffect(() => {
    if (!migrationsApplied || !activePubkey || status !== 'ready') return;
    const sync = (state: AppStateStatus) => {
      if (state !== 'active' && state !== 'background') return;
      void proximityService.setForegroundState(activePubkey, state === 'active').catch(() => {});
    };
    const initialState = platform.appState.currentState();
    void proximityService
      .setForegroundState(
        activePubkey,
        initialState !== 'background' && initialState !== 'extension',
      )
      .catch(() => {});
    const removeAppStateListener = platform.appState.addChangeListener(sync);
    return () => {
      removeAppStateListener();
      void proximityService.setForegroundState(activePubkey, false).catch(() => {});
    };
  }, [activePubkey, migrationsApplied, status]);

  // On an account *switch*, reset the navigator to the Chats home while the switch
  // overlay still covers the screen, so the new account always lands on its inbox —
  // not on whatever the previous account left on top (a chat, settings, a profile).
  // Two reasons it has to be done here: (1) the switch deliberately keeps the
  // navigator mounted to crossfade `AccountSwitchOverlay` over it, so — unlike a
  // cold launch / first sign-in, which unmount the navigator behind the boot screen
  // and so reset to the initial route for free — the stale stack would otherwise
  // survive; (2) clearing the stack stops Android's hardware Back from walking into
  // the previous account's screens afterwards. Fires at switch *start* (`switchingTo`
  // set) so the reset settles under the opaque overlay and is revealed as the Chats
  // list. `'/'` is the Chats home; `canDismiss` guards the no-stack case (switching
  // from the Chats tab itself). Mirrors the `dismissAll()` + `navigate('/')` idiom
  // used to return to the inbox elsewhere (e.g. a graduated request in `chat/[key]`).
  useEffect(() => {
    if (!switchingTo) return;
    if (router.canDismiss()) router.dismissAll();
    router.navigate('/');
  }, [switchingTo]);

  useEffect(() => {
    if (migrationsApplied && secureStorageReady) {
      void loadFromStorage();
    }
  }, [migrationsApplied, loadFromStorage, secureStorageReady]);

  // One service-owned read model drives every unread surface. It follows the
  // settled active account and listens directly for conversation-row changes,
  // so platform chrome does not depend on whether a particular screen mounted.
  useEffect(() => {
    if (!migrationsApplied || !secureStorageReady || status !== 'ready') return;
    unreadCountService.setActiveAccount(activePubkey);
  }, [activePubkey, migrationsApplied, secureStorageReady, status]);

  // Start the local-notification listener once (idempotent). Safe before an
  // account loads — it no-ops until there's an active account and an incoming
  // message; the DB it reads is ready once migrations have applied.
  useEffect(() => {
    if (migrationsApplied && secureStorageReady) {
      const profile = createPerfSpan('app.notificationInit');
      void profileAsync(profile, 'notification.init', () => notificationService.init())
        .catch((error) => {
          console.warn('[notifications] Failed to initialize notifications.', error);
        })
        .finally(() => profile?.end());
    }
  }, [migrationsApplied, secureStorageReady]);

  if (secureStorageAccess === 'setup' || secureStorageAccess === 'unlock') {
    return (
      <AppPasswordScreen
        mode={secureStorageAccess}
        onUnlocked={() => setSecureStorageAccess('ready')}
      />
    );
  }

  if (secureStorageAccess === 'error') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text>{t('secure_storage.failed')}</Text>
      </View>
    );
  }

  if (migrationError) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text>{t('error.migration_failed', { error: String(migrationError) })}</Text>
      </View>
    );
  }

  // A switch keeps the navigator mounted and crossfades the `AccountSwitchOverlay`
  // over it (rendered below), so don't fall into the full-screen boot branch for
  // it — only for a genuine cold load (launch / first sign-in), where there's no
  // outgoing screen to fade from.
  if (
    (!migrationsApplied ||
      !secureStorageReady ||
      !layoutReady ||
      !themeLoaded ||
      !languageLoaded ||
      !nativeDirectionReady ||
      status === 'idle' ||
      status === 'loading') &&
    !switchingTo
  ) {
    // Local setup (migrations + persisted prefs) hasn't settled yet → "preparing".
    // Once that's done we're in account bootstrap, so name its current phase
    // (falling back to the same generic "preparing" before the first phase lands —
    // both are local work, so one calm line covers them without alarming copy).
    const phase =
      !migrationsApplied || !layoutReady || !themeLoaded || !languageLoaded || !nativeDirectionReady
        ? 'preparing'
        : (bootPhase ?? 'preparing');
    return <AppBootScreen message={t(`boot.${phase}`)} />;
  }

  if (status === 'error') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text>{t('error.bootstrap_failed', { error: bootstrapError ?? 'unknown' })}</Text>
      </View>
    );
  }

  return (
    <>
      <ThemeProvider value={navigationTheme}>
        {status === 'need_sync' ? (
          <KeySyncScreen />
        ) : (
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: c.background },
            }}
          />
        )}
      </ThemeProvider>
      {/* Global toast overlay — above the navigator so it survives the
          back-navigation that triggers it (e.g. after forwarding). */}
      <Toast />
      {/* Account-switch transition — crossfades over the navigator while a
          switch is in flight, so the swap never hard-cuts. Topmost. */}
      <AccountSwitchOverlay />
      {/* Electron confirmation/notice dialogs — presented in-app so button
          roles (danger/primary) follow the design system; native message
          boxes can't tint a destructive action. Self-gates on IS_ELECTRON. */}
      <ConfirmationDialogHost />
      {/* Electron updates require separate download and install consent. */}
      <AppUpdatePromptHost />
    </>
  );
}
