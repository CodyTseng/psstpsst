import { router } from 'expo-router';
import { UploadMinimalistic as ArrowUpFromLine } from '@solar-icons/react-native/category/arrows-action/Linear/UploadMinimalistic';
import { Bell } from '@solar-icons/react-native/category/notifications/Linear/Bell';
import { BellOff } from '@solar-icons/react-native/category/notifications/Linear/BellOff';
import { DirectionalChevron as ChevronRight } from '@/components/common/DirectionalChevron';
import { ChatRound as MessageCircle } from '@solar-icons/react-native/category/messages/Linear/ChatRound';
import { Pen as Pencil } from '@solar-icons/react-native/category/messages/Linear/Pen';
import Check from 'lucide-react-native/icons/check';
import { Copy } from '@solar-icons/react-native/category/ui/Linear/Copy';
import { ForbiddenCircle as Ban } from '@solar-icons/react-native/category/ui/Linear/ForbiddenCircle';
import { Flag } from '@solar-icons/react-native/category/ui/Linear/Flag';
import AtSign from 'lucide-react-native/icons/at-sign';
import { Share as Share2 } from '@solar-icons/react-native/category/ui/Linear/Share';
import { GalleryWide as Images } from '@solar-icons/react-native/category/video/Linear/GalleryWide';
import { Bolt } from '@solar-icons/react-native/category/ui/Linear/Bolt';
import { KeyMinimalistic as Fingerprint } from '@solar-icons/react-native/category/security/Linear/KeyMinimalistic';
import { Magnifer as Search } from '@solar-icons/react-native/category/search/Linear/Magnifer';
import { QrCode } from '@solar-icons/react-native/category/security/Linear/QrCode';
import { UserMinusRounded as UserMinus } from '@solar-icons/react-native/category/users/Linear/UserMinusRounded';
import { UserPlusRounded as UserPlus } from '@solar-icons/react-native/category/users/Linear/UserPlusRounded';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, type TextInput, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { BlockedBadge } from '@/components/blocked/BlockedBadge';
import { ActionRow } from '@/components/common/ActionRow';
import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { BottomSheet } from '@/components/common/BottomSheet';
import { InputDialog } from '@/components/common/InputDialog';
import { IconButton } from '@/components/common/IconButton';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SelfBadge } from '@/components/common/SelfBadge';
import { Nip05Label } from '@/components/profile/Nip05Label';
import { NpubQrSheet } from '@/components/profile/NpubQrSheet';
import { ProfileAction } from '@/components/profile/ProfileAction';
import { ReportUserSheet } from '@/components/profile/report-user-sheet';
import { useScrolled } from '@/hooks/use-scrolled';
import { useIsBlocked } from '@/hooks/use-blocked';
import { useContact } from '@/hooks/use-contacts';
import { useConversation } from '@/hooks/use-conversations';
import { useProfile } from '@/hooks/use-profile';
import { setStringAsync } from '@/lib/clipboard';
import { resolveName } from '@/lib/nostr/display-name';
import { pubkeyToNpub } from '@/lib/nostr/keys';
import { IS_ELECTRON } from '@/lib/platform';
import { shareContactContent } from '@/lib/share/contact-card';
import { platform } from '@/platform';
import { addContact, removeContact, setPetname } from '@/services/contact/contact.service';
import { setConversationMuted } from '@/services/conversation/conversation-prefs.service';
import { KIND_CHAT } from '@/services/crypto/nip17-gift-wrap';
import { blockUser, unblockUser } from '@/services/dm/block.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useForwardDraftStore } from '@/stores/forward-draft.store';
import { mediaViewer } from '@/stores/media-viewer.store';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, uiDensity, useThemeColors } from '@/theme';

/**
 * Another user's profile. Minimal, messenger-first identity card: centered
 * avatar, compact public identifiers, PsstPsst-styled {@link ProfileAction}
 * buttons, then grouped rows. "Edit" sets a local petname synced via NIP-51.
 * Own profile uses {@link ProfileView}.
 */
export function PeerProfile({ pubkey }: { pubkey: string }) {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const c = useThemeColors();
  const accountPubkey = useActiveAccount((s) => s.activePubkey) ?? '';
  const startForwardDraft = useForwardDraftStore((state) => state.start);
  const titleClearance = useScreenHeaderClearance();

  // Note-to-self: the conversation-detail view for your own thread. Keep the
  // conversation actions (message / search / media / mute / QR / share) but drop
  // the ones that can't apply to yourself (add/remove contact, nickname, block).
  const isSelf = pubkey === accountPubkey;

  const profile = useProfile(pubkey);
  const contact = useContact(accountPubkey, pubkey);
  const saved = !!contact;

  // conversation_key is the counterparty pubkey (self included, for note-to-self).
  const conversationKey = pubkey;
  const { conversation } = useConversation(accountPubkey, conversationKey);
  const muted = conversation?.muted ?? false;
  const hasConversationContent = !!conversation?.lastMessageId;
  const lightningAddress = profile?.lud16 || profile?.lud06 || '';
  const hasLightningAddress = lightningAddress.length > 0;
  const nip05 = profile?.nip05 || '';
  // `undefined` until resolved, so the row label doesn't flash Block ↔ Unblock.
  const blocked = useIsBlocked(accountPubkey, pubkey);

  const npub = pubkeyToNpub(pubkey);
  // Public profile name only (no petname) — used for the QR card (public
  // identity) and to show the real name beneath a user-set nickname.
  const profileName = resolveName(profile);
  const petname = contact?.petname ?? null;
  const title =
    resolveName({ petname, displayName: profile?.displayName, name: profile?.name }) ??
    t('profile.unnamed');

  const [copiedNpub, setCopiedNpub] = useState(false);
  const [copiedNip05, setCopiedNip05] = useState(false);
  const [copiedLightning, setCopiedLightning] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [petnameInput, setPetnameInput] = useState('');
  const petnameInputRef = useRef<TextInput>(null);
  const [savingPetname, setSavingPetname] = useState(false);
  const [busyContact, setBusyContact] = useState(false);
  const [busyBlock, setBusyBlock] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  async function copyNpub() {
    await setStringAsync(npub);
    setCopiedNpub(true);
    setTimeout(() => setCopiedNpub(false), 2000);
  }

  async function copyNip05() {
    if (!nip05) return;
    await setStringAsync(nip05);
    setCopiedNip05(true);
    setTimeout(() => setCopiedNip05(false), 2000);
  }

  async function copyLightningAddress() {
    if (!lightningAddress) return;
    await setStringAsync(lightningAddress);
    setCopiedLightning(true);
    setTimeout(() => setCopiedLightning(false), 2000);
  }

  function handleMessage() {
    router.push(`/chat/${encodeURIComponent(conversationKey)}`);
  }

  function handleTransfer() {
    router.push(`/wallet-send?input=${encodeURIComponent(npub)}`);
  }

  function handleShare() {
    if (!accountPubkey) return;
    startForwardDraft({
      accountPubkey,
      sourceConversationKey: null,
      excludedRelayPubkey: pubkey,
      messages: [{ kind: KIND_CHAT, content: shareContactContent(pubkey), tags: [] }],
    });
    router.push('/forward');
  }

  async function addToContacts() {
    if (busyContact) return;
    setBusyContact(true);
    try {
      await addContact(accountPubkey, pubkey, { source: 'manual' });
    } catch {
      await platform.confirmationDialog.notify({
        title: t('add_contact.failed'),
        okLabel: t('common.ok'),
      });
    } finally {
      setBusyContact(false);
    }
  }

  async function removeFromContacts() {
    if (busyContact) return;
    setBusyContact(true);
    try {
      await removeContact(accountPubkey, pubkey);
    } catch {
      await platform.confirmationDialog.notify({
        title: t('add_contact.failed'),
        okLabel: t('common.ok'),
      });
    } finally {
      setBusyContact(false);
    }
  }

  function confirmRemoveContact() {
    void platform.confirmationDialog
      .confirm({
        title: t('profile.remove_contact_title'),
        message: t('profile.remove_contact_message', { name: title }),
        cancelLabel: t('common.cancel'),
        confirmLabel: t('profile.remove_contact_confirm'),
        destructive: true,
      })
      .then((confirmed) => {
        if (confirmed) void removeFromContacts();
      });
  }

  async function toggleMute() {
    if (!accountPubkey) return;
    await setConversationMuted(accountPubkey, conversationKey, !muted);
  }

  function confirmBlock() {
    void platform.confirmationDialog
      .confirm({
        title: t('chat.block_title', { name: title }),
        message: t('chat.block_message'),
        cancelLabel: t('common.cancel'),
        confirmLabel: t('chat.block_confirm'),
        destructive: true,
      })
      .then((confirmed) => {
        if (!confirmed) return;
        if (busyBlock) return;
        setBusyBlock(true);
        // Block drops future incoming messages; the conversation stays (flagged
        // blocked in the list). The row flips to "Unblock" once the live query
        // lands.
        void blockUser(accountPubkey, pubkey).finally(() => setBusyBlock(false));
      });
  }

  function handleUnblock() {
    if (busyBlock) return;
    setBusyBlock(true);
    void unblockUser(accountPubkey, pubkey).finally(() => setBusyBlock(false));
  }

  function openEdit() {
    setPetnameInput(petname ?? '');
    setEditOpen(true);
  }

  async function savePetname() {
    if (savingPetname) return;
    setSavingPetname(true);
    try {
      await setPetname(accountPubkey, pubkey, petnameInput);
      setEditOpen(false);
    } catch {
      await platform.confirmationDialog.notify({
        title: t('add_contact.failed'),
        okLabel: t('common.ok'),
      });
    } finally {
      setSavingPetname(false);
    }
  }

  return (
    <AppScreen edges={[]}>
      <ScrollView
        {...scrollProps}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: titleClearance + spacing.sm,
          paddingBottom: spacing['2xl'],
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* profile header */}
        <View style={{ alignItems: 'center' }}>
          <Pressable
            onPress={() => (profile?.picture ? mediaViewer.open(profile.picture) : undefined)}
            disabled={!profile?.picture}
            style={{ alignItems: 'center' }}
          >
            <Avatar pubkey={pubkey} picture={profile?.picture} name={title} size={96} />
          </Pressable>

          <View
            style={{
              alignItems: 'center',
              gap: spacing.xs,
              marginTop: spacing.md,
              maxWidth: '100%',
            }}
          >
            <AppText variant="title" numberOfLines={2} align="center">
              {title}
            </AppText>
            {isSelf ? <SelfBadge style={{ alignSelf: 'center' }} /> : null}
            {petname && profileName ? (
              <AppText variant="body" tone="muted" numberOfLines={1} align="center">
                {profileName}
              </AppText>
            ) : null}

            {/* A clear marker so a blocked peer is obvious at the top of the
                profile, not just via the Unblock row below. */}
            {blocked ? (
              <BlockedBadge style={{ alignSelf: 'center', marginTop: spacing.sm }} />
            ) : null}
          </View>
        </View>

        {/* Peer action strip. The note-to-self profile has fewer destinations,
            so it uses the denser navigation group below instead. */}
        {!isSelf ? (
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
              onPress={handleMessage}
            />
            <ProfileAction
              icon={<Search size={22} color={c.text} />}
              label={t('search.in_conversation')}
              onPress={() =>
                router.push(`/chat-search/${encodeURIComponent(conversationKey)}`)
              }
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
              onPress={toggleMute}
            />
            <ProfileAction
              icon={
                <ArrowUpFromLine
                  size={22}
                  color={hasLightningAddress ? c.text : c.textMuted}
                />
              }
              label={t('profile.transfer')}
              onPress={hasLightningAddress ? handleTransfer : undefined}
              disabled={!hasLightningAddress}
            />
          </View>
        ) : null}

        {!isSelf && !saved ? (
          <View style={{ marginTop: spacing.xl }}>
            <AppButton
              label={t('profile.add_contact')}
              variant="primary"
              size="lg"
              loading={busyContact}
              iconLeft={<UserPlus size={18} color={c.accentForeground} />}
              onPress={addToContacts}
            />
          </View>
        ) : null}

        {/* Public identity is supporting detail on a peer profile, after the
            primary person-to-person actions. It borrows the self profile's
            label-over-value rows without duplicating the name or advertising
            fields this person has not published. */}
        <View style={{ marginTop: spacing['2xl'] }}>
          <ListGroup>
            <ListRow
              icon={<Fingerprint size={22} color={c.text} />}
              title={t('profile.public_key')}
              value={npub}
              valueTone="default"
              valuePlacement="below"
              valueEllipsizeMode="middle"
              trailing={
                copiedNpub ? (
                  <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.success} />
                ) : (
                  <Copy size={18} color={c.textMuted} />
                )
              }
              onPress={() => void copyNpub()}
            />
            {nip05 ? (
              <ListRow
                icon={<AtSign size={22} color={c.text} strokeWidth={iconStrokeWidth.default} />}
                title={t('profile.nip05')}
                value={nip05}
                belowValue={<Nip05Label nip05={nip05} pubkey={pubkey} />}
                valueTone="default"
                valuePlacement="below"
                valueEllipsizeMode="middle"
                trailing={
                  copiedNip05 ? (
                    <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.success} />
                  ) : (
                    <Copy size={18} color={c.textMuted} />
                  )
                }
                onPress={() => void copyNip05()}
              />
            ) : null}
            {lightningAddress ? (
              <ListRow
                icon={<Bolt size={22} color={c.text} />}
                title={t('profile.lightning_address')}
                value={lightningAddress}
                valueTone="default"
                valuePlacement="below"
                valueEllipsizeMode="middle"
                trailing={
                  copiedLightning ? (
                    <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.success} />
                  ) : (
                    <Copy size={18} color={c.textMuted} />
                  )
                }
                onPress={() => void copyLightningAddress()}
              />
            ) : null}
          </ListGroup>
        </View>

        {isSelf ? (
          <View style={{ marginTop: spacing.xl }}>
            <ListGroup>
              {hasConversationContent ? (
                <ListRow
                  icon={<Search size={22} color={c.text} />}
                  title={t('search.in_conversation')}
                  trailing={<ChevronRight size={18} color={c.textMuted} />}
                  onPress={() =>
                    router.push(`/chat-search/${encodeURIComponent(conversationKey)}`)
                  }
                />
              ) : null}
              {hasConversationContent ? (
                <ListRow
                  icon={<Images size={22} color={c.text} />}
                  title={t('media.title')}
                  trailing={<ChevronRight size={18} color={c.textMuted} />}
                  onPress={() => router.push(`/media/${encodeURIComponent(conversationKey)}`)}
                />
              ) : null}
              <ListRow
                icon={<QrCode size={22} color={c.text} />}
                title={t('profile.show_qr')}
                trailing={<ChevronRight size={18} color={c.textMuted} />}
                onPress={() => setQrOpen(true)}
              />
            </ListGroup>
          </View>
        ) : null}

        {/* Peer-only navigation/settings list. */}
        {!isSelf ? (
          <View style={{ marginTop: spacing['2xl'] }}>
            <ListGroup>
              {hasConversationContent ? (
                <ListRow
                  icon={<Images size={22} color={c.text} />}
                  title={t('media.title')}
                  trailing={<ChevronRight size={18} color={c.textMuted} />}
                  onPress={() => router.push(`/media/${encodeURIComponent(conversationKey)}`)}
                />
              ) : null}
              <ListRow
                icon={<Pencil size={22} color={c.text} />}
                title={t('profile.set_petname')}
                value={petname ?? undefined}
                trailing={<ChevronRight size={18} color={c.textMuted} />}
                onPress={openEdit}
              />
              <ListRow
                icon={<QrCode size={22} color={c.text} />}
                title={t('profile.show_qr')}
                trailing={<ChevronRight size={18} color={c.textMuted} />}
                onPress={() => setQrOpen(true)}
              />
            </ListGroup>
          </View>
        ) : null}
        {!isSelf ? (
          <View style={{ marginTop: spacing.xl }}>
            <ListGroup>
              <ListRow
                icon={<Flag size={22} color={c.text} />}
                title={t('report.title')}
                onPress={() => setReportOpen(true)}
              />
              {blocked !== undefined ? (
                <ListRow
                  icon={<Ban size={22} color={blocked ? c.text : c.danger} />}
                  title={blocked ? t('profile.unblock_user') : t('profile.block_user')}
                  titleTone={blocked ? 'default' : 'danger'}
                  loading={busyBlock}
                  onPress={blocked ? handleUnblock : confirmBlock}
                />
              ) : null}
              {saved ? (
                <ListRow
                  icon={<UserMinus size={22} color={c.danger} />}
                  title={t('profile.remove_contact')}
                  titleTone="danger"
                  loading={busyContact}
                  onPress={confirmRemoveContact}
                />
              ) : null}
            </ListGroup>
          </View>
        ) : null}
      </ScrollView>
      <ScreenHeader
        bordered={scrolled}
        right={
          <IconButton
            variant="plain"
            size={uiDensity.headerActionSize}
            icon={<Share2 size={uiDensity.headerActionIconSize} color={c.text} />}
            accessibilityLabel={t('profile.share')}
            onPress={handleShare}
          />
        }
      />

      <NpubQrSheet
        visible={qrOpen}
        onClose={() => setQrOpen(false)}
        npub={npub}
        name={profileName}
        nip05={profile?.nip05}
      />

      <ReportUserSheet
        visible={reportOpen}
        accountPubkey={accountPubkey}
        reportedPubkey={pubkey}
        onClose={() => setReportOpen(false)}
      />

      {IS_ELECTRON ? (
        // A pure single-field entry — the desktop form is the centered input
        // dialog (DESIGN §10 Electron presentation split).
        <InputDialog
          visible={editOpen}
          onClose={() => setEditOpen(false)}
          actionLayout="vertical"
          confirmLabel={t('profile_edit.save')}
          confirmLoading={savingPetname}
          onConfirm={() => void savePetname()}
        >
          <AppInput
            description={t('profile.petname_hint')}
            placeholder={profileName ?? t('profile.petname_placeholder')}
            value={petnameInput}
            onChangeText={setPetnameInput}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            onSubmitEditing={() => void savePetname()}
          />
        </InputDialog>
      ) : (
        <BottomSheet
          visible={editOpen}
          onClose={() => setEditOpen(false)}
          inputFocusRef={petnameInputRef}
          title={t('profile.set_petname')}
          contentStyle={{ gap: spacing.lg }}
        >
          <AppInput
            ref={petnameInputRef}
            description={t('profile.petname_hint')}
            placeholder={profileName ?? t('profile.petname_placeholder')}
            value={petnameInput}
            onChangeText={setPetnameInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <ActionRow
            layout="vertical"
            confirm={{ label: t('profile_edit.save'), loading: savingPetname, onPress: savePetname }}
          />
        </BottomSheet>
      )}
    </AppScreen>
  );
}
