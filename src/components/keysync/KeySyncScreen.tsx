import CircleCheck from 'lucide-react-native/icons/circle-check';
import { Refresh as RefreshCw } from '@solar-icons/react-native/category/arrows/Linear/Refresh';
import { Smartphone } from '@solar-icons/react-native/category/devices/Linear/Smartphone';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { ActionRow } from '@/components/common/ActionRow';
import { AppButton } from '@/components/common/AppButton';
import { AppContentColumn } from '@/components/common/AppContentColumn';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { PairingCodeBlock } from '@/components/keysync/PairingCodeBlock';
import { platform } from '@/platform';
import { buildSigner, setAccountEncryptionPubkey } from '@/services/account/account.service';
import {
  generateEncryptionKeypair,
  publishEncryptionKeyAnnouncement,
} from '@/services/dm/encryption-key.service';
import { KeySyncSession } from '@/services/dm/key-sync-session';
import { ownKeyAnnouncementRelays } from '@/services/relay/relay-list.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { iconStrokeWidth } from '@/theme/icons';
import { useThemeColors } from '@/theme';

type SyncState = 'publishing' | 'waiting' | 'success' | 'error';

/**
 * Shown (via the root layout) when an account has an encryption-key
 * announcement on the network but no local privkey — i.e. a new device that
 * must receive the key from an existing one. Publishes a client-key request
 * (kind 4454), shows a pairing code, and waits for the key transfer (4455).
 */
export function KeySyncScreen() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const pubkey = useActiveAccount((s) => s.syncTargetPubkey);
  const completeSync = useActiveAccount((s) => s.completeSync);
  const signOut = useActiveAccount((s) => s.signOut);

  const [state, setState] = useState<SyncState>('publishing');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const sessionRef = useRef<KeySyncSession | null>(null);

  const start = useCallback(async () => {
    if (!pubkey) return;
    setError(null);
    setState('publishing');
    let session = sessionRef.current;
    if (!session) {
      session = new KeySyncSession({
        accountPubkey: pubkey,
        onCode: setCode,
        onTransfer: () => {
          if (sessionRef.current !== session) return;
          sessionRef.current = null;
          setState('success');
          setTimeout(() => {
            void completeSync();
          }, 800);
        },
        onRejected: () => {
          if (sessionRef.current !== session) return;
          setError(t('key_sync.transfer_rejected'));
          setState('error');
        },
      });
      sessionRef.current = session;
    }
    try {
      await session.request();
      if (sessionRef.current !== session) return;
      setState('waiting');
    } catch {
      if (sessionRef.current !== session) return;
      setError(t('key_sync.request_failed'));
      setState('error');
    }
  }, [pubkey, completeSync, t]);

  useEffect(() => {
    const timer = setTimeout(() => void start(), 0);
    return () => {
      clearTimeout(timer);
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, [start]);

  async function doReset() {
    if (!pubkey) return;
    setResetting(true);
    try {
      const signer = await buildSigner(pubkey);
      const keyRelays = await ownKeyAnnouncementRelays(pubkey);
      // Generate a fresh key — it's prepended as the new current key (older keys
      // stay in the list); no separate archive step.
      const kp = await generateEncryptionKeypair(pubkey);
      await setAccountEncryptionPubkey(pubkey, kp.pubkey);
      await publishEncryptionKeyAnnouncement({
        signer,
        encryptionPubkey: kp.pubkey,
        relays: keyRelays,
      });
      await completeSync();
    } catch (e) {
      setError((e as Error).message);
      setState('error');
      setResetting(false);
    }
  }

  function confirmReset() {
    void platform.confirmationDialog
      .confirm({
        title: t('key_sync.reset_title'),
        message: t('key_sync.reset_message'),
        cancelLabel: t('common.cancel'),
        confirmLabel: t('key_sync.reset_confirm'),
        destructive: true,
      })
      .then((confirmed) => {
        if (confirmed) void doReset();
      });
  }

  async function exitToSignIn() {
    if (signingOut) return;
    setSigningOut(true);
    sessionRef.current?.close();
    sessionRef.current = null;
    try {
      await signOut();
      router.replace('/welcome');
    } catch {
      setError(t('key_sync.exit_failed'));
      setState('error');
      setSigningOut(false);
    }
  }

  if (state === 'success') {
    return (
      <AppScreen>
        <AppContentColumn>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <CircleCheck strokeWidth={iconStrokeWidth.default} size={48} color={c.success} />
            <AppText variant="title" weight="semibold">
              {t('key_sync.success_title')}
            </AppText>
          </View>
        </AppContentColumn>
      </AppScreen>
    );
  }

  return (
    <AppScreen>
      <AppContentColumn>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 16,
            paddingTop: 40,
            paddingBottom: 24,
          }}
        >
          <View style={{ alignItems: 'center', gap: 12 }}>
            <Smartphone size={36} color={c.textMuted} />
            <View style={{ gap: 6, alignItems: 'center' }}>
              <AppText variant="title" weight="semibold" align="center">
                {t('key_sync.title')}
              </AppText>
              <AppText variant="body" tone="muted" align="center">
                {t('key_sync.subtitle')}
              </AppText>
            </View>
          </View>

          <PairingCodeBlock
            label={t('key_sync.pairing_code')}
            code={code}
            emphasis="hero"
            style={{ width: '100%', marginTop: 28 }}
          >
            <AppText variant="caption" tone="muted" align="center">
              {t('key_sync.pairing_hint')}
            </AppText>
          </PairingCodeBlock>

          <View
            style={{
              minHeight: 24,
              marginTop: 20,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {state === 'waiting' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator color={c.textMuted} />
                <AppText variant="caption" tone="muted">
                  {t('key_sync.waiting')}
                </AppText>
              </View>
            ) : state === 'error' && error ? (
              <AppText variant="caption" tone="muted" align="center">
                {error}
              </AppText>
            ) : null}
          </View>

          <View style={{ marginTop: 20 }}>
            <AppButton
              label={t('key_sync.retry')}
              variant="primary"
              size="lg"
              iconLeft={<RefreshCw size={16} color={c.accentForeground} />}
              loading={state === 'publishing'}
              disabled={signingOut}
              onPress={() => void start()}
            />
          </View>

          <View style={{ flex: 1, minHeight: 32 }} />

          <View style={{ gap: 12 }}>
            <AppText variant="caption" tone="muted" align="center">
              {t('key_sync.reset_hint')}
            </AppText>
            <ActionRow
              layout="vertical"
              dismiss={{
                label: t('account.sign_out'),
                loading: signingOut,
                disabled: resetting,
                onPress: () => void exitToSignIn(),
              }}
              confirm={{
                label: t('key_sync.reset_action'),
                destructive: true,
                loading: resetting,
                disabled: signingOut,
                onPress: confirmReset,
              }}
            />
          </View>
        </ScrollView>
      </AppContentColumn>
    </AppScreen>
  );
}
