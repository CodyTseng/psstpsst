import { router } from 'expo-router';
import { DirectionalChevron as ChevronRight } from '@/components/common/DirectionalChevron';
import { ChatRound as MessageCircle } from '@solar-icons/react-native/category/messages/Linear/ChatRound';
import { Pen as Pencil } from '@solar-icons/react-native/category/messages/Linear/Pen';
import { Bell } from '@solar-icons/react-native/category/notifications/Linear/Bell';
import { BellOff } from '@solar-icons/react-native/category/notifications/Linear/BellOff';
import { Magnifer as Search } from '@solar-icons/react-native/category/search/Linear/Magnifer';
import { KeyMinimalistic as Fingerprint } from '@solar-icons/react-native/category/security/Linear/KeyMinimalistic';
import Check from 'lucide-react-native/icons/check';
import { Copy } from '@solar-icons/react-native/category/ui/Linear/Copy';
import { LinkBroken } from '@solar-icons/react-native/category/text-formatting/Linear/LinkBroken';
import { UserBlock } from '@solar-icons/react-native/category/users/Linear/UserBlock';
import { GalleryWide as Images } from '@solar-icons/react-native/category/video/Linear/GalleryWide';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, ScrollView, type TextInput, View } from 'react-native';

import { ActionRow } from '@/components/common/ActionRow';
import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { BottomSheet } from '@/components/common/BottomSheet';
import { InputDialog } from '@/components/common/InputDialog';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { ProfileAction } from '@/components/profile/ProfileAction';
import { NearbyOutgoingRequestSheet } from '@/components/proximity/nearby-outgoing-request-sheet';
import { useConversation } from '@/hooks/use-conversations';
import { useProximityPeer } from '@/hooks/use-proximity';
import { useScrolled } from '@/hooks/use-scrolled';
import i18n from '@/i18n';
import { setStringAsync } from '@/lib/clipboard';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import { pubkeyToNpub } from '@/lib/nostr/keys';
import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import { setConversationMuted } from '@/services/conversation/conversation-prefs.service';
import {
  normalizeProximityDisplayName,
  sanitizeProximityDisplayNameInput,
} from '@/services/proximity/proximity-display-name';
import { setProximityPeerNickname } from '@/services/proximity/proximity-peer.service';
import { proximityService } from '@/services/proximity/proximity.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useProximityStore, type NearbyConnectionStatus } from '@/stores/proximity.store';
import { showToast } from '@/stores/toast.store';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

type Props = {
  pubkey: string;
  fallbackName?: string;
};

type ConfirmAction = 'remove' | 'block';
function statusLabel(status: NearbyConnectionStatus): string {
  if (status === 'connected') return i18n.t('nearby.list_connected');
  if (status === 'connecting') return i18n.t('nearby.connecting');
  return i18n.t('nearby.disconnected');
}

/** Local-only identity details for an authenticated Nearby Messaging peer. */
export function NearbyContactDetail({ pubkey, fallbackName }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const accountPubkey = useActiveAccount((state) => state.activePubkey) ?? '';
  const runtimePeer = useProximityStore((state) => state.peers[pubkey]);
  const peerAvailable = useProximityStore(
    (state) => state.discoveries[pubkey]?.signalFresh === true,
  );
  const connectionRequestPending = useProximityStore(
    (state) => state.outgoingChatRequests[pubkey] === true,
  );
  const { conversation } = useConversation(accountPubkey, pubkey);
  const titleClearance = useScreenHeaderClearance();
  const { scrolled, scrollProps } = useScrolled();
  const [copied, setCopied] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [savingNickname, setSavingNickname] = useState(false);
  const [nicknameSaveFailed, setNicknameSaveFailed] = useState(false);
  const [connectAttemptPending, setConnectAttemptPending] = useState(false);
  const [relationshipBusy, setRelationshipBusy] = useState(false);
  const [relationshipFailed, setRelationshipFailed] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nicknameInputRef = useRef<TextInput>(null);

  const { peer: persistedPeer, loaded: peerLoaded } = useProximityPeer(accountPubkey, pubkey);
  const loaded = runtimePeer != null || peerLoaded;
  const peerDisplayName = resolveDisplayName(
    pubkey,
    { displayName: runtimePeer?.displayName || persistedPeer?.displayName },
    fallbackName || undefined,
  );
  const nickname = persistedPeer?.nickname ?? '';
  const name = nickname || peerDisplayName;
  const relationshipStatus =
    persistedPeer?.blockedAt != null
      ? 'blocked'
      : persistedPeer?.connectedAt != null
        ? 'trusted'
        : 'unlinked';
  const blocked = relationshipStatus === 'blocked';
  const trusted = relationshipStatus === 'trusted';
  const status: NearbyConnectionStatus =
    peerLoaded && !trusted
      ? 'disconnected'
      : (runtimePeer?.connectionStatus ?? 'disconnected');
  const muted = conversation?.muted ?? false;
  const hasConversationContent = !!conversation?.lastMessageId;
  const encodedPubkey = useMemo(() => {
    try {
      return pubkeyToNpub(pubkey);
    } catch {
      return pubkey;
    }
  }, [pubkey]);
  const statusColor = blocked
    ? c.danger
    : status === 'connected'
      ? c.success
      : status === 'connecting'
        ? c.warning
        : c.textMuted;

  useEffect(
    () => () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!accountPubkey) return;
    let release: (() => void) | null = null;
    let cancelled = false;
    void proximityService
      .acquire(accountPubkey, { activePeer: pubkey })
      .then((cleanup) => {
        if (cancelled) cleanup();
        else release = cleanup;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      release?.();
    };
  }, [accountPubkey, pubkey]);

  async function copyPublicKey() {
    await setStringAsync(encodedPubkey);
    setCopied(true);
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => setCopied(false), 1500);
  }

  function openChat() {
    router.navigate({
      pathname: '/chat/[key]',
      params: { key: pubkey, transport: 'proximity', name },
    });
  }

  function openSearch() {
    router.push({
      pathname: '/chat-search/[key]',
      params: { key: pubkey, transport: 'proximity', name },
    });
  }

  async function toggleMute() {
    if (!accountPubkey) return;
    await setConversationMuted(accountPubkey, pubkey, !muted);
  }

  async function connectDevice() {
    if (!accountPubkey || blocked || connectionRequestPending || connectAttemptPending) return;
    if (!useProximityStore.getState().discoveries[pubkey]?.signalFresh) return;
    setConnectAttemptPending(true);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!useProximityStore.getState().discoveries[pubkey]?.signalFresh) return;
      const result = await proximityService.requestChat(accountPubkey, pubkey);
      if (result === 'declined') showToast(t('nearby.request_declined'));
      if (result === 'timeout') showToast(t('nearby.request_timeout'));
      if (result === 'failed') showToast(t('nearby.request_failed'));
    } catch {
      showToast(t('nearby.request_failed'));
    } finally {
      setConnectAttemptPending(false);
    }
  }

  function openNicknameEditor() {
    setNicknameDraft(nickname);
    setNicknameSaveFailed(false);
    setEditOpen(true);
  }

  async function saveNickname() {
    if (savingNickname) return;
    Keyboard.dismiss();
    const normalizedNickname = normalizeProximityDisplayName(nicknameDraft);
    setNicknameDraft(normalizedNickname);
    setSavingNickname(true);
    setNicknameSaveFailed(false);
    try {
      await setProximityPeerNickname(accountPubkey, pubkey, normalizedNickname);
      setEditOpen(false);
    } catch {
      setNicknameSaveFailed(true);
    } finally {
      setSavingNickname(false);
    }
  }

  function openRelationshipConfirmation(action: ConfirmAction) {
    if (!accountPubkey || relationshipBusy) return;
    setRelationshipFailed(false);
    void platform.confirmationDialog
      .confirm({
        title: t(
          action === 'remove' ? 'nearby.remove_connection_title' : 'nearby.block_device_title',
          { name },
        ),
        message: t(
          action === 'remove'
            ? 'nearby.remove_connection_message'
            : 'nearby.block_device_message',
        ),
        cancelLabel: t('common.cancel'),
        confirmLabel: t(action === 'remove' ? 'nearby.remove_connection' : 'nearby.block_device'),
        destructive: true,
        actionLayout: 'vertical',
      })
      .then((confirmed) => {
        if (confirmed) void confirmRelationshipAction(action);
      });
  }

  async function confirmRelationshipAction(action: ConfirmAction) {
    if (!accountPubkey || relationshipBusy) return;
    setRelationshipBusy(true);
    setRelationshipFailed(false);
    try {
      if (action === 'remove') {
        await proximityService.removeConnection(accountPubkey, pubkey);
      } else {
        await proximityService.blockPeer(accountPubkey, pubkey);
      }
    } catch {
      setRelationshipFailed(true);
    } finally {
      setRelationshipBusy(false);
    }
  }

  async function unblockDevice() {
    if (!accountPubkey || relationshipBusy) return;
    setRelationshipBusy(true);
    setRelationshipFailed(false);
    try {
      await proximityService.unblockPeer(accountPubkey, pubkey);
    } catch {
      setRelationshipFailed(true);
    } finally {
      setRelationshipBusy(false);
    }
  }

  return (
    <AppScreen edges={[]}>
      <ScrollView
        {...scrollProps}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: spacing.lg,
          paddingTop: titleClearance + spacing.sm,
          paddingBottom: spacing['2xl'],
        }}
        showsVerticalScrollIndicator={false}
      >
        {loaded ? (
          <>
            <View style={{ alignItems: 'center' }}>
              <Avatar pubkey={pubkey} name={name} size={96} />
              <View
                style={{
                  alignItems: 'center',
                  gap: spacing.xs,
                  marginTop: spacing.md,
                  maxWidth: '100%',
                }}
              >
                <AppText variant="title" numberOfLines={2} align="center">
                  {name}
                </AppText>
                {nickname && peerDisplayName !== nickname ? (
                  <AppText variant="body" tone="muted" numberOfLines={1} align="center">
                    {peerDisplayName}
                  </AppText>
                ) : null}
                <AppText
                  variant="body"
                  weight="medium"
                  align="center"
                  style={{ color: statusColor }}
                >
                  {blocked ? t('nearby.blocked_device') : statusLabel(status)}
                </AppText>
              </View>
            </View>

            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-around',
                marginTop: spacing.xl,
              }}
            >
              <ProfileAction
                icon={<MessageCircle size={22} color={c.text} />}
                label={t('profile.message')}
                onPress={openChat}
              />
              <ProfileAction
                icon={<Search size={22} color={c.text} />}
                label={t('search.in_conversation')}
                onPress={openSearch}
              />
              <ProfileAction
                icon={
                  muted ? (
                    <Bell size={22} color={c.text} />
                  ) : (
                    <BellOff size={22} color={c.text} />
                  )
                }
                label={muted ? t('profile.unmute') : t('profile.mute')}
                onPress={() => void toggleMute()}
              />
            </View>

            {!trusted && !blocked ? (
              <View style={{ marginTop: spacing.xl }}>
                <AppButton
                  label={t(
                    peerAvailable || connectionRequestPending || connectAttemptPending
                      ? 'nearby.connect'
                      : 'nearby.offline',
                  )}
                  variant="primary"
                  size="lg"
                  loading={connectionRequestPending || connectAttemptPending}
                  disabled={!peerAvailable}
                  onPress={() => void connectDevice()}
                />
              </View>
            ) : null}

            <View style={{ marginTop: spacing['2xl'] }}>
              <ListGroup>
                <ListRow
                  icon={<Fingerprint size={22} color={c.text} />}
                  title={t('profile.public_key')}
                  value={encodedPubkey}
                  valueTone="default"
                  valuePlacement="below"
                  valueEllipsizeMode="middle"
                  trailing={
                    copied ? (
                      <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.success} />
                    ) : (
                      <Copy size={18} color={c.textMuted} />
                    )
                  }
                  onPress={() => void copyPublicKey()}
                />
                {hasConversationContent ? (
                  <ListRow
                    icon={<Images size={22} color={c.text} />}
                    title={t('media.title')}
                    trailing={<ChevronRight size={18} color={c.textMuted} />}
                    onPress={() => router.push(`/media/${encodeURIComponent(pubkey)}`)}
                  />
                ) : null}
                <ListRow
                  icon={<Pencil size={22} color={c.text} />}
                  title={t('profile.set_petname')}
                  value={nickname || undefined}
                  trailing={<ChevronRight size={18} color={c.textMuted} />}
                  onPress={openNicknameEditor}
                />
              </ListGroup>
            </View>

            <View style={{ marginTop: spacing.xl }}>
              <ListGroup>
                {trusted ? (
                  <ListRow
                    icon={<LinkBroken size={22} color={c.danger} />}
                    title={t('nearby.remove_connection')}
                    titleTone="danger"
                    onPress={() => openRelationshipConfirmation('remove')}
                    disabled={relationshipBusy}
                  />
                ) : null}
                <ListRow
                  icon={<UserBlock size={22} color={blocked ? c.text : c.danger} />}
                  title={t(blocked ? 'nearby.unblock_device' : 'nearby.block_device')}
                  titleTone={blocked ? 'default' : 'danger'}
                  onPress={
                    blocked
                      ? () => void unblockDevice()
                      : () => openRelationshipConfirmation('block')
                  }
                  disabled={relationshipBusy}
                  loading={blocked && relationshipBusy}
                />
              </ListGroup>
              {relationshipFailed ? (
                <AppText
                  variant="caption"
                  tone="danger"
                  style={{ marginTop: spacing.sm, paddingHorizontal: spacing.sm }}
                >
                  {t('nearby.relationship_update_failed')}
                </AppText>
              ) : null}
            </View>
          </>
        ) : (
          <View style={{ flex: 1 }} />
        )}
      </ScrollView>
      <ScreenHeader bordered={scrolled} />
      {IS_ELECTRON ? (
        // A pure single-field entry — the desktop form is the centered input
        // dialog (DESIGN §10 Electron presentation split).
        <InputDialog
          visible={editOpen}
          onClose={() => setEditOpen(false)}
          actionLayout="vertical"
          confirmLabel={t('common.save')}
          confirmLoading={savingNickname}
          confirmDisabled={normalizeProximityDisplayName(nicknameDraft) === nickname}
          onConfirm={() => void saveNickname()}
        >
          <AppInput
            description={t('nearby.nickname_hint')}
            error={nicknameSaveFailed ? t('nearby.nickname_save_failed') : undefined}
            placeholder={peerDisplayName || t('profile.petname_placeholder')}
            value={nicknameDraft}
            onChangeText={(value) =>
              setNicknameDraft(sanitizeProximityDisplayNameInput(value))
            }
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            onSubmitEditing={() => void saveNickname()}
          />
        </InputDialog>
      ) : (
        <BottomSheet
          visible={editOpen}
          onClose={() => setEditOpen(false)}
          inputFocusRef={nicknameInputRef}
          title={t('profile.set_petname')}
          contentStyle={{ gap: spacing.lg }}
        >
          <AppInput
            ref={nicknameInputRef}
            description={t('nearby.nickname_hint')}
            error={nicknameSaveFailed ? t('nearby.nickname_save_failed') : undefined}
            placeholder={peerDisplayName || t('profile.petname_placeholder')}
            value={nicknameDraft}
            onChangeText={(value) =>
              setNicknameDraft(sanitizeProximityDisplayNameInput(value))
            }
            autoCapitalize="none"
            autoCorrect={false}
          />
          <ActionRow
            layout="vertical"
            confirm={{
              label: t('common.save'),
              loading: savingNickname,
              disabled: normalizeProximityDisplayName(nicknameDraft) === nickname,
              onPress: () => void saveNickname(),
            }}
          />
        </BottomSheet>
      )}
      <NearbyOutgoingRequestSheet
        peerPubkey={pubkey}
        awaitingRequest={connectAttemptPending}
      />
    </AppScreen>
  );
}
