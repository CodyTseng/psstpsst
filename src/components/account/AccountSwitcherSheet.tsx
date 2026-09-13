import Check from 'lucide-react-native/icons/check';
import GripVertical from 'lucide-react-native/icons/grip-vertical';
import CircleMinus from 'lucide-react-native/icons/circle-minus';
import SquarePen from 'lucide-react-native/icons/square-pen';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { InteractivePressable as Pressable, supportsHoverPointer } from '@/components/common/InteractivePressable';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { BottomSheet } from '@/components/common/BottomSheet';
import { IconButton } from '@/components/common/IconButton';
import Plus from 'lucide-react-native/icons/plus';
import { useAccountList } from '@/hooks/use-account-list';
import { useProfilesMap } from '@/hooks/use-profile';
import { useLanguageDirection } from '@/i18n/direction';
import { resolveName } from '@/lib/nostr/display-name';
import { abbreviateNpub } from '@/lib/nostr/format';
import { pubkeyToNpub } from '@/lib/nostr/keys';
import { platform } from '@/platform';
import { reorderAccounts } from '@/services/account/account.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { iconStrokeWidth } from '@/theme/icons';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Open the add-account flow (the caller navigates after the sheet closes, so
   * the two native transitions don't fight). */
  onAddAccount: () => void;
};

// Platform avatar + symmetric vertical padding — the fixed height every row
// snaps to while reordering, so the drag math is pure `slot * ROW_HEIGHT`.
const ROW_HEIGHT = uiDensity.listRowTwoLineHeight;
const AVATAR_SIZE = uiDensity.conversationAvatarSize;
const ROW_VERTICAL_PADDING = (ROW_HEIGHT - AVATAR_SIZE) / 2;
// The interaction pill bleeds 8px past the 16px sheet gutter. Its content inset
// restores avatars and trailing action containers to the sheet gutter.
const ROW_BLEED = spacing.sm;
const ROW_CONTENT_INSET = spacing.sm;
// Edit-mode "rails" the row squeezes its avatar/name between: a leading grip
// column (avatar slides right by this) and a trailing column (name pulls in by
// this). The active tick and the edit-mode delete share the *same* trailing
// column — same width, same right offset — so they sit at the exact same spot
// and just cross-fade in place when edit toggles.
const GRIP_W = 36;
const TRAIL_W = uiDensity.headerActionSize;
// How long a press must hold before a drag-reorder takes over (matches the
// quick-reactions editor). Short enough to feel instant, long enough that a
// downward flick still goes to the sheet's pull-to-dismiss instead.
const LONG_PRESS_MS = 180;
// Edit-mode squeeze + list-height transitions — one shared cadence so the rows
// and the sheet resize together.
const EDIT_MS = 200;
const HEIGHT_MS = 220;

type Slots = Record<string, number>;

/** Reindex the slot map when the row at `from` is dropped onto `to`. */
function moveRow(slots: Slots, from: number, to: number): Slots {
  'worklet';
  const next: Slots = {};
  for (const key in slots) {
    const at = slots[key];
    if (at === from) next[key] = to;
    else if (from < to && at > from && at <= to) next[key] = at - 1;
    else if (from > to && at < from && at >= to) next[key] = at + 1;
    else next[key] = at;
  }
  return next;
}

/**
 * The account switcher — long-press the Me tab avatar to bring it up. Lists every
 * account on the device with the active one ticked; tapping another switches to
 * it (which tears down and re-authenticates every relay connection as the new
 * identity). An **Edit** toggle in the sheet header enters an edit mode: each row's
 * avatar/name slide inward to reveal a leading drag handle and a trailing delete,
 * so accounts can be **removed** (a destructive `Alert`) and **reordered**
 * (long-press-drag, persisted to `sortOrder` via `reorderAccounts`); the "Add
 * account" row stays but is disabled. Mirrors the Gmail/Telegram switcher.
 *
 * The sheet shell stays mounted at all times (the close animation needs it),
 * but the hooks-heavy body — the account live query and the batched profile
 * fetch — mounts only once the sheet is first opened, so a cold start never
 * fires those queries. The body stays mounted through the close animation and
 * unmounts on `onClosed`, which also resets edit mode with it.
 */
export function AccountSwitcherSheet({ visible, onClose, onAddAccount }: Props) {
  const [bodyMounted, setBodyMounted] = useState(visible);
  const [headerAction, setHeaderAction] = useState<ReactNode>(undefined);
  const { t } = useTranslation();

  // Render-phase state adjustment (no effect → no extra commit before the open
  // animation starts): mount the body the moment the sheet opens.
  if (visible && !bodyMounted) setBodyMounted(true);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onClosed={() => {
        setBodyMounted(false);
        setHeaderAction(undefined);
      }}
      title={t('account.switch_title')}
      headerAction={headerAction}
    >
      {bodyMounted ? (
        <AccountSwitcherBody
          onClose={onClose}
          onAddAccount={onAddAccount}
          onHeaderActionChange={setHeaderAction}
        />
      ) : null}
    </BottomSheet>
  );
}

type BodyProps = {
  onClose: () => void;
  onAddAccount: () => void;
  /** Reports the Edit/Done action to the standard sheet header. */
  onHeaderActionChange: (node: ReactNode) => void;
};

function AccountSwitcherBody({ onClose, onAddAccount, onHeaderActionChange }: BodyProps) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const direction = useLanguageDirection();
  const accounts = useAccountList();
  const activePubkey = useActiveAccount((s) => s.activePubkey);
  const setActive = useActiveAccount((s) => s.setActive);
  const removeAccount = useActiveAccount((s) => s.removeAccount);
  const profiles = useProfilesMap(accounts.map((a) => a.pubkey));
  const [editing, setEditing] = useState(false);

  // pubkey -> index; drives each row's vertical position on the UI thread while
  // dragging. The live `accounts` order (its `sortOrder`) is the committed source
  // of truth — re-synced here whenever that order actually changes.
  const slots = useSharedValue<Slots>(Object.fromEntries(accounts.map((a, i) => [a.pubkey, i])));
  const orderKey = accounts.map((a) => a.pubkey).join(',');
  useEffect(() => {
    slots.value = Object.fromEntries(accounts.map((a, i) => [a.pubkey, i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);

  // Edit progress (0 → 1) drives every row's squeeze as one — so a row only just
  // measured renders settled, not replaying the slide (cf. ForwardRecipientScreen's select).
  const editProgress = useSharedValue(0);
  useEffect(() => {
    editProgress.value = withTiming(editing ? 1 : 0, { duration: EDIT_MS });
  }, [editing, editProgress]);

  // Animated list height so adding/removing a row resizes the sheet smoothly
  // instead of snapping. The absolutely-positioned rows don't contribute layout,
  // so the box's height is what the sheet measures.
  const listHeight = useSharedValue(accounts.length * ROW_HEIGHT);
  useEffect(() => {
    listHeight.value = withTiming(accounts.length * ROW_HEIGHT, { duration: HEIGHT_MS });
  }, [accounts.length, listHeight]);
  const listStyle = useAnimatedStyle(() => ({ height: listHeight.value }));

  function handleSelect(pubkey: string) {
    onClose();
    if (pubkey === activePubkey) return;
    // The boot screen covers the switch; fast for an established account.
    void setActive(pubkey);
  }

  function handleRemove(pubkey: string) {
    void platform.confirmationDialog
      .confirm({
        title: t('account.remove_title'),
        message: t('account.remove_message'),
        cancelLabel: t('common.cancel'),
        confirmLabel: t('account.remove_confirm'),
        destructive: true,
      })
      .then((confirmed) => {
        if (!confirmed) return;
        // Removing the active account returns to onboarding (the store + guard
        // handle it), so close the sheet. Removing a background account just
        // drops its row — keep the sheet open and let the live list update.
        if (pubkey === activePubkey) onClose();
        void removeAccount(pubkey);
      });
  }

  // Persist the dragged order (read off the UI-thread slot map) as the new
  // `sortOrder`; the live query then re-emits in this order and re-syncs `slots`.
  function commitOrder() {
    const pos = slots.value;
    const ordered = [...accounts].sort((a, b) => (pos[a.pubkey] ?? 0) - (pos[b.pubkey] ?? 0));
    void reorderAccounts(ordered.map((a) => a.pubkey));
  }

  // Reordering needs multiple accounts, but management does not: the sole
  // account must still be removable. Hide Edit only for an empty list.
  const showEditToggle = accounts.length > 0;
  useEffect(() => {
    onHeaderActionChange(
      showEditToggle ? (
        <IconButton
          accessibilityLabel={t(editing ? 'common.done' : 'common.edit')}
          variant={editing ? 'accent' : 'secondary'}
          size={uiDensity.headerActionSize}
          icon={editing
            ? <Check strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.accentForeground} />
            : <SquarePen strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.text} />}
          onPress={() => setEditing((current) => !current)}
        />
      ) : undefined,
    );
  }, [showEditToggle, editing, t, onHeaderActionChange, c.accentForeground, c.text]);

  return (
    <>
      {/* Absolutely-positioned rows over an animated-height box, so a drag-reorder
          can slide them and add/remove resizes the sheet smoothly (see SwitcherRow). */}
      <Animated.View style={listStyle}>
        {accounts.map((account, index) => {
          const profile = profiles[account.pubkey];
          return (
            <SwitcherRow
              key={account.pubkey}
              pubkey={account.pubkey}
              index={index}
              count={accounts.length}
              slots={slots}
              editProgress={editProgress}
              editing={editing}
              direction={direction}
              name={resolveName(profile) ?? t('profile.unnamed')}
              npub={abbreviateNpub(pubkeyToNpub(account.pubkey))}
              picture={profile?.picture}
              isActive={account.pubkey === activePubkey}
              onSelect={handleSelect}
              onRemove={handleRemove}
              onCommitOrder={commitOrder}
            />
          );
        })}
      </Animated.View>

      {/* Add account — kept while editing (so the sheet height doesn't jump) but
          disabled: dimmed and non-interactive, since you can't add mid-manage. */}
      <Pressable
        pressFeedback="delayed"
        onPress={editing ? undefined : () => { onClose(); onAddAccount(); }}
        disabled={editing}
        style={({ pressed }) => ({
          direction,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: ROW_VERTICAL_PADDING,
          paddingHorizontal: 8,
          marginHorizontal: -8,
          borderRadius: 12,
          opacity: editing ? 0.4 : 1,
          backgroundColor: pressed && !editing ? c.interactionOverlay : 'transparent',
        })}
      >
        <View
          style={{
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            borderRadius: AVATAR_SIZE / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: c.surfaceMuted,
          }}
        >
          <Plus strokeWidth={iconStrokeWidth.default} size={22} color={c.text} />
        </View>
        <AppText variant="body" weight="semibold">
          {t('account.add')}
        </AppText>
      </Pressable>
    </>
  );
}

type RowProps = {
  pubkey: string;
  index: number;
  count: number;
  slots: SharedValue<Slots>;
  editProgress: SharedValue<number>;
  editing: boolean;
  direction: 'ltr' | 'rtl';
  name: string;
  npub: string;
  picture?: string | null;
  isActive: boolean;
  onSelect: (pubkey: string) => void;
  onRemove: (pubkey: string) => void;
  onCommitOrder: () => void;
};

/**
 * One account row. Absolutely positioned at `slot * ROW_HEIGHT`. In **edit mode**
 * the avatar/name **slide inward** — driven by the shared `editProgress`, the
 * row's start/end padding grows to open a leading grip and a trailing delete —
 * and a long-press picks it up (`activateAfterLongPress`, so a quick downward
 * flick still falls through to the sheet's pull-to-dismiss) for a vertical
 * drag-reorder. The grip/delete fade in over the cleared rails; the active tick
 * cross-fades out. Mirrors `QuickReactionsEditor`'s drag, rotated to the vertical.
 */
function SwitcherRow({
  pubkey,
  index,
  count,
  slots,
  editProgress,
  editing,
  direction,
  name,
  npub,
  picture,
  isActive,
  onSelect,
  onRemove,
  onCommitOrder,
}: RowProps) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const y = useSharedValue(index * ROW_HEIGHT);
  const dragging = useSharedValue(false);
  const pressed = useSharedValue(false);
  const [hovered, setHovered] = useState(false);
  // The row's pixel position when the drag began — the fixed origin the finger's
  // cumulative translation adds to (the live slot shifts as rows reorder, so it
  // must not be the origin or the row would jump).
  const startY = useSharedValue(0);

  // Follow slot changes caused by *other* rows being dragged past this one.
  useAnimatedReaction(
    () => slots.value[pubkey],
    (slot, prev) => {
      if (slot != null && slot !== prev && !dragging.value) y.value = withSpring(slot * ROW_HEIGHT);
    },
  );

  const pan = Gesture.Pan()
    .enabled(editing)
    .activateAfterLongPress(LONG_PRESS_MS)
    .onStart(() => {
      dragging.value = true;
      startY.value = slots.value[pubkey] * ROW_HEIGHT;
    })
    .onUpdate((e) => {
      y.value = startY.value + e.translationY;
      const from = slots.value[pubkey];
      const to = Math.max(0, Math.min(count - 1, Math.round(y.value / ROW_HEIGHT)));
      if (to !== from) slots.value = moveRow(slots.value, from, to);
    })
    .onEnd(() => {
      y.value = withSpring(slots.value[pubkey] * ROW_HEIGHT);
    })
    .onFinalize(() => {
      if (dragging.value) {
        dragging.value = false;
        runOnJS(onCommitOrder)();
      }
    });

  const tap = Gesture.Tap()
    .enabled(!editing)
    .onBegin(() => {
      pressed.value = true;
    })
    .onFinalize(() => {
      pressed.value = false;
    })
    .onEnd(() => {
      runOnJS(onSelect)(pubkey);
    });

  // Drag transform + press/drag highlight, plus the edit "squeeze": the leading
  // padding opens a grip rail, while the trailing padding opens a delete
  // rail (name pulls in) — an active row starts from its narrower tick rail.
  const rowStyle = useAnimatedStyle(() => {
    // Active rows reserve the trailing column at rest (for the tick); non-active
    // rows open it only as edit progresses (for the delete) — both to TRAIL_W, so
    // the tick and delete land identically.
    const trailing = isActive ? TRAIL_W : editProgress.value * TRAIL_W;
    const startInset = ROW_CONTENT_INSET + editProgress.value * GRIP_W;
    const endInset = ROW_CONTENT_INSET + trailing;
    return {
      transform: [{ translateY: y.value }, { scale: withSpring(dragging.value ? 1.03 : 1) }],
      zIndex: dragging.value ? 1 : 0,
      backgroundColor: dragging.value
        ? c.surfaceMuted
        : pressed.value
          ? c.interactionOverlay
          : 'transparent',
      // Resolve logical insets before Reanimated writes directly to the DOM.
      paddingLeft: direction === 'rtl' ? endInset : startInset,
      paddingRight: direction === 'rtl' ? startInset : endInset,
    };
  });
  const gripStyle = useAnimatedStyle(() => ({ opacity: editProgress.value }));
  const deleteStyle = useAnimatedStyle(() => ({ opacity: editProgress.value }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: 1 - editProgress.value }));

  // On the web renderer (Electron), a Tap composed with `Exclusive` against a
  // disabled Pan never fires (the disabled gesture never fails, so the tap
  // waits forever); switching the whole composed gesture per mode keeps the
  // tap live. See docs/ARCHITECTURE.md overlays/modals.
  // Keep animated styles on the host view; a Pressable style callback can
  // overwrite imperative animation updates when its interaction state changes.
  return (
    <GestureDetector gesture={editing ? pan : tap}>
      <Animated.View
        accessible={false}
        onPointerEnter={(event) => {
          if (supportsHoverPointer(event.nativeEvent.pointerType)) setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
        style={[
          {
            position: 'absolute',
            // RN Web does not reliably inherit the root writing direction into
            // nested flex layout. Set it on the row so the avatar, text, and
            // logical action rails mirror as one unit.
            direction,
            // Bleed the interaction pill past the sheet gutter while keeping
            // visible row content aligned to the shared 16px rail.
            left: -ROW_BLEED,
            right: -ROW_BLEED,
            top: 0,
            height: ROW_HEIGHT,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            borderRadius: radius.lg,
            cursor: 'pointer',
          },
          rowStyle,
          hovered && !editing ? { backgroundColor: c.interactionOverlay } : undefined,
        ]}
      >
        {/* Drag handle, leading — revealed in the cleared start rail (a long-press
            anywhere on the row starts the drag, so this is just its affordance). */}
        <Animated.View
          style={[
            { position: 'absolute', start: 0, top: 0, bottom: 0, width: GRIP_W, alignItems: 'center', justifyContent: 'center' },
            gripStyle,
            { pointerEvents: 'none' },
          ]}
        >
          <GripVertical strokeWidth={iconStrokeWidth.default} size={20} color={c.textMuted} />
        </Animated.View>

        <Avatar pubkey={pubkey} picture={picture} name={name} size={AVATAR_SIZE} />
        <View style={{ flex: 1, gap: 2 }}>
          {/* No row fill — the active account is marked by an accent name + tick,
              a calm cue that's still clearer than a tick alone. */}
          <AppText
            variant="body"
            weight="semibold"
            numberOfLines={1}
            style={isActive ? { color: c.accent } : undefined}
          >
            {name}
          </AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {npub}
          </AppText>
        </View>

        {/* Trailing tick (active) — fades out as edit begins. Same TRAIL_W column
            + end offset as the delete below, so the two sit at the exact same spot. */}
        {isActive ? (
          <Animated.View
            style={[
              { position: 'absolute', end: ROW_CONTENT_INSET, top: 0, bottom: 0, width: TRAIL_W, alignItems: 'center', justifyContent: 'center' },
              checkStyle,
              { pointerEvents: 'none' },
            ]}
          >
            <Check strokeWidth={iconStrokeWidth.default} size={20} color={c.accent} />
          </Animated.View>
        ) : null}
        {/* Trailing delete — fades in with edit, in that same column; only tappable
            once fully editing. */}
        <Animated.View
          style={[
            { position: 'absolute', end: ROW_CONTENT_INSET, top: 0, bottom: 0, width: TRAIL_W, alignItems: 'center', justifyContent: 'center' },
            deleteStyle,
            { pointerEvents: editing ? 'auto' : 'none' },
          ]}
        >
          <IconButton
            variant="plain"
            size={uiDensity.iconButtonSize}
            icon={<CircleMinus strokeWidth={iconStrokeWidth.default} size={22} color={c.danger} />}
            onPress={() => onRemove(pubkey)}
            accessibilityLabel={t('account.remove_confirm')}
          />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}
