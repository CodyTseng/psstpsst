import * as Linking from 'expo-linking';
import { router, useFocusEffect } from 'expo-router';
import { DirectionalChevron as ChevronRight } from '@/components/common/DirectionalChevron';
import { Refresh as RefreshCw } from '@solar-icons/react-native/category/arrows/Linear/Refresh';
import { Radar } from '@solar-icons/react-native/category/map/Linear/Radar';
import { DangerCircle } from '@solar-icons/react-native/category/ui/Linear/DangerCircle';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Keyboard,
  ScrollView,
  type TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppButton } from '@/components/common/AppButton';
import { ActionRow } from '@/components/common/ActionRow';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { BottomSheet } from '@/components/common/BottomSheet';
import { IconButton } from '@/components/common/IconButton';
import { InputDialog } from '@/components/common/InputDialog';
import { ListGroup } from '@/components/common/ListGroup';
import { InteractionOverlay } from '@/components/common/InteractionOverlay';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SelfBadge } from '@/components/common/SelfBadge';
import { Toggle } from '@/components/common/Toggle';
import { NearbyPeerListItem } from '@/components/proximity/NearbyPeerListItem';
import {
  buildVisibleNearbyPeers,
  type VisibleNearbyPeer,
} from '@/components/proximity/nearby-peer-visibility';
import { NearbyOutgoingRequestSheet } from '@/components/proximity/nearby-outgoing-request-sheet';
import { useScrolled } from '@/hooks/use-scrolled';
import { useProximityIdentity, useProximityPeers } from '@/hooks/use-proximity';
import { isWideLayoutSize } from '@/lib/layout/wide-layout';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import { abbreviateNpub } from '@/lib/nostr/format';
import { pubkeyToNpub } from '@/lib/nostr/keys';
import { IS_ELECTRON } from '@/lib/platform';
import {
  normalizeProximityDisplayName,
  randomProximityDisplayName,
  sanitizeProximityDisplayNameInput,
} from '@/services/proximity/proximity-display-name';
import {
  ensureProximityIdentity,
  updateProximityDisplayName,
} from '@/services/proximity/proximity-identity.service';
import { getProximityEnabled } from '@/services/proximity/proximity-preferences';
import { proximityService } from '@/services/proximity/proximity.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useProximityStore } from '@/stores/proximity.store';
import type { NearbyPeer } from '@/stores/proximity.store';
import { showToast } from '@/stores/toast.store';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

type NearbyError = 'unavailable' | 'developmentBuildRequired';

function nearbyError(reason: unknown): NearbyError {
  return reason instanceof Error && reason.message.includes('development build')
    ? 'developmentBuildRequired'
    : 'unavailable';
}

function NearbyPeerRows({
  peers,
  onOpenPeer,
  onOpenProfile,
}: {
  peers: VisibleNearbyPeer[];
  onOpenPeer: (peer: VisibleNearbyPeer) => Promise<void>;
  onOpenProfile: (peer: VisibleNearbyPeer) => void;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();

  return (
    <View style={{ marginHorizontal: -spacing.lg }}>
      {peers.map((peer, index) => {
        const isTrusted = peer.relationshipStatus === 'trusted';
        const isConnected = isTrusted && peer.connectionStatus === 'connected';
        const secondaryText = isConnected
          ? t('nearby.message_ready')
          : !peer.signalFresh
            ? t('nearby.signal_unavailable')
            : peer.rssi === 0
              ? t('nearby.signal_measuring')
              : t('nearby.signal_strength', { rssi: peer.rssi });
        const value = isTrusted
          ? t(
              peer.connectionStatus === 'connected'
                ? 'nearby.list_connected'
                : peer.connectionStatus === 'connecting'
                  ? 'nearby.list_connecting'
                  : 'nearby.disconnected',
            )
          : undefined;
        return (
          <NearbyPeerListItem
            key={peer.proximityPubkey}
            pubkey={peer.proximityPubkey}
            displayName={peer.displayName}
            secondaryText={secondaryText}
            secondaryTone="muted"
            value={value}
            valueTone={
              peer.connectionStatus === 'connected'
                ? 'success'
                : peer.connectionStatus === 'connecting'
                  ? 'warning'
                  : 'muted'
            }
            infoIcon={
              isTrusted ? (
                <DangerCircle size={22} color={c.textMuted} />
              ) : undefined
            }
            infoAccessibilityLabel={t('nearby.view_details')}
            onInfoPress={
              isTrusted ? () => onOpenProfile(peer) : undefined
            }
            showSeparator={index < peers.length - 1}
            onPress={() => void onOpenPeer(peer)}
          />
        );
      })}
    </View>
  );
}

export default function NearbyPage() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const c = useThemeColors();
  const { width, height } = useWindowDimensions();
  const wideElectron = IS_ELECTRON && isWideLayoutSize(width, height);
  const top = useScreenHeaderClearance();
  const accountPubkey = useActiveAccount((state) => state.activePubkey) ?? '';
  const sessionPeers = useProximityStore((state) => state.peers);
  const discoveries = useProximityStore((state) => state.discoveries);
  const scanning = useProximityStore((state) => state.scanning);
  const bluetoothState = useProximityStore((state) => state.bluetoothState);
  const [error, setError] = useState<NearbyError | null>(null);
  const [permissionRequested, setPermissionRequested] = useState(false);
  const [starting, setStarting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [featureSetting, setFeatureSetting] = useState<{
    accountPubkey: string;
    enabled: boolean;
  } | null>(null);
  const [featureToggleBusy, setFeatureToggleBusy] = useState(false);
  const [nameEditorOpen, setNameEditorOpen] = useState(false);
  const sessionReadyRef = useRef(false);
  const focusedRef = useRef(false);
  const requestingPeersRef = useRef(new Set<string>());
  const [outgoingSheetPeer, setOutgoingSheetPeer] = useState<NearbyPeer | null>(null);

  const { identity, loaded: identityLoaded } = useProximityIdentity(accountPubkey);
  const featureEnabled =
    featureSetting?.accountPubkey === accountPubkey
      ? featureSetting.enabled
      : null;
  const canStart =
    identityLoaded &&
    featureEnabled === true &&
    (identity != null || permissionRequested);
  const { peers: storedPeers, loaded: storedPeersLoaded } = useProximityPeers(accountPubkey);
  const storedPeersByPubkey = useMemo(
    () => new Map((storedPeers ?? []).map((peer) => [peer.proximityPubkey, peer])),
    [storedPeers],
  );
  const blockedPeerCount = useMemo(
    () => (storedPeers ?? []).reduce((count, peer) => count + (peer.blockedAt != null ? 1 : 0), 0),
    [storedPeers],
  );
  const visibleLocalName = identity
    ? resolveDisplayName(identity.proximityPubkey, { displayName: identity.displayName })
    : '';

  useEffect(() => {
    if (!accountPubkey || identity?.accountPubkey !== accountPubkey) return;
    void ensureProximityIdentity(accountPubkey).catch(() => {});
  }, [accountPubkey, identity?.accountPubkey, identity?.proximityPubkey]);

  useEffect(() => {
    let cancelled = false;
    if (!accountPubkey) return;
    void getProximityEnabled(accountPubkey)
      .then((enabled) => {
        if (!cancelled) setFeatureSetting({ accountPubkey, enabled });
      })
      .catch(() => {
        if (!cancelled) setFeatureSetting({ accountPubkey, enabled: false });
      });
    return () => {
      cancelled = true;
    };
  }, [accountPubkey]);

  const acquireVisibleSession = useCallback(() => {
    if (!accountPubkey || !canStart || error) return;
    focusedRef.current = true;
    let release: (() => void) | null = null;
    let cancelled = false;
    void proximityService.acquire(accountPubkey, { continuousScan: true }).then((cleanup) => {
      if (cancelled) cleanup();
      else {
        release = cleanup;
        sessionReadyRef.current = true;
        if (useProximityStore.getState().bluetoothState !== 'unknown') setStarting(false);
        setError(null);
        setRetrying(false);
      }
    }).catch((reason: unknown) => {
      if (!cancelled) {
        setError(nearbyError(reason));
        setStarting(false);
        sessionReadyRef.current = false;
        setRetrying(false);
      }
    });
    return () => {
      focusedRef.current = false;
      cancelled = true;
      release?.();
    };
  }, [accountPubkey, canStart, error]);

  useFocusEffect(
    useCallback(() => {
      if (wideElectron) return;
      return acquireVisibleSession();
    }, [acquireVisibleSession, wideElectron]),
  );

  useEffect(() => {
    if (!wideElectron) return;
    return acquireVisibleSession();
  }, [acquireVisibleSession, wideElectron]);

  useEffect(() => {
    return useProximityStore.subscribe((state) => {
      if (sessionReadyRef.current && state.bluetoothState !== 'unknown') setStarting(false);
    });
  }, []);

  const peers = useMemo(() => {
    return buildVisibleNearbyPeers(discoveries, sessionPeers, storedPeersByPubkey);
  }, [discoveries, sessionPeers, storedPeersByPubkey]);
  const knownPeers = useMemo(
    () => peers.filter((peer) => peer.relationshipStatus === 'trusted'),
    [peers],
  );
  const nearbyPeers = useMemo(
    () => peers.filter((peer) => peer.relationshipStatus === 'unlinked'),
    [peers],
  );

  function enterChat(pubkey: string, name: string) {
    router.push({
      pathname: `/chat/${encodeURIComponent(pubkey)}`,
      params: { transport: 'proximity', name },
    });
  }

  async function openPeer(peer: VisibleNearbyPeer) {
    if (peer.relationshipStatus === 'trusted') {
      enterChat(peer.proximityPubkey, peer.displayName);
      return;
    }
    if (peer.deviceStatus === 'offline') return;
    setOutgoingSheetPeer(peer);
    if (requestingPeersRef.current.has(peer.proximityPubkey)) return;
    requestingPeersRef.current.add(peer.proximityPubkey);
    let result: 'accepted' | 'declined' | 'failed' | 'timeout';
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!focusedRef.current) return;
      result = await proximityService
        .requestChat(accountPubkey, peer.proximityPubkey)
        .catch(() => 'timeout' as const);
    } finally {
      requestingPeersRef.current.delete(peer.proximityPubkey);
      setOutgoingSheetPeer((current) =>
        current?.proximityPubkey === peer.proximityPubkey ? null : current,
      );
    }
    if (!focusedRef.current) return;
    if (result === 'accepted') {
      enterChat(peer.proximityPubkey, peer.displayName);
    } else if (result === 'declined') {
      showToast(t('nearby.request_declined'));
    } else if (result === 'failed') {
      showToast(t('nearby.request_failed'));
    } else {
      showToast(t('nearby.request_timeout'));
    }
  }

  function openPeerProfile(peer: VisibleNearbyPeer) {
    router.push({
      pathname: '/nearby-contact/[pubkey]',
      params: { pubkey: peer.proximityPubkey, name: peer.displayName },
    });
  }

  function retry() {
    if (retrying) return;
    setRetrying(true);
    if (error) {
      setError(null);
      return;
    }
    void proximityService.refresh()
      .catch((reason: unknown) => setError(nearbyError(reason)))
      .finally(() => setRetrying(false));
  }

  function startDiscovery() {
    if (!accountPubkey || starting) return;
    setStarting(true);
    setError(null);
    setTimeout(() => {
      void proximityService.setFeatureEnabled(accountPubkey, true)
        .then(() => {
          useProximityStore.getState().setBluetoothState('unknown');
          sessionReadyRef.current = false;
          setFeatureSetting({ accountPubkey, enabled: true });
          setPermissionRequested(true);
        })
        .catch(() => {
          setStarting(false);
          showToast(t('nearby.feature_update_failed'));
        });
    }, 0);
  }

  async function toggleFeature(next: boolean) {
    if (!accountPubkey || featureEnabled == null || featureToggleBusy) return;
    setFeatureToggleBusy(true);
    try {
      await proximityService.setFeatureEnabled(accountPubkey, next);
      sessionReadyRef.current = false;
      setStarting(false);
      setRetrying(false);
      setError(null);
      setFeatureSetting({ accountPubkey, enabled: next });
    } catch {
      showToast(t('nearby.feature_update_failed'));
    } finally {
      setFeatureToggleBusy(false);
    }
  }

  const permissionBlocked = bluetoothState === 'unauthorized';
  const bluetoothUnsupported = bluetoothState === 'unsupported';
  const developmentBuildRequired = error === 'developmentBuildRequired';
  const unavailable = retrying || error != null || permissionBlocked || bluetoothUnsupported || bluetoothState === 'poweredOff';
  const firstUse = starting || (identityLoaded && identity == null && !permissionRequested);

  return (
    <AppScreen edges={['bottom']}>
      <ScrollView
        {...scrollProps}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: top + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg }}
      >
        {!identityLoaded || featureEnabled == null ? (
          <View style={{ minHeight: spacing['2xl'] }} />
        ) : firstUse ? (
          <View style={{ gap: spacing.md, alignItems: 'center', paddingVertical: spacing['2xl'] }}>
            <Radar size={40} color={c.textMuted} />
            <AppText variant="subtitle" weight="semibold" align="center">
              {t('nearby.intro_title')}
            </AppText>
            <AppText variant="body" tone="muted" align="center">
              {t('nearby.intro_message')}
            </AppText>
            <View style={{ width: '100%', maxWidth: 320, paddingTop: spacing.sm }}>
              <AppButton
                label={t('nearby.start')}
                variant="primary"
                loading={starting}
                onPress={startDiscovery}
              />
            </View>
          </View>
        ) : (
          <>
            {identity ? (
              <>
                {/* Self identity exactly as other devices see it — the
                    deterministic proximity avatar + effective name — so the
                    user can point a friend at the right row. Tapping opens the
                    same name editor the former Display name row summoned. */}
                <Pressable
                  pressFeedback="delayed"
                  fallbackHoverOpacity={false}
                  onPress={() => setNameEditorOpen(true)}
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
                      {pressed ? <InteractionOverlay borderRadius={radius.lg} /> : null}
                      <Avatar
                        pubkey={identity.proximityPubkey}
                        name={visibleLocalName}
                        size={uiDensity.settingsIdentityAvatarSize}
                      />
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <AppText variant="subtitle" weight="semibold" numberOfLines={1}>
                          {visibleLocalName}
                        </AppText>
                        {/* The badge and npub share the caption line — same
                            typographic scale, one baseline — instead of a heavy
                            pill leading the bold name line. */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <SelfBadge />
                          <AppText
                            variant="caption"
                            tone="muted"
                            numberOfLines={1}
                            style={{ flexShrink: 1 }}
                          >
                            {abbreviateNpub(pubkeyToNpub(identity.proximityPubkey))}
                          </AppText>
                        </View>
                      </View>
                      <ChevronRight size={18} color={c.textMuted} />
                    </>
                  )}
                </Pressable>
                <ListGroup>
                  <ListRow
                    title={t('nearby.visibility_title')}
                    subtitle={t('nearby.visibility_description')}
                    trailing={
                      <Toggle
                        value={featureEnabled}
                        onValueChange={(next) => void toggleFeature(next)}
                        disabled={featureToggleBusy}
                      />
                    }
                  />
                  <ListRow
                    title={t('nearby.blocked_devices')}
                    value={blockedPeerCount > 0 ? String(blockedPeerCount) : undefined}
                    trailing={<ChevronRight size={18} color={c.textMuted} />}
                    onPress={() => router.push('/nearby-blocked')}
                  />
                </ListGroup>
              </>
            ) : null}

            {!featureEnabled ? (
              <View style={{ gap: spacing.md, alignItems: 'center', paddingVertical: spacing['2xl'] }}>
                <Radar size={40} color={c.textMuted} />
                <AppText variant="subtitle" weight="semibold" align="center">
                  {t('nearby.disabled_title')}
                </AppText>
                <AppText variant="body" tone="muted" align="center">
                  {t('nearby.disabled_message')}
                </AppText>
              </View>
            ) : unavailable ? (
              <View style={{ gap: spacing.md, alignItems: 'center', paddingVertical: spacing['2xl'] }}>
                <Radar size={40} color={c.textMuted} />
                <AppText variant="subtitle" weight="semibold" align="center">
                  {t(
                    developmentBuildRequired
                      ? 'nearby.development_build_title'
                      : bluetoothUnsupported
                        ? 'nearby.unsupported_title'
                        : 'nearby.unavailable_title',
                  )}
                </AppText>
                <AppText variant="body" tone="muted" align="center">
                  {t(
                    developmentBuildRequired
                      ? 'nearby.development_build_message'
                      : bluetoothUnsupported
                        ? 'nearby.unsupported_message'
                        : 'nearby.unavailable_message',
                  )}
                </AppText>
                <View style={{ width: '100%', maxWidth: 320, gap: spacing.sm, paddingTop: spacing.sm }}>
                  {permissionBlocked || bluetoothUnsupported || developmentBuildRequired ? null : (
                    <AppButton label={t('nearby.try_again')} variant="primary" loading={retrying} onPress={retry} />
                  )}
                  {bluetoothUnsupported || developmentBuildRequired ? null : (
                    <AppButton
                      label={t('nearby.open_settings')}
                      variant="secondary"
                      onPress={() => void Linking.openSettings().catch(() => setError('unavailable'))}
                    />
                  )}
                </View>
              </View>
            ) : (
              <>
                {!storedPeersLoaded ? (
                  <View style={{ minHeight: spacing['3xl'] }} />
                ) : (
                  <>
                    {knownPeers.length > 0 ? (
                      <View style={{ gap: spacing.sm }}>
                        <AppText variant="caption" tone="muted">
                          {t('nearby.known_devices')}
                        </AppText>
                        <NearbyPeerRows
                          peers={knownPeers}
                          onOpenPeer={openPeer}
                          onOpenProfile={openPeerProfile}
                        />
                      </View>
                    ) : null}

                    <View style={{ gap: spacing.sm }}>
                      <View
                        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}
                      >
                        <AppText variant="caption" tone="muted">{t('nearby.people')}</AppText>
                        <View
                          style={{
                            width: spacing.xl,
                            height: spacing.xl,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {scanning ? (
                            <ActivityIndicator size="small" color={c.textMuted} />
                          ) : null}
                        </View>
                      </View>
                      {nearbyPeers.length > 0 ? (
                        <NearbyPeerRows
                          peers={nearbyPeers}
                          onOpenPeer={openPeer}
                          onOpenProfile={openPeerProfile}
                        />
                      ) : (
                        <View
                          style={{
                            alignItems: 'center',
                            paddingVertical: spacing['2xl'],
                            gap: spacing.sm,
                          }}
                        >
                          <Radar size={36} color={c.textMuted} />
                          <AppText
                            variant="subtitle"
                            tone="muted"
                            weight="semibold"
                            align="center"
                          >
                            {t('nearby.empty_title')}
                          </AppText>
                          <AppText variant="body" tone="muted" align="center">
                            {t('nearby.empty')}
                          </AppText>
                        </View>
                      )}
                    </View>
                  </>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
      <ScreenHeader bordered={scrolled} title={t('nearby.title')} />
      {identity ? (
        <NearbyNameEditor
          key={`${identity.proximityPubkey}:${identity.updatedAt}`}
          open={nameEditorOpen}
          accountPubkey={accountPubkey}
          fallbackName={resolveDisplayName(identity.proximityPubkey)}
          initialName={identity.displayName}
          onClose={() => setNameEditorOpen(false)}
          onSaved={() => setNameEditorOpen(false)}
        />
      ) : null}
      <NearbyOutgoingRequestSheet
        peerPubkey={featureEnabled === true ? outgoingSheetPeer?.proximityPubkey ?? null : null}
        awaitingRequest={featureEnabled === true && outgoingSheetPeer != null}
        onClose={() => setOutgoingSheetPeer(null)}
      />
    </AppScreen>
  );
}

function NearbyNameEditor({
  open,
  accountPubkey,
  fallbackName,
  initialName,
  onClose,
  onSaved,
}: {
  open: boolean;
  accountPubkey: string;
  fallbackName: string;
  initialName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [nameDraft, setNameDraft] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const nameInputRef = useRef<TextInput>(null);

  function randomizeName() {
    setNameDraft(randomProximityDisplayName(normalizeProximityDisplayName(nameDraft)));
    setSaveFailed(false);
  }

  async function saveName() {
    Keyboard.dismiss();
    const normalizedName = normalizeProximityDisplayName(nameDraft);
    setNameDraft(normalizedName);
    setSaving(true);
    setSaveFailed(false);
    try {
      await updateProximityDisplayName(accountPubkey, normalizedName);
      await proximityService.refreshProfile();
      onSaved();
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const unchanged = normalizeProximityDisplayName(nameDraft) === initialName;

  // A pure single-field entry — the desktop form is the centered input dialog
  // (DESIGN §10 Electron presentation split).
  if (IS_ELECTRON) {
    return (
      <InputDialog
        visible={open}
        onClose={onClose}
        actionLayout="vertical"
        confirmLabel={t('common.save')}
        confirmLoading={saving}
        confirmDisabled={unchanged}
        onConfirm={() => void saveName()}
      >
        <AppInput
          description={t('nearby.name_hint')}
          error={saveFailed ? t('nearby.name_save_failed') : undefined}
          value={nameDraft}
          onChangeText={(value) => setNameDraft(sanitizeProximityDisplayNameInput(value))}
          placeholder={fallbackName}
          accessibilityLabel={t('nearby.name_placeholder')}
          trailingAccessory={
            <IconButton
              variant="secondary"
              shape="square"
              size={uiDensity.inputHeight}
              icon={<RefreshCw size={20} color={c.text} />}
              accessibilityLabel={t('nearby.randomize_name')}
              disabled={saving}
              onPress={randomizeName}
            />
          }
          autoFocus
          onSubmitEditing={() => void saveName()}
        />
      </InputDialog>
    );
  }

  return (
    <BottomSheet
      visible={open}
      onClose={onClose}
      inputFocusRef={nameInputRef}
      title={t('nearby.name_placeholder')}
      contentStyle={{ gap: spacing.lg }}
    >
      <AppInput
        ref={nameInputRef}
        description={t('nearby.name_hint')}
        error={saveFailed ? t('nearby.name_save_failed') : undefined}
        value={nameDraft}
        onChangeText={(value) => setNameDraft(sanitizeProximityDisplayNameInput(value))}
        placeholder={fallbackName}
        accessibilityLabel={t('nearby.name_placeholder')}
        trailingAccessory={
          <IconButton
            variant="secondary"
            shape="square"
            size={uiDensity.inputHeight}
            icon={<RefreshCw size={20} color={c.text} />}
            accessibilityLabel={t('nearby.randomize_name')}
            disabled={saving}
            onPress={randomizeName}
          />
        }
      />
      <ActionRow
        layout="vertical"
        confirm={{
          label: t('common.save'),
          loading: saving,
          disabled: unchanged,
          onPress: () => void saveName(),
        }}
      />
    </BottomSheet>
  );
}
