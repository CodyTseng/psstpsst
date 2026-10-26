import { useErrorToast } from '@/hooks/use-error-toast';
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Platform, ScrollView, StyleSheet, View, type ScrollViewProps, type TextInput, type TextStyle } from 'react-native';
import { ChatRound } from '@solar-icons/react-native/category/messages/Linear/ChatRound';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { AppInput } from '@/components/common/AppInput';
import { AppButton } from '@/components/common/AppButton';
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

export function ApplicationComments({ entry, account, header, scrollProps }: {
  entry: ExploreEntry; account: string; header: ReactNode;
  scrollProps?: ScrollProps;
}) {
  const target = useMemo(() => applicationCommentTarget(entry), [entry]);
  return target ? <Discussion key={`${account}:${target.key}:${target.eventId ?? ''}`}
    account={account} target={target} header={header} scrollProps={scrollProps} /> : <ScrollView {...scrollProps}>{header}</ScrollView>;
}

function Discussion({ account, target, header, scrollProps }: {
  account: string; target: CommentTarget; header: ReactNode; scrollProps?: ScrollProps;
}) {
  const state = useApplicationComments(account, target);
  useErrorToast(state.error && 'comments.load_failed');
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [replyId, setReplyId] = useState<string>();
  const input = useRef<TextInput>(null);
  const chooseReply = useCallback((comment: ApplicationComment) => setReplyId(comment.event.id), []);
  const cancelReply = useCallback(() => setReplyId(undefined), []);
  const sent = useCallback((parentId?: string) => setReplyId(current => current === parentId ? undefined : current), []);
  return <FlatList data={state.rows} extraData={replyId} keyExtractor={row => row.comment.event.id} {...scrollProps}
    onEndReached={() => {
      if (state.loaded && state.hasMore && !state.loading && !state.error) void state.session.load();
    }} onEndReachedThreshold={0.3}
    initialNumToRender={12} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets
    ListHeaderComponent={<View>
      {header}
      <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm }}>
        <SectionLabel>{t('comments.title')}</SectionLabel>
        <CommentComposer account={account} session={state.session} inputRef={input}
          onCancelReply={cancelReply} onSent={sent} />
        {state.error ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: spacing.sm }}>
          <AppButton variant="accentText" compact compactAxis="none" label={t('comments.try_again')}
            onPress={() => { void state.session.load(true); }} />
        </View> : null}
      </View>
    </View>}
    renderItem={({ item }) => <CommentItem row={item} account={account} session={state.session}
      replying={replyId === item.comment.event.id} onReply={chooseReply} onCancelReply={cancelReply} onSent={sent} />}
    ListEmptyComponent={state.loading || !state.loaded && !state.error
      ? <ActivityIndicator color={colors.accent} style={{ padding: spacing.lg }} />
      : !state.error && !state.hasMore ? <View style={{ alignItems: 'center', gap: spacing.sm, padding: spacing.xl }}>
        <ChatRound size={spacing['3xl']} color={colors.textMuted} />
        <AppText tone="muted" align="center">{t('comments.empty')}</AppText>
      </View> : null}
    ListFooterComponent={state.rows.length > 0 && state.loading
      ? <ActivityIndicator color={colors.accent} style={{ padding: spacing.lg }} /> : null} />;
}

const CommentItem = memo(function CommentItem({ row, account, session, replying, onReply, onCancelReply, onSent }: {
  row: CommentRow; account: string; session: ApplicationCommentsSession; replying: boolean;
  onReply(comment: ApplicationComment): void; onCancelReply(): void; onSent(parentId?: string): void;
}) {
  const input = useRef<TextInput>(null);
  const { event } = row.comment;
  const { name, profile } = useDisplayName(event.pubkey);
  const colors = useThemeColors();
  const { t } = useTranslation();
  const guideStart = (depth: number) => spacing.lg + depth * replyIndent + avatarSize / 2;
  return <View style={{ marginTop: row.depth === 0 ? spacing.xs : 0 }}>
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {(row.guideDepths ?? []).map(depth => <View key={depth} style={{ position: 'absolute', start: guideStart(depth),
        top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />)}
      {row.parentDepth !== undefined ? <>
        {row.continuesParent ? <View style={{ position: 'absolute', start: guideStart(row.parentDepth),
          top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.border }} /> : null}
        <View style={{ position: 'absolute', start: guideStart(row.parentDepth), top: 0,
          width: replyIndent - avatarSize / 2 - spacing.xs, height: spacing.sm + avatarSize / 2,
          borderStartWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomStartRadius: radius.md, borderColor: colors.border }} />
      </> : null}
      {row.hasReplies ? <View style={{ position: 'absolute', start: guideStart(row.depth),
        top: spacing.sm + avatarSize + spacing.xs, bottom: 0,
        width: StyleSheet.hairlineWidth, backgroundColor: colors.border }} /> : null}
    </View>
    <View style={{ paddingStart: spacing.lg + row.depth * replyIndent, paddingEnd: spacing.lg,
      paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
      <Avatar pubkey={event.pubkey} picture={profile?.picture} size={avatarSize} />
      <View style={{ flex: 1, gap: spacing.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
          <AppText variant="caption" tone="muted" weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>{name}</AppText>
          <AppText variant="caption" tone="muted">{formatListTime(event.created_at)}</AppText>
        </View>
        <AppText {...userDirection} style={userTextStyle} selectable>{event.content}</AppText>
        <View style={{ alignItems: 'flex-start' }}>
          <AppButton variant="accentText" fullWidth={false} compact compactAxis="none" labelVariant="caption"
            label={t('comments.reply')} onPress={() => onReply(row.comment)} />
        </View>
        {replying ? <CommentComposer account={account} session={session} reply={row.comment} inputRef={input}
          autoFocus onCancelReply={onCancelReply} onSent={onSent} /> : null}
      </View>
    </View>
  </View>;
}, (before, after) => before.account === after.account && before.session === after.session &&
  before.replying === after.replying && before.onCancelReply === after.onCancelReply && before.onSent === after.onSent &&
  before.row.comment === after.row.comment && before.row.depth === after.row.depth &&
  before.row.hasReplies === after.row.hasReplies && before.row.parentDepth === after.row.parentDepth &&
  before.row.continuesParent === after.row.continuesParent && before.onReply === after.onReply &&
  before.row.guideDepths.length === after.row.guideDepths.length &&
  before.row.guideDepths.every((depth, i) => depth === after.row.guideDepths[i]));

/** Keep keystrokes and signing/publishing progress out of the virtualized thread. */
export function CommentComposer({ account, session, reply, inputRef, autoFocus, onCancelReply, onSent }: {
  account: string; session: ApplicationCommentsSession; reply?: ApplicationComment; autoFocus?: boolean;
  inputRef: React.RefObject<TextInput | null>; onCancelReply(): void; onSent(parentId?: string): void;
}) {
  const { t } = useTranslation();
  const { profile } = useDisplayName(account);
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
  return <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
    <Avatar pubkey={account} picture={profile?.picture} size={avatarSize} />
    <View style={{ flex: 1, gap: spacing.sm }}>
      <AppInput {...userDirection} style={userTextStyle} ref={inputRef} autoFocus={autoFocus} multiline value={content} onChangeText={setContent} editable={!busy} maxLength={MAX_COMMENT_LENGTH}
        accessibilityLabel={t(reply ? 'comments.reply_placeholder' : 'comments.placeholder')}
        placeholder={t(reply ? 'comments.reply_placeholder' : 'comments.placeholder')} />
      {error ? <AppText variant="caption" tone="danger">{t('comments.post_failed')}</AppText> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm }}>
        {reply ? <AppButton variant="secondary" fullWidth={false} size="sm" label={t('common.cancel')}
          accessibilityLabel={t('comments.cancel_reply')} disabled={busy} onPress={onCancelReply} /> : null}
        <AppButton variant="primary" fullWidth={false} size="sm" label={t('comments.post')} loading={busy} disabled={!content.trim()}
          onPress={() => { void post(); }} />
      </View>
    </View>
  </View>;
}
