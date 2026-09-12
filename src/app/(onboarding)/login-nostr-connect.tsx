import { router } from 'expo-router';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import { DirectionalChevron as ChevronRight } from '@/components/common/DirectionalChevron';
import Check from 'lucide-react-native/icons/check';
import { Copy } from '@solar-icons/react-native/category/ui/Linear/Copy';
import X from 'lucide-react-native/icons/x';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  View,
} from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppFormScrollView } from '@/components/common/AppFormScrollView';
import { AppButton } from '@/components/common/AppButton';
import { AppCard } from '@/components/common/AppCard';
import { AppContentColumn } from '@/components/common/AppContentColumn';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import { OnboardingFormLayout } from '@/components/onboarding/OnboardingFormLayout';
import Plus from 'lucide-react-native/icons/plus';
import { setStringAsync } from '@/lib/clipboard';
import { QrCode } from '@/components/common/QrCode';
import { platform } from '@/platform';
import { SectionLabel } from '@/components/common/SectionLabel';
import { normalizeRelayUrl } from '@/lib/nostr/relay-url';
import {
  NIP46_DEFAULT_RELAYS,
  startNostrConnect,
} from '@/services/signer/nip46-connect.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useScrolled } from '@/hooks/use-scrolled';
import { iconStrokeWidth } from '@/theme/icons';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

const QR_SIZE = 220;

export default function LoginNostrConnect() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const c = useThemeColors();
  const setActive = useActiveAccount((s) => s.setActive);

  const [attempt, setAttempt] = useState(0);
  const [errored, setErrored] = useState(false);
  const [copied, setCopied] = useState(false);

  // Advanced: which relays the connection URI advertises. Changing the set
  // re-mints the session below (the relays are baked into the URI).
  const [relays, setRelays] = useState<string[]>(() => [...NIP46_DEFAULT_RELAYS]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [newRelay, setNewRelay] = useState('');
  const [relayError, setRelayError] = useState<string | null>(null);

  // Mint a fresh nostrconnect:// session per attempt / relay set. Construction is
  // pure (keys + URI, no I/O), so it derives cleanly in render; the relay wait
  // runs in the effect below.
  const session = useMemo(() => {
    void attempt; // re-mint a fresh session whenever the user retries
    return startNostrConnect({ relays });
  }, [attempt, relays]);
  const uri = session.uri;

  // Wait for the signer to connect back. Cancelling on unmount / retry / relay
  // change aborts the in-flight wait so it doesn't leak a relay subscription.
  useEffect(() => {
    let active = true;
    session
      .waitForConnection()
      .then(async ({ pubkey }) => {
        if (!active) return;
        await setActive(pubkey);
        router.replace('/');
      })
      .catch(() => {
        if (active) setErrored(true);
      });
    return () => {
      active = false;
      session.cancel();
    };
  }, [session, setActive]);

  function handleRetry() {
    setErrored(false);
    setAttempt((n) => n + 1);
  }

  async function handleCopy() {
    await setStringAsync(uri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleOpen() {
    void platform.urlOpener.openExternalUrl(uri).catch(() => {});
  }

  function handleAddRelay() {
    setRelayError(null);
    const raw = newRelay.trim();
    if (!raw) return;
    let normalized: string;
    try {
      normalized = normalizeRelayUrl(raw.startsWith('ws') ? raw : `wss://${raw}`);
    } catch (e) {
      setRelayError((e as Error).message);
      return;
    }
    if (relays.includes(normalized)) {
      setRelayError(t('relays.duplicate'));
      return;
    }
    setRelays([...relays, normalized]);
    setNewRelay('');
  }

  function handleRemoveRelay(url: string) {
    // Keep at least one relay — an empty set has nowhere for the signer to meet.
    if (relays.length <= 1) return;
    setRelays(relays.filter((r) => r !== url));
  }

  return (
    <AppScreen edges={['bottom']}>
      <OnboardingFormLayout bordered={scrolled} title={t('login.nostr_connect.title')}>
        <AppContentColumn>
          <AppFormScrollView
            {...scrollProps}
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.sm,
              paddingBottom: spacing.xl,
              gap: spacing.xl,
              alignItems: 'center',
            }}
            keyboardShouldPersistTaps="handled"
          >
            <AppText variant="body" tone="muted" align="center">
              {t('login.nostr_connect.subtitle')}
            </AppText>

            {/* The QR tile stays white in any theme for scanner contrast (functional,
                not theming — like NpubShareCard). `onOverlay` is the sanctioned
                always-white token. Tapping it opens a signer installed on-device. */}
            <Pressable
              onPress={handleOpen}
              accessibilityRole="link"
              style={{
                backgroundColor: c.onOverlay,
                borderRadius: radius.xl,
                padding: spacing.lg,
              }}
            >
              <QrCode data={uri} size={QR_SIZE} />
            </Pressable>

            <View style={{ alignSelf: 'stretch' }}>
              <AppButton
                label={copied ? t('login.nostr_connect.copied') : t('login.nostr_connect.copy')}
                variant="secondary"
                size="lg"
                iconLeft={
                  copied ? (
                    <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.success} />
                  ) : (
                    <Copy size={18} color={c.text} />
                  )
                }
                onPress={handleCopy}
              />
            </View>

            {errored ? (
              <View
                style={{ alignSelf: 'stretch', gap: spacing.sm, alignItems: 'center' }}
              >
                <AppText variant="caption" tone="danger" align="center">
                  {t('login.nostr_connect.error')}
                </AppText>
                <AppButton
                  label={t('common.retry')}
                  variant="ghost"
                  size="md"
                  onPress={handleRetry}
                />
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <ActivityIndicator color={c.textMuted} />
                <AppText variant="caption" tone="muted">
                  {t('login.nostr_connect.waiting')}
                </AppText>
              </View>
            )}

            {/* Advanced: relay set the connection URI advertises. A calm
                disclosure that reveals a single grouped panel — not floating cards. */}
            <View style={{ alignSelf: 'stretch', gap: spacing.md }}>
              <Pressable
                onPress={() => setShowAdvanced((v) => !v)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  alignSelf: 'flex-start',
                  gap: spacing.xs,
                }}
              >
                {showAdvanced ? (
                  <ChevronDown strokeWidth={iconStrokeWidth.default} size={16} color={c.textMuted} />
                ) : (
                  <ChevronRight size={16} color={c.textMuted} />
                )}
                <AppText variant="caption" tone="muted" weight="medium">
                  {t('login.nostr_connect.advanced')}
                </AppText>
              </Pressable>

              {showAdvanced ? (
                <AppCard variant="muted" style={{ gap: spacing.md }}>
                  <SectionLabel>{t('login.nostr_connect.relays_label')}</SectionLabel>

                  <View style={{ gap: spacing.sm }}>
                    {relays.map((url) => (
                      <View
                        key={url}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
                      >
                        <AppText variant="code" numberOfLines={1} style={{ flex: 1 }}>
                          {url}
                        </AppText>
                        <IconButton
                          onPress={() => handleRemoveRelay(url)}
                          hitSlop={spacing.sm}
                          size={28}
                          disabled={relays.length <= 1}
                          icon={<X strokeWidth={iconStrokeWidth.default} size={16} color={c.textMuted} />}
                        />
                      </View>
                    ))}
                  </View>

                  <AppInput
                    placeholder="wss://server.example.com"
                    value={newRelay}
                    onChangeText={setNewRelay}
                    autoCapitalize="none"
                    autoCorrect={false}
                    error={relayError ?? undefined}
                    onSubmitEditing={handleAddRelay}
                    trailingAccessory={
                      <IconButton
                        variant="accent"
                        shape="square"
                        size={uiDensity.inputHeight}
                        onPress={handleAddRelay}
                        disabled={!newRelay.trim()}
                        icon={
                          <Plus
                            strokeWidth={iconStrokeWidth.default}
                            size={20}
                            color={newRelay.trim() ? c.accentForeground : c.textMuted}
                          />
                        }
                      />
                    }
                  />
                </AppCard>
              ) : null}
            </View>
          </AppFormScrollView>
        </AppContentColumn>
      </OnboardingFormLayout>
    </AppScreen>
  );
}
