import * as DocumentPicker from 'expo-document-picker';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Reply } from '@solar-icons/react-native/category/arrows-action/Linear/Reply';
import { DownloadMinimalistic as Download } from '@solar-icons/react-native/category/arrows-action/Linear/DownloadMinimalistic';
import { Forward } from '@solar-icons/react-native/category/arrows-action/Linear/Forward';
import { Copy } from '@solar-icons/react-native/category/ui/Linear/Copy';
import { InfoCircle as Info } from '@solar-icons/react-native/category/ui/Linear/InfoCircle';
import { ChecklistMinimalistic as ListChecks } from '@solar-icons/react-native/category/list/Linear/ChecklistMinimalistic';
import { StickerSmileCircle2 as SmilePlus } from '@solar-icons/react-native/category/faces/Linear/StickerSmileCircle2';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import Reanimated, { Easing, FadeIn, ReduceMotion } from 'react-native-reanimated';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { bottomBarHeight, headerHeight, useThemeColors } from '@/theme';
import { AppScreen } from '@/components/common/AppScreen';
import { PhotoCaptureModal } from '@/components/common/PhotoCaptureModal';
import type { AttachmentSource } from '@/components/chat/AttachmentPanel';
import {
  AttachmentSendConfirmation,
  type AttachmentConfirmationFile,
  type PickedAttachment,
} from '@/components/chat/AttachmentSendConfirmation';
import { ChatFileDropZone } from '@/components/chat/ChatFileDropZone';
import { ChatComposerGate } from '@/components/chat/ChatComposerGate';
import { ChatBlockedNotice } from '@/components/chat/ChatBlockedNotice';
import { ChatContactPrompt } from '@/components/chat/ChatContactPrompt';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatInput } from '@/components/chat/ChatInput';
import { NearbyReconnectNotice } from '@/components/chat/NearbyReconnectNotice';
import {
  ChatComposerPanelDismissOverlay,
  ChatComposerPanelProvider,
} from '@/components/chat/chat-composer-panel-context';
import { ForwardActionBar } from '@/components/chat/ForwardActionBar';
import { SelectionHeader } from '@/components/chat/SelectionHeader';
import type { VoicePayload } from '@/components/chat/VoiceRecorderBar';
import { MessageDetailSheet } from '@/components/chat/MessageDetailSheet';
import { ForwardPreview } from '@/components/share/ForwardPreview';
import { ShareConfirmSheet } from '@/components/share/ShareConfirmSheet';
import { DmUnsupportedSheet } from '@/components/chat/DmUnsupportedSheet';
import {
  MESSAGE_ACTION_MENU_ICON_SIZE,
  MessageActionMenu,
  type LiftedBubble,
  type MessageMenuAction,
} from '@/components/chat/MessageActionMenu';
import type { BubbleRect } from '@/components/chat/MessageBubble';
import { resolveMessageContentViewport } from '@/components/chat/message-action-menu-placement';
import type { EmojiPickerPopoverAnchor } from '@/components/chat/EmojiPickerSheet';
import { MessageList } from '@/components/chat/MessageList';
import { AddEmojiToPackSheet } from '@/components/emoji/AddEmojiToPackSheet';
import { NearbyOutgoingRequestSheet } from '@/components/proximity/nearby-outgoing-request-sheet';
import type { messages as messagesSchema } from '@/db/schema';
import { useConversation } from '@/hooks/use-conversations';
import { useDmSupport } from '@/hooks/use-dm-support';
import { useMessageDeliveries } from '@/hooks/use-message-deliveries';
import { useMessages, useMessagesByIds } from '@/hooks/use-messages';
import { useIsBlocked } from '@/hooks/use-blocked';
import {
  getSessionCachedContact,
  getSessionCachedContactStatus,
  useContact,
  useIsContact,
} from '@/hooks/use-contacts';
import { getSessionCachedProfile, useProfile } from '@/hooks/use-profile';
import { useProximityIdentity, useProximityPeer } from '@/hooks/use-proximity';
import { useCustomEmojis } from '@/hooks/use-custom-emojis';
import { useWallets } from '@/hooks/use-wallets';
import { setStringAsync } from '@/lib/clipboard';
import { isAbortError } from '@/lib/async/abort';
import type { ImageSendQuality } from '@/lib/attachments/image-quality';
import { IS_ELECTRON } from '@/lib/platform';
import { getBottomChromeInset } from '@/lib/layout/bottom-chrome';
import { shortCustomEmojiMessage } from '@/lib/emoji/custom-message';
import type { ReactionAggregate } from '@/lib/nostr/reactions';
import { quickReactionKey, type QuickReaction } from '@/lib/nostr/quick-reaction';
import { withMessageOrderTag } from '@/lib/nostr/message-order';
import { attachmentLabel } from '@/lib/nostr/attachment-label';
import {
  discardTemporaryComposerFiles,
  type ComposerFile,
} from '@/lib/attachments/composer-file';
import { findFileMeta, type FileAttachmentMeta } from '@/lib/nostr/file-tags';
import {
  buildEmojiTag,
  customEmojisFromMessageTags,
  type CustomEmoji,
} from '@/lib/nostr/custom-emoji';
import { copyForShare } from '@/services/files/file-attachment.service';
import { nearbyFileUploadService } from '@/services/files/nearby-file-upload.service';
import {
  attachmentTransferKey,
  attachmentTransferStore,
} from '@/services/files/attachment-transfer-state';
import { saveAttachmentToLibrary, saveUriToLibrary } from '@/services/files/media-save.service';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import type { ForwardMessage } from '@/lib/share/forward';
import { shareContactContent } from '@/lib/share/contact-card';
import type { ShareTarget } from '@/lib/share/share-target';
import { conversationRemoteContentMode } from '@/components/chat/remote-content-policy';
import { resolvePeerRelationship, type PeerRelationship } from '@/lib/chat/peer-relationship';
import { platform } from '@/platform';
import { buildSigner } from '@/services/account/account.service';
import { conversationSendService } from '@/services/conversation/conversation-send.service';
import { addContact } from '@/services/contact/contact.service';
import { unreadCountService } from '@/services/conversation/unread-count.service';
import { blockUser, getSessionCachedBlockedStatus, unblockUser } from '@/services/dm/block.service';
import { buildRumor, KIND_CHAT } from '@/services/crypto/nip17-gift-wrap';
import { encryptionKeyWatcher } from '@/services/dm/encryption-key-watcher';
import { dmService } from '@/services/dm/dm.service';
import {
  nextRumorTimestamp,
  rumorTimestampFromOrderAt,
} from '@/services/dm/rumor-clock';
import { loadEncryptionKeypair } from '@/services/dm/encryption-key.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useComposerFileHandoffStore } from '@/stores/composer-file-handoff.store';
import { useForwardDraftStore } from '@/stores/forward-draft.store';
import {
  newTempId,
  useInFlightAttachmentsFor,
  usePendingAttachmentsStore,
  type PendingAttachment,
} from '@/stores/pending-attachments.store';
import { useReactionPrefsStore } from '@/stores/reaction-prefs.store';
import { proximityService } from '@/services/proximity/proximity.service';
import {
  getCachedProximityPubkey,
  rememberProximityPubkey,
} from '@/services/proximity/proximity-identity.service';
import { useProximityStore, type NearbyConnectionFailure } from '@/stores/proximity.store';
import { showToast } from '@/stores/toast.store';
import {
  conversationAttachmentSources,
  conversationSupportsContent,
} from '@/lib/conversation/capabilities';

const LazyEmojiPickerSheet = lazy(() =>
  import('@/components/chat/EmojiPickerSheet').then((module) => ({
    default: module.EmojiPickerSheet,
  })),
);

const BASE_ATTACHMENT_SOURCES = conversationAttachmentSources(false);
const UPLOAD_PREPARING_PERCENT = 5;
const UPLOAD_ENCRYPTING_PERCENT = 15;
const UPLOAD_BYTES_START_PERCENT = 20;
// Reserve the final point for the atomic pending-to-sent handoff. Rendering a
// transient 100% frame immediately before removing the overlay causes a flash.
const UPLOAD_BYTES_END_PERCENT = 99;

function uploadByteProgress(sentBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return UPLOAD_BYTES_START_PERCENT;
  const fraction = Math.max(0, Math.min(1, sentBytes / totalBytes));
  return Math.floor(
    UPLOAD_BYTES_START_PERCENT +
      fraction * (UPLOAD_BYTES_END_PERCENT - UPLOAD_BYTES_START_PERCENT),
  );
}
// Layout animations on web can serialize bezier factories but not composed
// easing functions such as Easing.out(Easing.quad).
const CHAT_ENTER_EASE_OUT = Easing.bezier(1 / 3, 2 / 3, 2 / 3, 1);

type MessageRow = typeof messagesSchema.$inferSelect;

type ChatComposerModel = {
  mode: 'input' | 'gate';
  disabled: boolean;
  attachmentSources: readonly AttachmentSource[];
  supportsVoice: boolean;
  replyTo: { senderName: string; contentPreview: string } | null;
  gateStatus: 'checking' | 'unsupported' | 'proximity_identity_changed' | null;
};

type ChatComposerController = {
  send: (text: string, customEmojis: CustomEmoji[]) => Promise<void> | void;
  pickAttachment: (source: AttachmentSource) => void;
  sendVoice: (payload: VoicePayload) => void;
  cancelReply: () => void;
  openUnsupported: () => void;
};

type ChatComposerBindingProps = {
  controller: ChatComposerController;
  controllerRef: MutableRefObject<ChatComposerController | null>;
  model: ChatComposerModel;
  onModelChange: (model: ChatComposerModel) => void;
};

function ChatComposerBinding({
  controller,
  controllerRef,
  model,
  onModelChange,
}: ChatComposerBindingProps) {
  useLayoutEffect(() => {
    controllerRef.current = controller;
    onModelChange(model);
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [controller, controllerRef, model, onModelChange]);
  return null;
}

type ChatRelationshipLiveSyncProps = {
  accountPubkey: string;
  peerPubkey: string;
  onChange: (relationship: PeerRelationship) => void;
};

/** Mount the two bounded relationship subscriptions only with the full chat.
 * The native push scene uses memory snapshots exclusively, so query completion
 * cannot schedule extra work during the route animation. */
function ChatRelationshipLiveSync({
  accountPubkey,
  peerPubkey,
  onChange,
}: ChatRelationshipLiveSyncProps) {
  const liveContact = useIsContact(accountPubkey, peerPubkey);
  const liveBlocked = useIsBlocked(accountPubkey, peerPubkey);
  // Cached labels may paint immediately, but new downloads need a current verdict.
  const relationship = resolvePeerRelationship({
    cachedContact: undefined,
    cachedBlocked: undefined,
    liveContact,
    liveBlocked,
  });

  useEffect(() => {
    onChange(relationship);
  }, [onChange, relationship]);

  return null;
}

function singleCustomEmojiFromMessage(message: MessageRow): CustomEmoji | null {
  const tagged = customEmojisFromMessageTags(message.tags);
  if (tagged.length === 0) return null;
  const byShortcode = new Map(
    tagged.map((emoji) => [emoji.shortcode.toLowerCase(), emoji] as const),
  );
  const short = shortCustomEmojiMessage(message.content, byShortcode);
  return short?.length === 1 ? short[0] : null;
}

export default function ChatPageRuntime() {
  const params = useLocalSearchParams<{
    key: string;
    transport?: string;
    name?: string;
    focus?: string;
    from?: string;
  }>();
  const conversationKey = decodeURIComponent(params.key ?? '');
  const accountPubkey = useActiveAccount((state) => state.activePubkey) ?? '';
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const matchingFileHandoff = useComposerFileHandoffStore((state) => {
    const handoff = state.handoff;
    return handoff?.accountPubkey === accountPubkey && handoff.conversationKey === conversationKey
      ? handoff
      : null;
  });
  const discardFileHandoff = useComposerFileHandoffStore((state) => state.discard);
  const [composerFileState, setComposerFileState] = useState<{
    conversationKey: string;
    files: ComposerFile[];
  }>(() => ({ conversationKey, files: [] }));
  const localComposerFiles =
    composerFileState.conversationKey === conversationKey ? composerFileState.files : [];
  const composerFiles =
    localComposerFiles.length > 0 ? localComposerFiles : (matchingFileHandoff?.files ?? []);
  const setComposerFiles = useCallback<Dispatch<SetStateAction<ComposerFile[]>>>(
    (next) => {
      if (matchingFileHandoff) discardFileHandoff(matchingFileHandoff.id);
      setComposerFileState((current) => {
        const currentFiles =
          current.conversationKey === conversationKey && current.files.length > 0
            ? current.files
            : (matchingFileHandoff?.files ?? []);
        const files = typeof next === 'function' ? next(currentFiles) : next;
        return { conversationKey, files };
      });
    },
    [conversationKey, discardFileHandoff, matchingFileHandoff],
  );
  const [fileDropState, setFileDropState] = useState<{
    conversationKey: string;
    enabled: boolean;
  }>(() => ({ conversationKey, enabled: false }));
  const fileDropEnabled =
    fileDropState.conversationKey === conversationKey && fileDropState.enabled;
  const setFileDropEnabled = useCallback(
    (enabled: boolean) => {
      setFileDropState((current) =>
        current.conversationKey === conversationKey && current.enabled === enabled
          ? current
          : { conversationKey, enabled },
      );
    },
    [conversationKey],
  );
  const isProximity = params.transport === 'proximity';
  const composerControllerRef = useRef<ChatComposerController | null>(null);
  const [composerModel, setComposerModel] = useState<ChatComposerModel>(() => ({
    mode: 'input',
    disabled: false,
    attachmentSources: BASE_ATTACHMENT_SOURCES,
    supportsVoice: conversationSupportsContent('audio'),
    replyTo: null,
    gateStatus: null,
  }));
  const [messageRuntimeReady, setMessageRuntimeReady] = useState(false);
  useEffect(() => {
    // Let the real header and composer commit with the native route. The cached
    // message viewport joins on the next task and fades in without moving them.
    const timer = setTimeout(() => setMessageRuntimeReady(true), 0);
    return () => clearTimeout(timer);
  }, []);
  const handleComposerModelChange = useCallback((next: ChatComposerModel) => {
    setComposerModel((current) => {
      const sameReply =
        current.replyTo === next.replyTo ||
        (current.replyTo !== null &&
          next.replyTo !== null &&
          current.replyTo.senderName === next.replyTo.senderName &&
          current.replyTo.contentPreview === next.replyTo.contentPreview);
      const sameSources =
        current.attachmentSources.length === next.attachmentSources.length &&
        current.attachmentSources.every(
          (source, index) => source === next.attachmentSources[index],
        );
      return current.mode === next.mode &&
        current.disabled === next.disabled &&
        current.supportsVoice === next.supportsVoice &&
        current.gateStatus === next.gateStatus &&
        sameReply &&
        sameSources
        ? current
        : next;
    });
  }, []);
  const sendFromComposer = useCallback((text: string, customEmojis: CustomEmoji[]) => {
    const controller = composerControllerRef.current;
    if (!controller) return Promise.reject(new Error('Chat runtime is not ready'));
    return controller.send(text, customEmojis);
  }, []);
  const pickFromComposer = useCallback((source: AttachmentSource) => {
    composerControllerRef.current?.pickAttachment(source);
  }, []);
  const sendVoiceFromComposer = useCallback((payload: VoicePayload) => {
    composerControllerRef.current?.sendVoice(payload);
  }, []);
  const cancelComposerReply = useCallback(() => {
    composerControllerRef.current?.cancelReply();
  }, []);
  const openComposerGateDetails = useCallback(() => {
    composerControllerRef.current?.openUnsupported();
  }, []);
  const peerPubkey = !isProximity && conversationKey ? conversationKey : '';
  const isRelationshipEligible = !!peerPubkey && peerPubkey !== accountPubkey;
  const relationshipKey = `${accountPubkey}:${peerPubkey}`;
  const cachedContact = isRelationshipEligible
    ? getSessionCachedContactStatus(accountPubkey, peerPubkey)
    : undefined;
  const cachedBlocked = isRelationshipEligible
    ? getSessionCachedBlockedStatus(accountPubkey, peerPubkey)
    : undefined;
  const cachedRelationship = isRelationshipEligible
    ? resolvePeerRelationship({
        cachedContact,
        cachedBlocked,
        liveContact: undefined,
        liveBlocked: undefined,
      })
    : 'unknown';
  const [liveRelationship, setLiveRelationship] = useState<{
    key: string;
    value: PeerRelationship;
  } | null>(null);
  const [optimisticRelationship, setOptimisticRelationship] = useState<{
    key: string;
    value: PeerRelationship;
  } | null>(null);
  const relationship =
    optimisticRelationship?.key === relationshipKey
      ? optimisticRelationship.value
      : liveRelationship?.key === relationshipKey && liveRelationship.value !== 'unknown'
        ? liveRelationship.value
        : cachedRelationship;
  const relationshipBarVisible = relationship === 'stranger' || relationship === 'blocked';
  const titleClearance = headerHeight + insets.top;
  const topNoticeRef = useRef<View>(null);
  const graduatedHereRef = useRef(false);
  const relationshipMutationRef = useRef(0);
  // The real cached chat chrome is interactive from the first runtime commit.
  // Live subscriptions and secondary local reads join only after the native
  // push, so they cannot compete with its frames. The two indexed Nearby
  // ownership reads are the exception: they start immediately but do not block
  // the optimistic composer. Anchored opens also enable live data immediately.
  const [liveDataReady, setLiveDataReady] = useState(typeof params.focus === 'string');
  const proximityConnectionStatus = useProximityStore(
    (state) => state.peers[conversationKey]?.connectionStatus ?? 'disconnected',
  );
  const proximityConnectionFailure = useProximityStore(
    (state) => state.peers[conversationKey]?.connectionFailure ?? null,
  );
  const proximityPeerAvailable = useProximityStore(
    (state) => state.discoveries[conversationKey]?.signalFresh === true,
  );
  const { peer: persistedProximityPeer, loaded: proximityPeerLoaded } = useProximityPeer(
    accountPubkey,
    isProximity ? conversationKey : null,
    liveDataReady,
  );
  const previousProximityFailureRef = useRef<NearbyConnectionFailure | null>(null);
  const [manualReconnectPending, setManualReconnectPending] = useState(false);
  const proximityRelationship =
    persistedProximityPeer?.blockedAt != null
      ? 'blocked'
      : persistedProximityPeer?.connectedAt != null
        ? 'trusted'
        : 'unlinked';
  const reconnectNoticeReason =
    isProximity && proximityPeerLoaded && proximityConnectionStatus === 'disconnected'
      ? proximityRelationship === 'unlinked'
        ? 'removed'
        : proximityRelationship === 'trusted' && proximityConnectionFailure === 'rejected'
          ? 'rejected'
          : null
      : null;
  const reconnectNoticeVisible = reconnectNoticeReason != null;
  const topNoticeVisible = relationshipBarVisible || reconnectNoticeVisible;
  const contentTopInset = topNoticeVisible ? 0 : titleClearance;

  useEffect(() => {
    const previous = previousProximityFailureRef.current;
    previousProximityFailureRef.current = proximityConnectionFailure;
    if (
      isProximity &&
      liveDataReady &&
      proximityConnectionFailure === 'failed' &&
      previous !== 'failed'
    ) {
      showToast(t('nearby.request_failed'));
    }
  }, [isProximity, liveDataReady, proximityConnectionFailure, t]);

  useEffect(() => {
    if (liveDataReady) return;
    let activationTimer: ReturnType<typeof setTimeout> | null = null;
    const activate = () => {
      if (activationTimer) return;
      activationTimer = setTimeout(() => setLiveDataReady(true), 0);
    };
    const removeTransitionEnd = navigation.addListener(
      'transitionEnd' as never,
      ((event: { data?: { closing?: boolean } }) => {
        if (!event.data?.closing) activate();
      }) as never,
    );
    const fallbackTimer = setTimeout(activate, 500);
    return () => {
      removeTransitionEnd();
      clearTimeout(fallbackTimer);
      if (activationTimer) clearTimeout(activationTimer);
    };
  }, [liveDataReady, navigation]);

  useEffect(() => {
    if (!liveDataReady) return;
    const idleHandle = requestIdleCallback(
      () => {
        void import('@/components/chat/EmojiPickerSheet');
      },
      { timeout: 1000 },
    );
    return () => cancelIdleCallback(idleHandle);
  }, [liveDataReady]);

  useEffect(() => {
    graduatedHereRef.current = false;
  }, [conversationKey]);

  // Tell the unread service at mount — ahead of the push transition, whose end
  // gates both the mark-read write and the header badge — that this conversation
  // is being viewed. Its still-stored unread is then excluded from the very
  // first refresh, so the back-button count never flashes a figure that the
  // pending mark-read is about to wipe.
  useEffect(() => {
    if (!accountPubkey || !conversationKey) return;
    unreadCountService.setActiveConversation({ accountPubkey, conversationKey });
    return () => unreadCountService.setActiveConversation(null);
  }, [accountPubkey, conversationKey]);

  useEffect(() => {
    if (params.from !== 'requests') return;
    const sub = navigation.addListener('beforeRemove', (event) => {
      if (!graduatedHereRef.current || event.data.action.type !== 'GO_BACK') return;
      event.preventDefault();
      router.dismissAll();
      router.navigate('/');
    });
    return sub;
  }, [navigation, params.from]);

  const runRelationshipMutation = useCallback(
    (next: PeerRelationship, mutation: () => Promise<void>) => {
      const mutationId = ++relationshipMutationRef.current;
      setOptimisticRelationship({ key: relationshipKey, value: next });
      void mutation().catch(() => {
        if (relationshipMutationRef.current !== mutationId) return;
        setOptimisticRelationship((current) => (current?.key === relationshipKey ? null : current));
      });
    },
    [relationshipKey],
  );

  const handleAddContact = useCallback(() => {
    if (!accountPubkey || !peerPubkey) return;
    graduatedHereRef.current = true;
    runRelationshipMutation('contact', () =>
      addContact(accountPubkey, peerPubkey, { source: 'manual' }),
    );
  }, [accountPubkey, peerPubkey, runRelationshipMutation]);

  const handleBlock = useCallback(() => {
    if (!accountPubkey || !peerPubkey) return;
    const contact = getSessionCachedContact(accountPubkey, peerPubkey);
    const profile = getSessionCachedProfile(peerPubkey);
    const peerName = resolveDisplayName(peerPubkey, {
      petname: contact?.petname,
      displayName: profile?.displayName,
      name: profile?.name,
    });
    void platform.confirmationDialog
      .confirm({
        title: t('chat.block_title', { name: peerName }),
        message: t('chat.block_message'),
        cancelLabel: t('common.cancel'),
        confirmLabel: t('chat.block_confirm'),
        destructive: true,
      })
      .then((confirmed) => {
        if (confirmed) {
          runRelationshipMutation('blocked', () => blockUser(accountPubkey, peerPubkey));
        }
      });
  }, [accountPubkey, peerPubkey, runRelationshipMutation, t]);

  const handleUnblock = useCallback(() => {
    if (!accountPubkey || !peerPubkey) return;
    const next =
      cachedContact === true ? 'contact' : cachedContact === false ? 'stranger' : 'unknown';
    runRelationshipMutation(next, () => unblockUser(accountPubkey, peerPubkey));
  }, [accountPubkey, cachedContact, peerPubkey, runRelationshipMutation]);

  const handleRelationshipChange = useCallback(
    (value: PeerRelationship) => {
      setLiveRelationship({ key: relationshipKey, value });
      setOptimisticRelationship((current) =>
        current?.key === relationshipKey && current.value === value ? null : current,
      );
    },
    [relationshipKey],
  );

  const handleGraduate = useCallback(() => {
    graduatedHereRef.current = true;
  }, []);

  const handleManualReconnect = useCallback(async () => {
    if (!isProximity || !accountPubkey || !conversationKey || manualReconnectPending) return;
    if (!useProximityStore.getState().discoveries[conversationKey]?.signalFresh) return;
    setManualReconnectPending(true);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!useProximityStore.getState().discoveries[conversationKey]?.signalFresh) return;
      const result = await proximityService.requestChat(accountPubkey, conversationKey);
      if (result === 'declined') showToast(t('nearby.request_declined'));
      if (result === 'timeout') showToast(t('nearby.request_timeout'));
      if (result === 'failed') showToast(t('nearby.request_failed'));
    } catch {
      showToast(t('nearby.request_failed'));
    } finally {
      setManualReconnectPending(false);
    }
  }, [accountPubkey, conversationKey, isProximity, manualReconnectPending, t]);

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  return (
    <AppScreen edges={[]}>
      <ChatFileDropZone
        enabled={fileDropEnabled && !selectionMode && composerFiles.length === 0}
        onDropFiles={setComposerFiles}
      >
        <ChatComposerPanelProvider>
          {liveDataReady && isRelationshipEligible ? (
            <ChatRelationshipLiveSync
              key={relationshipKey}
              accountPubkey={accountPubkey}
              peerPubkey={peerPubkey}
              onChange={handleRelationshipChange}
            />
          ) : null}
          {topNoticeVisible ? (
            <View
              ref={topNoticeRef}
              collapsable={false}
              style={{ marginTop: titleClearance }}
            >
              {reconnectNoticeVisible ? (
                <NearbyReconnectNotice
                  reason={reconnectNoticeReason}
                  reconnecting={manualReconnectPending}
                  available={proximityPeerAvailable}
                  onReconnect={() => void handleManualReconnect()}
                />
              ) : relationship === 'blocked' ? (
                <ChatBlockedNotice onUnblock={handleUnblock} />
              ) : (
                <ChatContactPrompt onAdd={handleAddContact} onBlock={handleBlock} />
              )}
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            {messageRuntimeReady ? (
              <Reanimated.View
                entering={FadeIn.duration(150)
                  .easing(CHAT_ENTER_EASE_OUT)
                  .reduceMotion(ReduceMotion.System)}
                style={{ flex: 1 }}
              >
                <ChatPageContent
                  key={conversationKey}
                  relationship={liveRelationship?.key === relationshipKey ? liveRelationship.value : 'unknown'}
                  selectionMode={selectionMode}
                  setSelectionMode={setSelectionMode}
                  selectedIds={selectedIds}
                  setSelectedIds={setSelectedIds}
                  composerFiles={composerFiles}
                  setComposerFiles={setComposerFiles}
                  onFileDropEnabledChange={setFileDropEnabled}
                  onGraduate={handleGraduate}
                  topInset={contentTopInset}
                  topOccluderRef={topNoticeRef}
                  liveDataReady={liveDataReady}
                  manualReconnectPending={manualReconnectPending}
                  composerControllerRef={composerControllerRef}
                  onComposerModelChange={handleComposerModelChange}
                />
              </Reanimated.View>
            ) : null}
          </View>
          {!selectionMode ? (
            composerModel.mode === 'input' ? (
              <ChatInput
                draftKey={conversationKey}
                liveDataEnabled={liveDataReady}
                disabled={composerModel.disabled}
                onSend={sendFromComposer}
                onPickAttachment={
                  composerModel.attachmentSources.length > 0 ? pickFromComposer : undefined
                }
                onPasteFiles={setComposerFiles}
                attachmentSources={composerModel.attachmentSources}
                onSendVoice={composerModel.supportsVoice ? sendVoiceFromComposer : undefined}
                replyTo={composerModel.replyTo}
                onCancelReply={cancelComposerReply}
              />
            ) : composerModel.gateStatus ? (
              <ChatComposerGate
                status={composerModel.gateStatus}
                onPressDetails={openComposerGateDetails}
              />
            ) : null
          ) : null}
        </ChatComposerPanelProvider>
        {/* Keep the blur after the dynamic list in render order. Expo BlurView
            otherwise may not refresh content mounted after it. */}
        {selectionMode ? (
          <SelectionHeader count={selectedIds.size} onCancel={exitSelection} />
        ) : (
          <ChatHeader
            counterpartyPubkey={conversationKey || null}
            fallbackName={typeof params.name === 'string' ? params.name : undefined}
            proximityConnectionStatus={
              isProximity ? proximityConnectionStatus : undefined
            }
            proximityNickname={persistedProximityPeer?.nickname}
            proximityDisplayName={persistedProximityPeer?.displayName}
            identityKind={isProximity ? 'proximity' : 'relay'}
            liveDataEnabled={liveDataReady}
          />
        )}
      </ChatFileDropZone>
    </AppScreen>
  );
}

type ChatPageContentProps = {
  relationship: PeerRelationship;
  selectionMode: boolean;
  setSelectionMode: Dispatch<SetStateAction<boolean>>;
  selectedIds: Set<string>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  composerFiles: ComposerFile[];
  setComposerFiles: Dispatch<SetStateAction<ComposerFile[]>>;
  onFileDropEnabledChange: (enabled: boolean) => void;
  onGraduate: () => void;
  topInset: number;
  topOccluderRef: MutableRefObject<View | null>;
  liveDataReady: boolean;
  manualReconnectPending: boolean;
  composerControllerRef: MutableRefObject<ChatComposerController | null>;
  onComposerModelChange: (model: ChatComposerModel) => void;
};

function ChatPageContent({
  relationship,
  selectionMode,
  setSelectionMode,
  selectedIds,
  setSelectedIds,
  composerFiles,
  setComposerFiles,
  onFileDropEnabledChange,
  onGraduate,
  topInset,
  topOccluderRef,
  liveDataReady,
  manualReconnectPending,
  composerControllerRef,
  onComposerModelChange,
}: ChatPageContentProps) {
  const insets = useSafeAreaInsets();
  const composerClearance = bottomBarHeight + getBottomChromeInset(insets.bottom);
  const { t } = useTranslation();
  const c = useThemeColors();
  const attachmentLabels = useMemo(
    () => ({
      file: t('conversations.attachment_file_preview'),
      image: t('conversations.attachment_image_preview'),
      video: t('conversations.attachment_video_preview'),
      voice: t('conversations.attachment_voice_preview'),
    }),
    [t],
  );
  const params = useLocalSearchParams<{
    key: string;
    from?: string;
    focus?: string;
    focusOrderAt?: string;
    focusAt?: string;
    transport?: string;
    name?: string;
  }>();
  const conversationKey = decodeURIComponent(params.key ?? '');
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const selfProfile = useProfile(accountPubkey, liveDataReady);
  const { wallets } = useWallets(accountPubkey, liveDataReady);
  const hasConnectedWallet = wallets.some((wallet) => wallet.accountPubkey === accountPubkey);
  const paymentRequestAvailable =
    hasConnectedWallet || !!(selfProfile?.lud16 || selfProfile?.lud06);
  const emojiCollection = useCustomEmojis(accountPubkey, liveDataReady);
  const ownedEmojiPacks = useMemo(
    () =>
      accountPubkey
        ? emojiCollection.packs.filter((pack) => pack.authorPubkey === accountPubkey)
        : [],
    [accountPubkey, emojiCollection.packs],
  );
  // Quick reactions for the long-press pill — user-configurable (Me → Chats →
  // Quick reactions); the "⋯" still opens the full picker.
  const quickEmojis = useReactionPrefsStore((s) => s.quickEmojis);
  const routeIsProximity = params.transport === 'proximity';
  const { conversation, loaded: conversationLoaded } = useConversation(
    accountPubkey ?? '',
    conversationKey,
    liveDataReady || routeIsProximity,
  );
  const isProximity =
    routeIsProximity || conversation?.deliveryKind === 'proximity';
  const deliveryKind = isProximity ? 'proximity' : 'relay';
  const attachmentSources = useMemo(
    () => conversationAttachmentSources(paymentRequestAvailable),
    [paymentRequestAvailable],
  );
  const supportsVoice = conversationSupportsContent('audio');
  const supportedMediaTypes = useMemo<ImagePicker.MediaType[]>(() => {
    const types: ImagePicker.MediaType[] = [];
    if (conversationSupportsContent('image')) types.push('images');
    if (conversationSupportsContent('video')) types.push('videos');
    return types;
  }, []);
  const proximityPeerDisplayName = isProximity
    ? (conversation?.name ?? (typeof params.name === 'string' ? params.name : null))
    : null;
  // Contact-card send: the shared share/forward confirmation, addressed to this
  // conversation, previewing the real outgoing bubble.
  const cardShareTarget = useMemo<ShareTarget>(
    () => ({
      conversationKey,
      deliveryKind,
      name: isProximity ? proximityPeerDisplayName : null,
    }),
    [conversationKey, deliveryKind, isProximity, proximityPeerDisplayName],
  );
  const cardPreviewMessages = useMemo<ForwardMessage[]>(
    () =>
      accountPubkey
        ? [{ kind: KIND_CHAT, content: shareContactContent(accountPubkey), tags: [] }]
        : [],
    [accountPubkey],
  );
  const { identity: liveProximityIdentity } = useProximityIdentity(
    accountPubkey,
    liveDataReady || isProximity,
  );
  // The nearby service and inbox live query both warm this account-scoped
  // session cache. Reading it synchronously prevents the first message paint
  // from classifying every nearby rumor as remote while this fallback query
  // resolves. A genuinely cold entry holds the rows instead of mispainting.
  const proximitySelfPubkey = useMemo(() => {
    if (!accountPubkey) return undefined;
    if (liveProximityIdentity?.accountPubkey === accountPubkey) {
      return rememberProximityPubkey(accountPubkey, liveProximityIdentity.proximityPubkey);
    }
    return getCachedProximityPubkey(accountPubkey);
  }, [accountPubkey, liveProximityIdentity]);
  const proximityOwnershipLoaded =
    !isProximity ||
    (conversationLoaded &&
      !!proximitySelfPubkey &&
      conversation?.proximityAccountPubkey != null);
  const proximityHistoryReadOnly =
    isProximity &&
    proximityOwnershipLoaded &&
    conversation?.proximityAccountPubkey !== proximitySelfPubkey;
  const messageSelfPubkey = isProximity ? proximitySelfPubkey : (accountPubkey ?? undefined);
  const menuQuickEmojis = quickEmojis;
  // Nearby peers have no relay-contact subscription; own-history chats do not
  // need one. Neither should wait indefinitely for a relationship verdict.
  const remoteContentMode = conversationRemoteContentMode(
    conversationLoaded,
    isProximity ? 'stranger' : conversationKey === accountPubkey ? 'contact' : relationship,
  );
  // The window carries reactions (kind 7) in the same stream; split them out —
  // bubbles render as messages, reactions as chips on their target.
  const {
    messages: windowRows,
    bubbleMessages: messages,
    reactionsByMessageId,
    presentationsByMessageId,
    bubbleRenderItemsById,
    loadOlder,
    loadNewer,
    hasMore,
    hasMoreNewer,
    anchored,
    windowLoaded,
    focusAnchor,
    jumpToTail,
  } = useMessages(
    accountPubkey ?? '',
    conversationKey,
    liveDataReady,
    messageSelfPubkey ?? '',
    isProximity,
  );

  // A search result deep in history: centre the window on it (once per focus
  // id), and remember the id locally so MessageList scrolls + flashes it once
  // the anchored window has loaded it. Initialised synchronously from the param
  // (not in the effect) so MessageList knows at its first render that this is a
  // jump-open — letting it mount the list pointed at the target rather than at
  // the tail.
  const [focusMessageId, setFocusMessageId] = useState<string | undefined>(() =>
    typeof params.focus === 'string' ? params.focus : undefined,
  );
  const focusAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    const id = typeof params.focus === 'string' ? params.focus : undefined;
    const orderAt = params.focusOrderAt
      ? Number(params.focusOrderAt)
      : params.focusAt
        ? Number(params.focusAt) * 1000
        : undefined;
    if (id && orderAt && focusAppliedRef.current !== id) {
      focusAppliedRef.current = id;
      setFocusMessageId(id);
      focusAnchor({ id, orderAt });
    }
  }, [params.focus, params.focusOrderAt, params.focusAt, focusAnchor]);
  const messageIdList = useMemo(() => messages.map((m) => m.id), [messages]);
  const deliveriesByMessageId = useMessageDeliveries(messageIdList, liveDataReady);

  // Reply targets that fall outside the loaded window — fetched by id so the
  // reply preview still resolves (the message is in the local DB, just not on
  // this page).
  const replyTargetIds = useMemo(() => {
    const loaded = new Set(messageIdList);
    const out = new Set<string>();
    for (const m of messages) {
      if (m.replyToId && !loaded.has(m.replyToId)) out.add(m.replyToId);
    }
    return Array.from(out);
  }, [messages, messageIdList]);
  const referencedById = useMessagesByIds(accountPubkey ?? '', replyTargetIds, liveDataReady);

  // Optimistic text bubbles: rendered the instant Send is tapped, before the
  // rumor is written to the DB and round-tripped through the live query — so a
  // sent message appears immediately. The optimistic row uses the deterministic
  // rumor id from the start, so the DB handoff preserves the FlatList key and
  // cannot restart the in-progress scroll-to-tail animation.
  const [optimistic, setOptimistic] = useState<MessageRow[]>([]);

  const reconciled = (o: MessageRow, m: MessageRow) => m.id === o.id;

  const visibleOptimistic = useMemo(
    () =>
      optimistic.length === 0
        ? optimistic
        : optimistic.filter((o) => !messages.some((m) => reconciled(o, m))),

    [optimistic, messages],
  );
  const displayMessages = useMemo(
    () => (visibleOptimistic.length === 0 ? messages : [...messages, ...visibleOptimistic]),
    [messages, visibleOptimistic],
  );
  // Give optimistic rows a synthetic 'signing' delivery so they show the same
  // [text · time · status] shape as the real bubble that replaces them — the
  // handoff is then seamless (no width change from a missing status glyph).
  const deliveriesForDisplay = useMemo(() => {
    if (visibleOptimistic.length === 0) return deliveriesByMessageId;
    const m: typeof deliveriesByMessageId = { ...deliveriesByMessageId };
    for (const o of visibleOptimistic) {
      m[o.id] = isProximity
        ? { rumorId: o.id, phase: 'queued', transport: 'proximity', copies: [] }
        : { rumorId: o.id, phase: 'signing', copies: [] };
    }
    return m;
  }, [deliveriesByMessageId, visibleOptimistic, isProximity]);

  // Drop optimistic rows once their real DB row has landed; reset on conv change.
  useEffect(() => {
    setOptimistic((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.filter((o) => !messages.some((m) => reconciled(o, m)));
      return next.length === prev.length ? prev : next;
    });
  }, [messages]);
  useEffect(() => {
    setOptimistic([]);
  }, [conversationKey]);

  const inFlight = useInFlightAttachmentsFor(accountPubkey ?? '', conversationKey);
  const enqueuePending = usePendingAttachmentsStore((s) => s.enqueue);
  const removeOnePending = usePendingAttachmentsStore((s) => s.removeOne);
  const markSendingPending = usePendingAttachmentsStore((s) => s.markSending);
  const setStatusPending = usePendingAttachmentsStore((s) => s.setStatus);
  const markPausedPending = usePendingAttachmentsStore((s) => s.markPaused);
  const markUploadedPending = usePendingAttachmentsStore((s) => s.markUploaded);
  const markSentPending = usePendingAttachmentsStore((s) => s.markSent);
  const markFailedPending = usePendingAttachmentsStore((s) => s.markFailed);
  // Explicit UI events for MessageList. Store hydration must never be mistaken
  // for a new send/failure when reopening a conversation.
  const [pendingTailVersion, setPendingTailVersion] = useState(0);
  const [pendingFailureVersion, setPendingFailureVersion] = useState(0);
  const attachmentAbortControllersRef = useRef(new Map<string, AbortController>());
  const nearbyUploadKeysRef = useRef(new Map<string, string>());
  const attachmentStagingRef = useRef(
    new Map<string, Promise<PendingAttachment | null>>(),
  );

  const [replyingTo, setReplyingTo] = useState<MessageRow | null>(null);
  // Long-press action-menu target: the message, its measured rect, and a
  // ready-to-render lifted copy. Cleared on dismiss.
  const [menuTarget, setMenuTarget] = useState<MessageRow | null>(null);
  const [pendingMenuTarget, setPendingMenuTarget] = useState<PendingAttachment | null>(null);
  // The lifted bubble's screen rect + render data, set/cleared as one (the menu
  // is shown while this is non-null). `menuTarget` is tracked separately because
  // it must outlive this across the "⋯" → emoji-picker handoff.
  const [menuAnchor, setMenuAnchor] = useState<{
    rect: BubbleRect;
    bubble: LiftedBubble;
    contentTop?: number;
    contentBottom?: number;
    preserveKeyboard: boolean;
  } | null>(null);
  // The message-list viewport (between the header and the input). Measured on
  // long-press so the action menu clips its lifted copy to where the bubble is
  // actually visible — never over the header/input.
  const contentRef = useRef<View>(null);
  const startForwardDraft = useForwardDraftStore((state) => state.start);
  const completedForward = useForwardDraftStore((state) => state.completed);
  const consumeForwardCompletion = useForwardDraftStore((state) => state.consumeCompletion);
  // A message-menu forward waits for that native Modal to unmount before the
  // route push begins, otherwise the outgoing menu can overlap the incoming
  // page transition on iOS.
  const [pendingForwardMessages, setPendingForwardMessages] = useState<ForwardMessage[] | null>(
    null,
  );
  // Full emoji picker (opened from the pill's "⋯"); keeps `menuTarget` as the
  // reaction target while the context menu itself is hidden.
  const [emojiPickerMounted, setEmojiPickerMounted] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiPickerAnchor, setEmojiPickerAnchor] = useState<EmojiPickerPopoverAnchor | null>(null);
  // "⋯" was tapped: open the picker only once the action menu has fully closed
  // (two RN modals can't be presented at once — see handleOpenEmojiPicker).
  const [pendingPicker, setPendingPicker] = useState(false);
  const [pendingPickerAnchor, setPendingPickerAnchor] = useState<EmojiPickerPopoverAnchor | null>(
    null,
  );
  // A reaction chosen from the pill, applied only after the menu has fully
  // closed: adding a reaction grows the row (a chip appears) and the inverted
  // list nudges the bubble up, which would otherwise misalign the still-showing
  // lifted copy and flash a second bubble.
  const [pendingReaction, setPendingReaction] = useState<{
    target: MessageRow;
    emoji: QuickReaction;
  } | null>(null);
  const [detailRumorId, setDetailRumorId] = useState<string | null>(null);
  // "Info" was tapped: open the detail sheet only once the action menu has fully
  // closed (two RN modals can't be presented at once — opening the sheet while
  // the menu's modal is still dismissing freezes the app, same hazard as the
  // emoji picker above).
  const [pendingDetailId, setPendingDetailId] = useState<string | null>(null);
  const [pendingSaveUpload, setPendingSaveUpload] = useState<PendingAttachment | null>(null);
  // Enter selection mode only *after* the action menu has fully closed, so the
  // bubble's selection shift doesn't animate while the lifted copy is still
  // retreating to the (un-shifted) original position — they'd visibly diverge.
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);
  const [pendingPackPickerEmoji, setPendingPackPickerEmoji] = useState<CustomEmoji | null>(null);
  const [packPickerEmoji, setPackPickerEmoji] = useState<CustomEmoji | null>(null);
  const [packPickerVisible, setPackPickerVisible] = useState(false);
  const pendingPackEditorRef = useRef<{
    emoji: CustomEmoji;
    coordinate?: string;
  } | null>(null);

  const messageIds = useMemo(() => new Set(messageIdList), [messageIdList]);

  useEffect(() => {
    if (
      !completedForward ||
      completedForward.accountPubkey !== accountPubkey ||
      completedForward.sourceConversationKey !== conversationKey ||
      !consumeForwardCompletion(completedForward.id)
    ) {
      return;
    }
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, [
    accountPubkey,
    completedForward,
    consumeForwardCompletion,
    conversationKey,
    setSelectedIds,
    setSelectionMode,
  ]);

  // The conversation_key IS the counterparty pubkey (our own, for a note-to-self),
  // so the counterparty set is just it.
  const counterparties = useMemo(() => [conversationKey], [conversationKey]);

  // Can we actually deliver to this conversation's counterparties? Gates the
  // composer: until both their encryption key and DM relays are known we don't
  // let the user type, and if either is missing we explain why instead of
  // letting a send fail silently.
  // Reachability is part of composer readiness, so resolve it immediately while
  // the rest of the live data waits for transitionEnd. The local state stays
  // visually identical to ready; a cached verdict therefore causes no flash.
  const dmSupport = useDmSupport(isProximity ? [] : counterparties);
  const [showUnsupported, setShowUnsupported] = useState(false);
  const [cardSheetOpen, setCardSheetOpen] = useState(false);
  // Attachment-tray open state, lifted here so a tap on the messages can close
  // it (a transparent overlay below covers the list while it's open).
  const [photoCaptureOpen, setPhotoCaptureOpen] = useState(false);
  const capturedPhotoRef = useRef<PickedAttachment | null>(null);
  const [pickedAttachments, setPickedAttachments] = useState<PickedAttachment[]>([]);
  const [pickedConfirmationVisible, setPickedConfirmationVisible] = useState(false);
  const pickedConfirmationFiles = useMemo<AttachmentConfirmationFile[]>(
    () =>
      pickedAttachments.map(({ uri, ...file }) => ({
        ...file,
        source: { kind: 'uri', uri },
      })),
    [pickedAttachments],
  );
  const composerConfirmationFiles = useMemo<AttachmentConfirmationFile[]>(
    () =>
      composerFiles.map(({ file, uri, temporary: _temporary, ...item }) => ({
        ...item,
        source: file
          ? { kind: 'browser' as const, file }
          : { kind: 'uri' as const, uri },
      })),
    [composerFiles],
  );

  // The 1:1 peer also supplies the wallet invoice target. Relationship chrome
  // lives in the stable parent shell so it is shared by preview and full modes.
  const peerPubkey = counterparties.length === 1 ? counterparties[0] : null;
  // A recheck (or a live key/relay update) that makes the peer reachable closes
  // the reason sheet — the composer takes over and there's nothing left to show.
  useEffect(() => {
    if (dmSupport.status === 'ready') setShowUnsupported(false);
  }, [dmSupport.status]);

  const fileDropEnabled =
    !selectionMode &&
    composerFiles.length === 0 &&
    pickedAttachments.length === 0 &&
    (isProximity
      ? !!proximitySelfPubkey && proximityOwnershipLoaded && !proximityHistoryReadOnly
      : dmSupport.status === 'ready');
  useEffect(() => {
    onFileDropEnabledChange(fileDropEnabled);
  }, [fileDropEnabled, onFileDropEnabledChange]);

  const replyingToSenderProfile = useProfile(replyingTo?.senderPubkey ?? null, liveDataReady);
  const replyingToSenderContact = useContact(
    accountPubkey ?? '',
    replyingTo?.senderPubkey ?? '',
    liveDataReady,
  );

  useEffect(() => {
    if (!liveDataReady) return;
    if (isProximity) return;
    if (!conversationKey) return;
    // Open the chat → subscribe to counterparties' encryption keys and prefetch
    // their DM relay lists, so sending later reads only warmed-up local data.
    const unsub = encryptionKeyWatcher.watch([conversationKey]);
    dmService.prefetchCounterpartyRelays([conversationKey]);
    return unsub;
  }, [conversationKey, isProximity, liveDataReady]);

  useEffect(() => {
    if (!liveDataReady) return;
    if (!isProximity || !accountPubkey || proximityHistoryReadOnly) return;
    let release: (() => void) | null = null;
    let cancelled = false;
    void proximityService
      .acquire(accountPubkey, { activePeer: conversationKey })
      .then((cleanup) => {
        if (cancelled) cleanup();
        else release = cleanup;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      release?.();
    };
  }, [accountPubkey, conversationKey, isProximity, liveDataReady, proximityHistoryReadOnly]);

  // The unread watermark frozen at the moment this chat was opened — drives the
  // "unread messages" divider. Captured before marking the conversation read
  // (which wipes it). Only set when there's a real boundary to draw: some unread
  // *and* a prior read point above them (`lastReadOrderAt`); a never-opened
  // conversation has no read history to divide from, so no divider.
  const [unreadBoundary, setUnreadBoundary] = useState<
    | {
        orderAt: number;
        id: string | null;
        firstUnreadOrderAt: number;
        firstUnreadId: string;
        count: number;
      }
    | null
    | undefined
  >(undefined);
  useEffect(() => {
    if (!liveDataReady) return;
    if (!accountPubkey || !conversationKey) return;
    dmService.setActiveConversation(accountPubkey, conversationKey);
    setUnreadBoundary(undefined);
    let cancelled = false;
    void dmService
      .captureUnreadAndMarkRead(accountPubkey, conversationKey)
      .then((b) => {
        if (cancelled) return;
        if (
          b.unreadCount > 0 &&
          b.lastReadOrderAt != null &&
          b.firstUnreadOrderAt != null &&
          b.firstUnreadMessageId != null
        ) {
          setUnreadBoundary({
            orderAt: b.lastReadOrderAt,
            id: b.lastReadMessageId,
            firstUnreadOrderAt: b.firstUnreadOrderAt,
            firstUnreadId: b.firstUnreadMessageId,
            count: b.unreadCount,
          });
        } else {
          setUnreadBoundary(null);
        }
      })
      .catch(() => {
        if (!cancelled) setUnreadBoundary(null);
      });
    return () => {
      cancelled = true;
      dmService.clearActiveConversation();
    };
  }, [accountPubkey, conversationKey, liveDataReady]);

  // Reconcile sent placeholders against the DB: once the real rumor renders,
  // drop the in-memory bubble. MessageList already hides it this same frame,
  // so this is just store cleanup.
  useEffect(() => {
    const sentReal = inFlight.filter(
      (p) => p.status === 'sent' && p.sentRumorId && messageIds.has(p.sentRumorId),
    );
    for (const p of sentReal) removeOnePending(p.tempId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageIds, inFlight]);

  function recoverProximityDelivery() {
    if (!isProximity || !accountPubkey || proximityHistoryReadOnly) return;
    void proximityService
      .recoverConnection(accountPubkey, conversationKey)
      .catch(() => showToast(t('nearby.request_failed')));
  }

  /** Encrypt + upload + store one attachment. Owns the pending-store
   * lifecycle for that item. */
  async function uploadOnePending(
    item: PendingAttachment,
    controller: AbortController,
  ): Promise<void> {
    if (!accountPubkey) return;
    try {
      const signer = await buildSigner(accountPubkey);
      if (controller.signal.aborted) {
        const error = new Error('Attachment send stopped');
        error.name = 'AbortError';
        throw error;
      }
      const dim = item.width && item.height ? `${item.width}x${item.height}` : undefined;

      const { rumorIds } = await conversationSendService.sendFile({
        accountPubkey,
        signer,
        targets: [{ deliveryKind, conversationKey }],
        localUri: item.localUri,
        mime: item.mime,
        name: item.name,
        dim,
        durationSec: item.durationSec,
        waveform: item.waveform,
        imageQuality: item.imageQuality,
        timestamp:
          item.messageOrderAt == null
            ? undefined
            : rumorTimestampFromOrderAt(item.messageOrderAt),
        replyToId: item.replyToId,
        subject: conversation?.name ?? undefined,
        onStep: (step) => {
          const percent =
            step === 'encrypting'
              ? UPLOAD_ENCRYPTING_PERCENT
              : step === 'uploading'
                ? UPLOAD_BYTES_START_PERCENT
                : null;
          if (percent != null) {
            attachmentTransferStore
              .getState()
              .update(attachmentTransferKey(accountPubkey, item.tempId), 'upload', percent, 100);
          }
          setStatusPending(item.tempId, step);
        },
        onUploadProgress: (sentBytes, totalBytes) =>
          attachmentTransferStore
            .getState()
            .update(
              attachmentTransferKey(accountPubkey, item.tempId),
              'upload',
              uploadByteProgress(sentBytes, totalBytes),
              100,
            ),
        onUploadPrepared: ({ cipherSha256Hex }) => {
          if (!isProximity) return;
          const current = usePendingAttachmentsStore
            .getState()
            .items.find((candidate) => candidate.tempId === item.tempId);
          if (!current) {
            void nearbyFileUploadService.discard(accountPubkey, cipherSha256Hex);
            return;
          }
          nearbyUploadKeysRef.current.set(item.tempId, cipherSha256Hex);
          if (current.status === 'paused') {
            void nearbyFileUploadService.pause(accountPubkey, cipherSha256Hex);
          }
        },
        onLocalFileReady: async ({ uri, mime }) => {
          if (mime.startsWith('image/')) {
            await ExpoImage.prefetch(uri, 'memory-disk');
          }
        },
        onUploadReady: ({ url }) => markUploadedPending(item.tempId, url),
        signal: controller.signal,
      });
      // Success — keep the local bubble visible (status 'sent') until the
      // live-query bubble for this rumor renders, then a cleanup effect drops
      // it. Avoids a gap/flicker during the swap.
      const rumorId = rumorIds[0];
      if (!rumorId) throw new Error('Attachment message was not stored');
      markSentPending(item.tempId, rumorId);
      nearbyUploadKeysRef.current.delete(item.tempId);
      recoverProximityDelivery();
    } catch (err) {
      if (isAbortError(err)) {
        const current = usePendingAttachmentsStore
          .getState()
          .items.find((candidate) => candidate.tempId === item.tempId);
        if (
          attachmentAbortControllersRef.current.get(item.tempId) === controller &&
          current &&
          current.status !== 'paused'
        ) {
          markPausedPending(item.tempId);
        }
        return;
      }
      markFailedPending(item.tempId, err instanceof Error ? err.message : String(err));
      setPendingFailureVersion((version) => version + 1);
    } finally {
      attachmentTransferStore
        .getState()
        .clear(attachmentTransferKey(accountPubkey, item.tempId));
      if (attachmentAbortControllersRef.current.get(item.tempId) === controller) {
        attachmentAbortControllersRef.current.delete(item.tempId);
      }
    }
  }

  function handleSend(text: string, customEmojis: CustomEmoji[]) {
    if (!accountPubkey || text.length === 0) {
      return Promise.reject(new Error('Message is empty'));
    }
    if (isProximity && (!proximitySelfPubkey || proximityHistoryReadOnly)) {
      return Promise.reject(new Error('Nearby conversation is not writable'));
    }

    // Sending while reading history (an anchored, jumped-to window) returns to the
    // live tail — same as the scroll-to-bottom button — so the new message is
    // shown: drop the anchor, the tail reloads, and MessageList lands at the newest.
    if (anchored) jumpToTail();

    // A send graduates a request out of the inbox gate.
    onGraduate();

    const replyToId = replyingTo?.id;
    setReplyingTo(null);

    // No SecureStore read here — the service already holds the encryption
    // keypair; awaiting a keychain read would delay the optimistic bubble.
    // Show the bubble synchronously, before the DB write + live-query round
    // trip, so it appears the instant Send is tapped.
    // Monotonic, captured here at tap time so rapid sends keep millisecond order;
    // threaded into sendMessage so the optimistic bubble and stored rumor share it.
    const timestamp = nextRumorTimestamp();
    let tags: string[][] = counterparties.map((r) => ['p', r]);
    const emojiTags = customEmojis.map(buildEmojiTag);
    tags.push(...emojiTags);
    if (replyToId) tags.push(['e', replyToId]);
    if (!isProximity && conversation?.name) tags.push(['subject', conversation.name]);
    tags = withMessageOrderTag(tags, timestamp.millisecond);
    const template = {
      kind: 14,
      content: text,
      tags,
      created_at: timestamp.createdAt,
    };
    const optimisticRumor = buildRumor(
      template,
      isProximity ? proximitySelfPubkey! : accountPubkey,
    );
    const optimisticRow: MessageRow = {
      accountPubkey,
      id: optimisticRumor.id!,
      conversationKey,
      senderPubkey: isProximity ? proximitySelfPubkey! : accountPubkey,
      kind: 14,
      content: text,
      createdAt: timestamp.createdAt,
      orderAt: timestamp.orderAt,
      replyToId: replyToId ?? null,
      subject: isProximity ? null : (conversation?.name ?? null),
      tags,
      rumor: optimisticRumor,
      sourceRelays: null, // our own outgoing message — no inbound source
    };
    setOptimistic((prev) => [...prev, optimisticRow]);
    // Defer the encrypt/store/publish to the next macrotask. expo-sqlite runs
    // synchronously and gift-wrap signing (NIP-44 + schnorr) is heavy CPU;
    // awaiting them here keeps the JS thread busy in one microtask chain, so
    // React can't paint the optimistic bubble / cleared input until it all
    // finishes (~0.5s). A macrotask lets the UI paint first, then the work
    // runs. On failure the optimistic bubble is rolled back.
    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        void conversationSendService
          .sendMessage({
            accountPubkey,
            target: { deliveryKind, conversationKey },
            content: text,
            replyToId,
            subject: isProximity ? undefined : (conversation?.name ?? undefined),
            extraTags: emojiTags,
            timestamp,
          })
          .then(() => {
            // Persist the immutable rumor and outbox entry before connection
            // recovery. A declined or unavailable peer therefore leaves a
            // visible queued message instead of restoring it to the composer.
            recoverProximityDelivery();
            resolve();
          })
          .catch((error) => {
            setOptimistic((prev) => prev.filter((o) => o.id !== optimisticRow.id));
            reject(error);
          });
      }, 0);
    });
  }

  /** Reserve attachment ordering slots, enqueue their placeholders immediately,
   * and resolve after every upload attempt settles. */
  function sendAttachments(
    parts: Omit<
      PendingAttachment,
      | 'accountPubkey'
      | 'conversationKey'
      | 'localName'
      | 'status'
      | 'startedAt'
      | 'messageOrderAt'
      | 'replyToId'
      | 'error'
    >[],
    onStaged?: (items: PendingAttachment[]) => void,
  ): Promise<void> {
    if (!accountPubkey || parts.length === 0) return Promise.resolve();
    if (isProximity && proximityHistoryReadOnly) return Promise.resolve();
    // As with text: sending from an anchored (jumped-to) window returns to the
    // live tail so the new attachment is shown at the newest.
    if (anchored) jumpToTail();
    onGraduate();
    const replyToId = replyingTo?.id;
    setReplyingTo(null);
    const baseTs = Math.floor(Date.now() / 1000);
    const items: PendingAttachment[] = parts.map((p, idx) => ({
      ...p,
      accountPubkey,
      conversationKey,
      status: 'preparing',
      startedAt: baseTs + idx,
      messageOrderAt: nextRumorTimestamp().orderAt,
      replyToId,
    }));
    for (const item of items) {
      attachmentTransferStore
        .getState()
        .update(
          attachmentTransferKey(accountPubkey, item.tempId),
          'upload',
          UPLOAD_PREPARING_PERCENT,
          100,
        );
    }
    const attemptControllers = new Map<string, AbortController>();
    for (const item of items) {
      const controller = new AbortController();
      attemptControllers.set(item.tempId, controller);
      attachmentAbortControllersRef.current.set(item.tempId, controller);
    }
    setPendingTailVersion((version) => version + 1);
    const stagedBatch = enqueuePending(items);
    void stagedBatch.then((stagedItems) => {
      onStaged?.(stagedItems);
    });
    const uploads = items.map((item) => {
      const staged = stagedBatch.then(
        (stagedItems) =>
          stagedItems.find((candidate) => candidate.tempId === item.tempId) ?? null,
      );
      attachmentStagingRef.current.set(item.tempId, staged);
      void staged.finally(() => {
        if (attachmentStagingRef.current.get(item.tempId) === staged) {
          attachmentStagingRef.current.delete(item.tempId);
        }
      });
      return staged.then((stagedItem) => {
        const controller = attemptControllers.get(item.tempId);
        if (stagedItem && controller) {
          return uploadOnePending(stagedItem, controller);
        }
      });
    });
    return Promise.all(uploads).then(() => undefined);
  }

  function sendComposerFiles(imageQuality: ImageSendQuality, supplementaryMessage: string) {
    if (composerFiles.length === 0) return;
    if (isProximity && (!proximityOwnershipLoaded || proximityHistoryReadOnly)) return;
    const sourceUris = new Map<string, string>();
    const temporaryFiles = composerFiles.filter((file) => file.temporary);
    const parts = composerFiles.map((file) => {
      const tempId = newTempId();
      const sourceUri = file.file ? URL.createObjectURL(file.file) : file.uri;
      if (file.file) sourceUris.set(tempId, sourceUri);
      return {
        tempId,
        localUri: sourceUri,
        mime: file.mime,
        width: file.width,
        height: file.height,
        name: file.name,
        size: file.size || undefined,
        imageQuality,
      };
    });
    // Confirmation is now committed. Close the dialog before staging begins so
    // its Cancel/remove actions cannot contradict an already-started send.
    setComposerFiles([]);
    void sendAttachments(parts, (stagedItems) => {
      // Once the durable pending copy exists, release Chromium's temporary
      // browser blob. A staging failure keeps the URL alive for the current
      // upload/retry attempt instead of discarding the user's selected file.
      for (const item of stagedItems) {
        if (!item.localName) continue;
        const sourceUri = sourceUris.get(item.tempId);
        if (sourceUri) URL.revokeObjectURL(sourceUri);
      }
      discardTemporaryComposerFiles(temporaryFiles);
    }).catch(() => discardTemporaryComposerFiles(temporaryFiles));
    if (supplementaryMessage) void handleSend(supplementaryMessage, []).catch(() => {});
  }

  function previewMedia(assets: ImagePicker.ImagePickerAsset[]) {
    setPickedAttachments(
      assets.map((asset) => ({
        uri: asset.uri,
        mime: asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
        name: asset.fileName ?? undefined,
        size: asset.fileSize,
        width: asset.width,
        height: asset.height,
      })),
    );
    setPickedConfirmationVisible(true);
  }

  function sendPickedAttachments(
    imageQuality: ImageSendQuality,
    supplementaryMessage: string,
  ) {
    const files = pickedAttachments;
    if (files.length === 0) return;
    setPickedConfirmationVisible(false);
    void sendAttachments(
      files.map((file) => ({
        tempId: newTempId(),
        localUri: file.uri,
        mime: file.mime,
        width: file.width,
        height: file.height,
        name: file.name,
        size: file.size,
        imageQuality: file.mime.startsWith('image/') ? imageQuality : undefined,
      })),
    );
    if (supplementaryMessage) void handleSend(supplementaryMessage, []).catch(() => {});
  }

  function handleSendVoice(payload: VoicePayload) {
    void sendAttachments([
      {
        tempId: newTempId(),
        localUri: payload.uri,
        mime: payload.mime,
        durationSec: payload.durationSec,
        waveform: payload.waveform,
      },
    ]);
  }

  async function pickFromCamera() {
    if (IS_ELECTRON) {
      capturedPhotoRef.current = null;
      setPhotoCaptureOpen(true);
      return;
    }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      await platform.confirmationDialog.notify({
        title: t('attach.camera_permission'),
        okLabel: t('common.ok'),
      });
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: supportedMediaTypes,
      quality: 1,
      exif: false,
    });
    if (result.canceled || result.assets.length === 0) return;
    previewMedia(result.assets);
  }

  async function pickFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      await platform.confirmationDialog.notify({
        title: t('attach.library_permission'),
        okLabel: t('common.ok'),
      });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: supportedMediaTypes,
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 1,
      exif: false,
    });
    if (result.canceled || result.assets.length === 0) return;
    previewMedia(result.assets);
  }

  async function pickFiles() {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled || result.assets.length === 0) return;
    setPickedAttachments(
      result.assets.map((asset) => ({
        uri: asset.uri,
        mime: asset.mimeType ?? 'application/octet-stream',
        name: asset.name,
        size: asset.size ?? undefined,
      })),
    );
    setPickedConfirmationVisible(true);
  }

  function createInvoiceForPeer() {
    if (!accountPubkey || !peerPubkey || !paymentRequestAvailable) return;
    router.push(
      `/wallet-receive?sendTo=${encodeURIComponent(peerPubkey)}&conversationKey=${encodeURIComponent(conversationKey)}&transport=${deliveryKind}`,
    );
  }

  function launchPicker(source: AttachmentSource) {
    if (!accountPubkey) return;
    if (source === 'invoice') createInvoiceForPeer();
    else if (source === 'card') setCardSheetOpen(true);
    else if (source === 'camera') void pickFromCamera();
    else if (source === 'library') void pickFromLibrary();
    else void pickFiles();
  }

  function sendContactCard() {
    if (!accountPubkey) return;
    setCardSheetOpen(false);
    void handleSend(shareContactContent(accountPubkey), []).catch(() => {});
  }

  async function retryPending(tempId: string) {
    if (!accountPubkey) return;
    if (isProximity && (!proximityOwnershipLoaded || proximityHistoryReadOnly)) return;
    let item = inFlight.find((candidate) => candidate.tempId === tempId);
    if (!item) return;
    // Re-stamp startedAt so the bubble jumps back to the bottom on retry.
    const startedAt = Math.floor(Date.now() / 1000);
    attachmentTransferStore
      .getState()
      .update(
        attachmentTransferKey(accountPubkey, tempId),
        'upload',
        UPLOAD_PREPARING_PERCENT,
        100,
      );
    markSendingPending(tempId, { startedAt, replyToId: item.replyToId });
    setPendingTailVersion((version) => version + 1);
    const controller = new AbortController();
    attachmentAbortControllersRef.current.set(tempId, controller);
    const nearbyUploadKey = nearbyUploadKeysRef.current.get(tempId);
    if (nearbyUploadKey) {
      nearbyUploadKeysRef.current.delete(tempId);
      await nearbyFileUploadService.discard(accountPubkey, nearbyUploadKey).catch(() => {});
    }
    const staged = await attachmentStagingRef.current.get(tempId);
    item =
      staged ??
      usePendingAttachmentsStore
        .getState()
        .items.find((candidate) => candidate.tempId === tempId);
    if (!item) return;
    void uploadOnePending(
      {
        ...item,
        status: 'preparing',
        startedAt,
      },
      controller,
    );
  }

  function handleRetryPending(tempId: string) {
    void retryPending(tempId);
  }

  function handleStopPending(tempId: string) {
    const item = usePendingAttachmentsStore
      .getState()
      .items.find((candidate) => candidate.tempId === tempId);
    if (
      !item ||
      !['preparing', 'encrypting', 'uploading'].includes(item.status)
    ) {
      return;
    }
    markPausedPending(tempId);
    attachmentAbortControllersRef.current.get(tempId)?.abort();
    const nearbyUploadKey = nearbyUploadKeysRef.current.get(tempId);
    if (nearbyUploadKey && accountPubkey) {
      void nearbyFileUploadService.pause(accountPubkey, nearbyUploadKey);
    }
  }

  function handleCancelPending(tempId: string) {
    attachmentAbortControllersRef.current.get(tempId)?.abort();
    if (accountPubkey) {
      attachmentTransferStore
        .getState()
        .clear(attachmentTransferKey(accountPubkey, tempId));
      const nearbyUploadKey = nearbyUploadKeysRef.current.get(tempId);
      if (nearbyUploadKey) {
        nearbyUploadKeysRef.current.delete(tempId);
        void nearbyFileUploadService.discard(accountPubkey, nearbyUploadKey);
      }
    }
    removeOnePending(tempId);
  }

  /** Save an image/video attachment to the device photo library. Resolves the
   * local file (downloading + decrypting it if needed), then reports the result. */
  async function handleSaveMedia(meta: FileAttachmentMeta) {
    const result = await saveAttachmentToLibrary(meta, { accountPubkey });
    if (result === 'denied') {
      await platform.confirmationDialog.notify({
        title: t('attach.save_permission'),
        okLabel: t('common.ok'),
      });
    } else if (result === 'failed') {
      await platform.confirmationDialog.notify({
        title: t('attach.save_failed'),
        okLabel: t('common.ok'),
      });
    } else {
      await platform.confirmationDialog.notify({
        title: t('attach.saved'),
        okLabel: t('common.ok'),
      });
    }
  }

  async function handleSavePendingUpload(pending: PendingAttachment) {
    if (pending.mime.startsWith('image/') || pending.mime.startsWith('video/')) {
      const result = await saveUriToLibrary(pending.localUri);
      if (result === 'denied') {
        await platform.confirmationDialog.notify({
          title: t('attach.save_permission'),
          okLabel: t('common.ok'),
        });
      } else if (result === 'failed') {
        await platform.confirmationDialog.notify({
          title: t('attach.save_failed'),
          okLabel: t('common.ok'),
        });
      } else {
        await platform.confirmationDialog.notify({
          title: t('attach.saved'),
          okLabel: t('common.ok'),
        });
      }
      return;
    }
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing unavailable');
      const uri = await copyForShare(pending.localUri, pending.name);
      await Sharing.shareAsync(uri, { mimeType: pending.mime });
    } catch {
      await platform.confirmationDialog.notify({
        title: t('attach.save_failed'),
        okLabel: t('common.ok'),
      });
    }
  }

  function openMeasuredMenu(rect: BubbleRect, bubble: LiftedBubble) {
    const preserveKeyboard = KeyboardController.isVisible();
    const node = contentRef.current;
    if (!node) {
      setMenuAnchor({ rect, bubble, preserveKeyboard });
      return;
    }

    node.measureInWindow((_x, y, _w, h) => {
      const setAnchor = (occlusionBottom?: number) => {
        const viewport = resolveMessageContentViewport({
          containerTop: y,
          containerHeight: h,
          topInset,
          bottomInset: composerClearance,
          occlusionBottom,
        });
        setMenuAnchor({
          rect,
          bubble,
          preserveKeyboard,
          ...viewport,
        });
      };

      // Relay relationship notices and the Nearby reconnect notice share this
      // measured occlusion boundary, so lifted messages and their action
      // surfaces never paint under either strip.
      const occluder = topOccluderRef.current;
      if (!occluder) {
        setAnchor();
        return;
      }
      occluder.measureInWindow((_barX, barY, _barW, barH) => setAnchor(barY + barH));
    });
  }

  function handleLongPress(message: MessageRow, rect: BubbleRect, bubble: LiftedBubble) {
    setPendingMenuTarget(null);
    setMenuTarget(message);
    openMeasuredMenu(rect, bubble);
  }

  function handlePendingLongPress(
    pending: PendingAttachment,
    rect: BubbleRect,
    bubble: LiftedBubble,
  ) {
    setMenuTarget(null);
    setPendingMenuTarget(pending);
    openMeasuredMenu(rect, bubble);
  }

  function closeMenu() {
    setMenuTarget(null);
    setPendingMenuTarget(null);
    setMenuAnchor(null);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // The forward page receives the original rumor kind/content/tags through an
  // ephemeral in-memory handoff, so attachments remain intact without bloating
  // the route URL.
  function openForwardPage(messages: ForwardMessage[]) {
    if (!accountPubkey || messages.length === 0) return;
    startForwardDraft({
      accountPubkey,
      sourceConversationKey: conversationKey,
      messages,
    });
    router.push('/forward');
  }

  function forwardSelected() {
    const order = new Map(windowRows.map((m, i) => [m.id, i] as const));
    const picked = windowRows
      .filter((m) => selectedIds.has(m.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((m) => ({ kind: m.kind, content: m.content, tags: m.tags }));
    if (picked.length === 0) return;
    openForwardPage(picked);
  }

  /** Send the reaction. Reactions are **not** retractable — an un-react could
   * only delete our local copy, but the kind-7 event stays on the relay so the
   * peer would still see it; a fake local-only retract would mislead. So
   * reacting again with an emoji we already used is a no-op. Shared by the pill,
   * the full picker, and the in-list chip tap. */
  async function applyReaction(targetMessage: MessageRow, emoji: string | CustomEmoji) {
    if (!accountPubkey) return;
    if (isProximity && (!proximityOwnershipLoaded || proximityHistoryReadOnly)) return;
    const selectedReactionKey = quickReactionKey(emoji);
    const alreadyReacted = reactionsByMessageId[targetMessage.id]?.some(
      (reaction) =>
        reaction.selfReacted &&
        quickReactionKey(reaction.customEmoji ?? reaction.emoji) === selectedReactionKey,
    );
    if (alreadyReacted) return;
    // Reacting counts as engaging, like a reply: it graduates a request out of
    // the inbox gate (storeRumor sets hasReplied for the outgoing kind-7), so
    // backing out should land on the Chats home, not the Requests list.
    onGraduate();
    const encKp = isProximity ? undefined : await loadEncryptionKeypair(accountPubkey);
    if (!isProximity && !encKp) return;
    await conversationSendService.sendReaction({
      accountPubkey,
      target: { deliveryKind, conversationKey },
      encryptionKeypair: encKp ?? undefined,
      targetMessageId: targetMessage.id,
      emoji,
    });
    recoverProximityDelivery();
  }

  function handleReactFromMenu(emoji: QuickReaction) {
    if (menuTarget) setPendingReaction({ target: menuTarget, emoji });
    closeMenu();
  }

  /** "⋯" in the pill: close the context menu, then open the full emoji picker
   * once it has fully closed (iOS can't present two modals at once — opening the
   * picker while the menu's modal is still dismissing freezes the app). Keeps
   * `menuTarget` as the reaction target. */
  function handleOpenEmojiPicker(anchor?: EmojiPickerPopoverAnchor) {
    const pointer = menuAnchor?.rect.pointer;
    const resolvedAnchor =
      anchor ??
      (IS_ELECTRON && pointer ? { x: pointer.x, y: pointer.y, width: 0, height: 0 } : undefined);
    setMenuAnchor(null);
    setPendingPickerAnchor(resolvedAnchor ?? null);
    setPendingPicker(true);
  }

  /** Fired once the action menu has fully closed + unmounted — now safe to mutate
   * the row (react) or present another modal (picker) without the lifted copy
   * still on screen. */
  function handleMenuClosed() {
    if (pendingReaction) {
      const { target, emoji } = pendingReaction;
      setPendingReaction(null);
      void applyReaction(target, emoji);
    }
    if (pendingPicker) {
      setPendingPicker(false);
      setEmojiPickerAnchor(pendingPickerAnchor);
      setPendingPickerAnchor(null);
      setEmojiPickerMounted(true);
      setEmojiPickerOpen(true);
    }
    if (pendingDetailId) {
      const id = pendingDetailId;
      setPendingDetailId(null);
      setDetailRumorId(id);
    }
    if (pendingSelectId) {
      const id = pendingSelectId;
      setPendingSelectId(null);
      setSelectedIds(new Set([id]));
      setSelectionMode(true);
    }
    if (pendingForwardMessages) {
      const messages = pendingForwardMessages;
      setPendingForwardMessages(null);
      openForwardPage(messages);
    }
    if (pendingPackPickerEmoji) {
      const emoji = pendingPackPickerEmoji;
      setPendingPackPickerEmoji(null);
      pendingPackEditorRef.current = null;
      setPackPickerEmoji(emoji);
      setPackPickerVisible(true);
    }
    if (pendingSaveUpload) {
      const upload = pendingSaveUpload;
      setPendingSaveUpload(null);
      void handleSavePendingUpload(upload);
    }
  }

  function handleEmojiPicked(emoji: string | CustomEmoji) {
    const target = menuTarget;
    setEmojiPickerOpen(false);
    setMenuTarget(null);
    if (target) void applyReaction(target, emoji);
  }

  function editPackWithEmoji(coordinate?: string) {
    if (!packPickerEmoji) return;
    pendingPackEditorRef.current = { emoji: packPickerEmoji, coordinate };
    setPackPickerVisible(false);
  }

  function handlePackPickerClosed() {
    const pending = pendingPackEditorRef.current;
    pendingPackEditorRef.current = null;
    setPackPickerEmoji(null);
    if (!pending) return;
    router.push({
      pathname: '/emoji-pack-editor',
      params: {
        ...(pending.coordinate ? { coordinate: pending.coordinate } : {}),
        emojiShortcode: pending.emoji.shortcode,
        emojiUrl: pending.emoji.url,
      },
    });
  }

  /** Tapping an existing reaction chip adds your own; if you already reacted
   * with it, applyReaction no-ops (reactions aren't retractable). */
  function handleTapReaction(message: MessageRow, reaction: ReactionAggregate) {
    void applyReaction(message, reaction.customEmoji ?? reaction.emoji);
  }

  // The message backing the detail sheet (open only while detailRumorId is set).
  // Declared before the early return below so this Hook is always called, in the
  // same order every render (react-hooks/rules-of-hooks).
  const detailMessage = useMemo(
    () => (detailRumorId ? (messages.find((m) => m.id === detailRumorId) ?? null) : null),
    [detailRumorId, messages],
  );

  if (!accountPubkey) return null;

  const replySenderDisplayName = replyingTo
    ? (isProximity
        ? replyingTo.senderPubkey !== conversationKey
        : replyingTo.senderPubkey === messageSelfPubkey)
      ? t('common.you')
      : proximityPeerDisplayName ||
        resolveDisplayName(replyingTo.senderPubkey, {
          petname: replyingToSenderContact?.petname,
          displayName: replyingToSenderProfile?.displayName,
          name: replyingToSenderProfile?.name,
        })
    : '';

  // An image/video attachment behind the long-pressed bubble, if any — the only
  // kinds that can be saved to the photo library.
  const targetMedia =
    menuTarget?.kind === 15 ? findFileMeta(menuTarget.content, menuTarget.tags) : null;
  const saveableMedia =
    targetMedia?.mime &&
    (targetMedia.mime.startsWith('image/') || targetMedia.mime.startsWith('video/'))
      ? targetMedia
      : null;
  const menuSingleCustomEmoji = menuTarget ? singleCustomEmojiFromMessage(menuTarget) : null;

  // Action-menu rows for the long-pressed message. Reply is unavailable for
  // read-only Nearby history. Copy is text-only, Save is image/video-only, and
  // Info is available for every message.
  const menuActions: MessageMenuAction[] = pendingMenuTarget
    ? [
        {
          key: 'save',
          label: t('chat.actions.save'),
          icon: <Download size={MESSAGE_ACTION_MENU_ICON_SIZE} color={c.text} />,
          onPress: () => {
            const upload = pendingMenuTarget;
            if (upload) setPendingSaveUpload(upload);
            closeMenu();
          },
        },
      ]
    : menuTarget
      ? [
          ...(!proximityHistoryReadOnly
            ? [
                {
                  key: 'reply',
                  label: t('chat.actions.reply'),
                  icon: <Reply size={MESSAGE_ACTION_MENU_ICON_SIZE} color={c.text} />,
                  onPress: () => {
                    const target = menuTarget;
                    closeMenu();
                    if (target) setReplyingTo(target);
                  },
                } as MessageMenuAction,
              ]
            : []),
          ...(menuTarget.kind !== 15 &&
          menuTarget.content.trim().length > 0 &&
          !menuSingleCustomEmoji
            ? [
                {
                  key: 'copy',
                  label: t('chat.actions.copy'),
                  icon: <Copy size={MESSAGE_ACTION_MENU_ICON_SIZE} color={c.text} />,
                  onPress: () => {
                    const text = menuTarget?.content ?? '';
                    closeMenu();
                    void setStringAsync(text);
                  },
                } as MessageMenuAction,
              ]
            : []),
          ...(saveableMedia
            ? [
                {
                  key: 'save',
                  label: t('chat.actions.save'),
                  icon: <Download size={MESSAGE_ACTION_MENU_ICON_SIZE} color={c.text} />,
                  onPress: () => {
                    closeMenu();
                    void handleSaveMedia(saveableMedia);
                  },
                } as MessageMenuAction,
              ]
            : []),
          ...(menuSingleCustomEmoji
            ? [
                {
                  key: 'add-to-emoji-pack',
                  label: t('emoji.add_to_pack'),
                  icon: <SmilePlus size={MESSAGE_ACTION_MENU_ICON_SIZE} color={c.text} />,
                  onPress: () => {
                    const emoji = menuSingleCustomEmoji;
                    if (emoji) setPendingPackPickerEmoji(emoji);
                    closeMenu();
                  },
                } as MessageMenuAction,
              ]
            : []),
          {
            key: 'forward',
            label: t('chat.actions.forward'),
            icon: <Forward size={MESSAGE_ACTION_MENU_ICON_SIZE} color={c.text} />,
            onPress: () => {
              const target = menuTarget;
              if (target) {
                setPendingForwardMessages([
                  {
                    kind: target.kind,
                    content: target.content,
                    tags: target.tags,
                  },
                ]);
              }
              closeMenu();
            },
          },
          {
            key: 'select',
            label: t('chat.actions.select'),
            icon: <ListChecks size={MESSAGE_ACTION_MENU_ICON_SIZE} color={c.text} />,
            onPress: () => {
              const id = menuTarget?.id ?? null;
              closeMenu();
              // Defer entering selection mode until the menu's exit finishes
              // (handleMenuClosed), so the bubble shift doesn't race the lifted copy.
              if (id) setPendingSelectId(id);
            },
          },
          {
            key: 'info',
            label: t('chat.actions.info'),
            icon: <Info size={MESSAGE_ACTION_MENU_ICON_SIZE} color={c.text} />,
            onPress: () => {
              const id = menuTarget?.id ?? null;
              closeMenu();
              setPendingDetailId(id);
            },
          },
        ]
      : [];

  // Six configured slots and a handful of aggregates: keeping this local avoids
  // introducing hooks below the screen's loading early-return branches.
  const quickReactionKeys = new Set(menuQuickEmojis.map(quickReactionKey));
  const reactedReactionKeys = menuTarget
    ? (reactionsByMessageId[menuTarget.id] ?? [])
        .filter((reaction) => reaction.selfReacted)
        .map((reaction) => quickReactionKey(reaction.customEmoji ?? reaction.emoji))
        .filter((reactionKey) => quickReactionKeys.has(reactionKey))
    : [];
  const composerReplyTo = replyingTo
    ? {
        senderName: replySenderDisplayName,
        contentPreview:
          replyingTo.kind === 15
            ? attachmentLabel(replyingTo.tags, attachmentLabels)
            : replyingTo.content,
      }
    : null;
  const composerMode =
    (isProximity && !proximityHistoryReadOnly) ||
    (!isProximity && (dmSupport.status === 'ready' || dmSupport.status === 'local'))
      ? 'input'
      : 'gate';
  const composerGateStatus = isProximity
    ? proximityHistoryReadOnly
      ? 'proximity_identity_changed'
      : null
    : dmSupport.status === 'checking' || dmSupport.status === 'unsupported'
      ? dmSupport.status
      : null;

  return (
    <>
      <ChatComposerBinding
        controllerRef={composerControllerRef}
        onModelChange={onComposerModelChange}
        controller={{
          send: handleSend,
          pickAttachment: launchPicker,
          sendVoice: handleSendVoice,
          cancelReply: () => setReplyingTo(null),
          openUnsupported: () => setShowUnsupported(true),
        }}
        model={{
          mode: composerMode,
          disabled: isProximity && proximityHistoryReadOnly,
          attachmentSources,
          supportsVoice,
          replyTo: composerReplyTo,
          gateStatus: composerGateStatus,
        }}
      />
      {/* No KeyboardAvoidingView: the composer (`ChatInput`) reserves the
          keyboard/tray space itself via a reanimated bottom panel, so the
          keyboard ⇄ attachment-tray swap is one continuous animation. */}
      <View ref={contentRef} collapsable={false} style={{ flex: 1 }}>
        <MessageList
          messages={isProximity && !messageSelfPubkey ? [] : displayMessages}
          pendingAttachments={inFlight}
          pendingTailVersion={pendingTailVersion}
          pendingFailureVersion={pendingFailureVersion}
          accountPubkey={accountPubkey}
          selfPubkey={messageSelfPubkey}
          proximity={isProximity}
          peerDisplayName={proximityPeerDisplayName}
          conversationKey={conversationKey}
          // Hold silently until the local row resolves so request media never
          // fetches on the first frame, but only a confirmed request shows the
          // explicit load affordance.
          remoteContentMode={remoteContentMode}
          reactionsByMessageId={reactionsByMessageId}
          presentationsByMessageId={presentationsByMessageId}
          bubbleRenderItemsById={bubbleRenderItemsById}
          deliveriesByMessageId={deliveriesForDisplay}
          referencedById={referencedById}
          onLoadOlder={loadOlder}
          onLoadNewer={loadNewer}
          hasMore={hasMore}
          hasMoreNewer={hasMoreNewer}
          anchored={anchored}
          windowLoaded={windowLoaded}
          onFocusAnchor={focusAnchor}
          onJumpToTail={jumpToTail}
          focusMessageId={focusMessageId}
          unreadBoundaryOrderAt={unreadBoundary?.orderAt ?? null}
          unreadBoundaryId={unreadBoundary?.id ?? null}
          firstUnreadOrderAt={unreadBoundary?.firstUnreadOrderAt ?? null}
          firstUnreadId={unreadBoundary?.firstUnreadId ?? null}
          unreadCount={unreadBoundary?.count ?? 0}
          onSwipeReply={proximityHistoryReadOnly ? undefined : (msg) => setReplyingTo(msg)}
          onLongPress={handleLongPress}
          onLongPressPending={handlePendingLongPress}
          onTapReaction={proximityHistoryReadOnly ? () => {} : handleTapReaction}
          onShowDelivery={setDetailRumorId}
          onStopPending={handleStopPending}
          onRetryPending={handleRetryPending}
          onCancelPending={handleCancelPending}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          bottomInset={composerClearance}
          topInset={topInset}
          liveDataEnabled={liveDataReady}
        />
        {/* While the attachment tray is open, a tap anywhere on the messages
            closes it (like tapping to dismiss a keyboard). Transparent, only
            mounted while open so it never blocks normal list interaction. */}
        <ChatComposerPanelDismissOverlay />
      </View>
      {selectionMode ? (
        <ForwardActionBar count={selectedIds.size} onForward={forwardSelected} />
      ) : null}
      {liveDataReady ? (
        <>
          {pickedAttachments.length > 0 &&
          (!isProximity || (proximityOwnershipLoaded && !proximityHistoryReadOnly)) ? (
            <AttachmentSendConfirmation
              visible={pickedConfirmationVisible}
              files={pickedConfirmationFiles}
              onClose={() => setPickedConfirmationVisible(false)}
              onClosed={() => setPickedAttachments([])}
              onConfirm={sendPickedAttachments}
              onRemoveFile={(index) => {
                if (pickedAttachments.length === 1) {
                  setPickedConfirmationVisible(false);
                  return;
                }
                setPickedAttachments((current) =>
                  current.filter((_, currentIndex) => currentIndex !== index),
                );
              }}
              onImageDimensions={(index, width, height) =>
                setPickedAttachments((current) => {
                  const item = current[index];
                  if (!item || (item.width === width && item.height === height)) return current;
                  const next = current.slice();
                  next[index] = { ...item, width, height };
                  return next;
                })
              }
            />
          ) : null}
          {composerFiles.length > 0 &&
          (!isProximity || (proximityOwnershipLoaded && !proximityHistoryReadOnly)) ? (
            <AttachmentSendConfirmation
              visible
              files={composerConfirmationFiles}
              onClose={() => {
                discardTemporaryComposerFiles(composerFiles);
                setComposerFiles([]);
              }}
              onConfirm={sendComposerFiles}
              onRemoveFile={(index) =>
                setComposerFiles((current) => {
                  const removed = current[index];
                  if (removed) discardTemporaryComposerFiles([removed]);
                  return current.filter((_, currentIndex) => currentIndex !== index);
                })
              }
              onImageDimensions={(index, width, height) =>
                setComposerFiles((current) => {
                  const item = current[index];
                  if (!item || (item.width === width && item.height === height)) return current;
                  const next = current.slice();
                  next[index] = { ...item, width, height };
                  return next;
                })
              }
            />
          ) : null}
          <MessageActionMenu
            visible={!!menuAnchor}
            rect={menuAnchor?.rect ?? null}
            bubble={menuAnchor?.bubble ?? null}
            contentTop={menuAnchor?.contentTop}
            contentBottom={menuAnchor?.contentBottom}
            preserveKeyboard={menuAnchor?.preserveKeyboard}
            quickEmojis={menuQuickEmojis}
            reactedReactionKeys={reactedReactionKeys}
            onReact={handleReactFromMenu}
            onMore={handleOpenEmojiPicker}
            actions={menuActions}
            onClose={closeMenu}
            onClosed={handleMenuClosed}
            hideReactions={proximityHistoryReadOnly}
          />
          <AddEmojiToPackSheet
            visible={packPickerVisible}
            emoji={packPickerEmoji}
            packs={ownedEmojiPacks}
            loaded={emojiCollection.loaded}
            onClose={() => setPackPickerVisible(false)}
            onClosed={handlePackPickerClosed}
            onSelectPack={(coordinate) => editPackWithEmoji(coordinate)}
            onCreatePack={() => editPackWithEmoji()}
          />
          {emojiPickerMounted ? (
            <Suspense fallback={null}>
              <LazyEmojiPickerSheet
                visible={emojiPickerOpen}
                popoverAnchor={emojiPickerAnchor ?? undefined}
                customPacks={emojiCollection.packs}
                standaloneCustomEmojis={emojiCollection.standalone}
                onClose={() => {
                  setEmojiPickerOpen(false);
                  setMenuTarget(null);
                }}
                onClosed={() => setEmojiPickerMounted(false)}
                onSelect={handleEmojiPicked}
              />
            </Suspense>
          ) : null}
          <DmUnsupportedSheet
            visible={showUnsupported && dmSupport.status !== 'local'}
            status={dmSupport.status}
            missingEncryptionKey={dmSupport.missingEncryptionKey}
            missingRelays={dmSupport.missingRelays}
            onRecheck={dmSupport.recheck}
            onClose={() => setShowUnsupported(false)}
          />
          {accountPubkey ? (
            <ShareConfirmSheet
              visible={cardSheetOpen}
              onClose={() => setCardSheetOpen(false)}
              preview={<ForwardPreview messages={cardPreviewMessages} />}
              recipients={[cardShareTarget]}
              sending={false}
              onConfirm={sendContactCard}
            />
          ) : null}
          <MessageDetailSheet
            rumorId={detailRumorId}
            rumor={detailMessage?.rumor ?? null}
            isSelf={
              detailMessage
                ? isProximity
                  ? detailMessage.senderPubkey !== conversationKey
                  : detailMessage.senderPubkey === messageSelfPubkey
                : false
            }
            sourceRelays={
              !isProximity && detailMessage && detailMessage.senderPubkey !== messageSelfPubkey
                ? // Persisted snapshot ∪ relays that have delivered this wrap since
                  // (the live set keeps growing as a peer's relays redeliver).
                  Array.from(
                    new Set([
                      ...(detailMessage.sourceRelays ?? []),
                      ...dmService.getReceivedFromRelays(detailMessage.id),
                    ]),
                  )
                : null
            }
            persistedDelivery={
              detailRumorId ? (deliveriesByMessageId[detailRumorId] ?? null) : null
            }
            transport={isProximity ? 'proximity' : 'relay'}
            onResend={
              isProximity
                ? undefined
                : (relayUrls) => {
                    if (detailRumorId) {
                      void dmService.resendToRelays({
                        rumorId: detailRumorId,
                        relayUrls,
                      });
                    }
                  }
            }
            onClose={() => setDetailRumorId(null)}
          />
          {isProximity ? (
            <NearbyOutgoingRequestSheet
              peerPubkey={conversationKey}
              awaitingRequest={manualReconnectPending}
            />
          ) : null}
          <PhotoCaptureModal
            visible={photoCaptureOpen}
            permissionDeniedMessage={t('attach.camera_permission')}
            accessibilityLabel={t('common.take_photo')}
            onClose={() => {
              setPhotoCaptureOpen(false);
              const photo = capturedPhotoRef.current;
              capturedPhotoRef.current = null;
              if (photo) {
                setPickedAttachments([photo]);
                setPickedConfirmationVisible(true);
              }
            }}
            onCaptured={(photo) => {
              capturedPhotoRef.current = {
                uri: photo.uri,
                mime: photo.mimeType,
                width: photo.width,
                height: photo.height,
              };
            }}
            quality={1}
          />
        </>
      ) : null}
    </>
  );
}
