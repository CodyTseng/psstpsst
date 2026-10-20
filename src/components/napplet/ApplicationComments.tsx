import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Platform, ScrollView, StyleSheet, View, type ScrollViewProps, type TextInput, type TextStyle } from 'react-native';
import { ChatRound } from '@solar-icons/react-native/category/messages/Linear/ChatRound';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { AppInput } from '@/components/common/AppInput';
import { AppButton } from '@/components/common/AppButton';
import { QuotedReply } from '@/components/chat/QuotedReply';
import { Avatar } from '@/components/common/Avatar';
import { SectionLabel } from '@/components/common/SectionLabel';
import { useDisplayName } from '@/hooks/use-display-name';
import { useApplicationComments } from '@/hooks/use-application-comments';
import { formatListTime } from '@/lib/time';
import type { ExploreEntry } from '@/services/explore/model';
import type { ApplicationCommentsSession } from '@/services/explore/comments';
import { applicationCommentTarget, MAX_COMMENT_LENGTH, type ApplicationComment, type CommentTarget } from '@/services/explore/comments-protocol';
import type { CommentRow } from '@/services/explore/comments-index';
import { radius, spacing, useThemeColors } from '@/theme';

const avatarSize = spacing['2xl'];
const replyIndent = spacing['2xl'];

const userDirection = Platform.OS === 'web' ? { dir: 'auto' as const } : {};
const userTextStyle: TextStyle = Platform.OS === 'web'
  ? { textAlign: 'start' as TextStyle['textAlign'] }
  : { textAlign: 'auto', writingDirection: 'auto' };

type ScrollProps = Pick<ScrollViewProps, 'onScroll' | 'scrollEventThrottle'>;

export function ApplicationComments({ entry, account, header, topInset, scrollProps }: {
  entry: ExploreEntry; account: string; header: ReactNode; topInset: number;
  scrollProps?: ScrollProps;
}) {
  const target = useMemo(() => applicationCommentTarget(entry), [entry]);
  return target ? <Discussion key={`${account}:${target.key}:${target.eventId ?? ''}`}
    account={account} target={target} header={header} topInset={topInset} scrollProps={scrollProps} /> : <ScrollView {...scrollProps}>{header}</ScrollView>;
}

function Discussion({ account, target, header, topInset, scrollProps }: {
  account: string; target: CommentTarget; header: ReactNode; topInset: number; scrollProps?: ScrollProps;
}) {
  const state = useApplicationComments(account, target);
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [reply, setReply] = useState<ApplicationComment>();
  const list = useRef<FlatList<CommentRow>>(null);
  const input = useRef<TextInput>(null);
  const composerOffset = useRef(0);
  const chooseReply = useCallback((comment: ApplicationComment) => {
    setReply(comment);
    list.current?.scrollToOffset({ offset: Math.max(0, composerOffset.current - topInset), animated: true });
    input.current?.focus();
  }, [topInset]);
  const sent = useCallback((parentId?: string) => setReply(current => current?.event.id === parentId ? undefined : current), []);
  return <FlatList ref={list} data={state.rows} keyExtractor={row => row.comment.event.id} {...scrollProps}
    initialNumToRender={12} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets
    ListHeaderComponent={<View>
      {header}
      <View onLayout={event => { composerOffset.current = event.nativeEvent.layout.y; }}
        style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, gap: spacing.lg }}>
        <SectionLabel>{t('comments.title')}</SectionLabel>
        <CommentComposer account={account} session={state.session} reply={reply} inputRef={input}
          onCancelReply={() => setReply(undefined)} onSent={sent} />
        {state.error ? <View style={{ gap: spacing.sm }}>
          <AppText tone="muted">{t('comments.load_failed')}</AppText>
          <AppButton variant="text" label={t('common.retry')} onPress={() => { void state.session.load(true); }} />
        </View> : null}
      </View>
    </View>}
    renderItem={({ item }) => <CommentItem row={item} onReply={chooseReply} />}
    ListEmptyComponent={state.loading || !state.loaded && !state.error
      ? <ActivityIndicator color={colors.accent} style={{ padding: spacing.lg }} />
      : !state.error && !state.hasMore ? <View style={{ alignItems: 'center', gap: spacing.sm, padding: spacing.xl }}>
        <ChatRound size={spacing['3xl']} color={colors.textMuted} />
        <AppText tone="muted" align="center">{t('comments.empty')}</AppText>
      </View> : null}
    ListFooterComponent={state.rows.length || state.loaded && state.hasMore ? <View style={{ padding: spacing.lg }}>
      {state.loading ? <ActivityIndicator color={colors.accent} /> : state.hasMore
        ? <AppButton variant="text" label={t('comments.load_more')} onPress={() => { void state.session.load(); }} /> : null}
    </View> : null} />;
}

const CommentItem = memo(function CommentItem({ row, onReply }: { row: CommentRow; onReply(comment: ApplicationComment): void }) {
  const { event } = row.comment;
  const { name, profile } = useDisplayName(event.pubkey);
  const colors = useThemeColors();
  const { t } = useTranslation();
  const guideStart = (depth: number) => spacing.lg + depth * replyIndent + avatarSize / 2;
  return <View style={{ marginTop: row.depth === 0 ? spacing.sm : 0 }}>
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {(row.guideDepths ?? []).map(depth => <View key={depth} style={{ position: 'absolute', start: guideStart(depth),
        top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />)}
      {row.parentDepth !== undefined ? <>
        {row.continuesParent ? <View style={{ position: 'absolute', start: guideStart(row.parentDepth),
          top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.border }} /> : null}
        <View style={{ position: 'absolute', start: guideStart(row.parentDepth), top: 0,
          width: replyIndent - avatarSize / 2 - spacing.xs, height: spacing.md + avatarSize / 2,
          borderStartWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomStartRadius: radius.md, borderColor: colors.border }} />
      </> : null}
      {row.hasReplies ? <View style={{ position: 'absolute', start: guideStart(row.depth),
        top: spacing.md + avatarSize + spacing.xs, bottom: 0,
        width: StyleSheet.hairlineWidth, backgroundColor: colors.border }} /> : null}
    </View>
    <View style={{ paddingStart: spacing.lg + row.depth * replyIndent, paddingEnd: spacing.lg,
      paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
      <Avatar pubkey={event.pubkey} picture={profile?.picture} size={avatarSize} />
      <View style={{ flex: 1, gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
          <AppText variant="caption" tone="muted" weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>{name}</AppText>
          <AppText variant="caption" tone="muted">{formatListTime(event.created_at)}</AppText>
        </View>
        <AppText {...userDirection} style={userTextStyle} selectable>{event.content}</AppText>
        <View style={{ alignItems: 'flex-start' }}>
          <AppButton variant="accentText" fullWidth={false} compact compactAxis="none" labelVariant="caption"
            label={t('comments.reply')} onPress={() => onReply(row.comment)} />
        </View>
      </View>
    </View>
  </View>;
}, (before, after) => before.row.comment === after.row.comment && before.row.depth === after.row.depth &&
  before.row.hasReplies === after.row.hasReplies && before.row.parentDepth === after.row.parentDepth &&
  before.row.continuesParent === after.row.continuesParent && before.onReply === after.onReply &&
  before.row.guideDepths.length === after.row.guideDepths.length &&
  before.row.guideDepths.every((depth, i) => depth === after.row.guideDepths[i]));

/** Keep keystrokes and signing/publishing progress out of the virtualized thread. */
export function CommentComposer({ account, session, reply, inputRef, onCancelReply, onSent }: {
  account: string; session: ApplicationCommentsSession; reply?: ApplicationComment;
  inputRef: React.RefObject<TextInput | null>; onCancelReply(): void; onSent(parentId?: string): void;
}) {
  const { t } = useTranslation();
  const { name, profile } = useDisplayName(account);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const posting = useRef(false);
  const post = async () => {
    if (posting.current || !content.trim()) return;
    posting.current = true; setBusy(true); setError(false);
    const parentId = reply?.event.id;
    try {
      await session.post(content, parentId);
      setContent(''); onSent(parentId);
    } catch { setError(true); }
    finally { posting.current = false; setBusy(false); }
  };
  return <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
    <Avatar pubkey={account} picture={profile?.picture} size={avatarSize} />
    <View style={{ flex: 1, gap: spacing.md }}>
      <AppInput {...userDirection} style={userTextStyle} ref={inputRef} multiline value={content} onChangeText={setContent} editable={!busy} maxLength={MAX_COMMENT_LENGTH}
        inputHeaderAccessory={reply ? <ReplyQuote reply={reply} busy={busy} onCancel={onCancelReply} /> : undefined}
        accessibilityLabel={t(reply ? 'comments.reply_placeholder' : 'comments.placeholder')}
        placeholder={t(reply ? 'comments.reply_placeholder' : 'comments.placeholder')} />
      {error ? <AppText variant="caption" tone="danger">{t('comments.post_failed')}</AppText> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.md }}>
        <AppText variant="caption" tone="muted" style={{ flexShrink: 1 }}>{t('comments.public_as', { name })}</AppText>
        <AppButton variant="primary" fullWidth={false} size="sm" label={t('comments.post')} loading={busy} disabled={!content.trim()}
          onPress={() => { void post(); }} />
      </View>
    </View>
  </View>;
}

function ReplyQuote({ reply, busy, onCancel }: { reply: ApplicationComment; busy: boolean; onCancel(): void }) {
  const { name } = useDisplayName(reply.event.pubkey);
  const { t } = useTranslation();
  return <View accessibilityLiveRegion="polite">
    <QuotedReply bare senderName={name} contentPreview={reply.event.content} onCancel={onCancel}
      cancelDisabled={busy} cancelAccessibilityLabel={t('comments.cancel_reply')} />
  </View>;
}
