/* eslint-disable react-hooks/immutability -- Reanimated SharedValue updates are intentional in UI-thread gesture worklets. */
import CircleMinus from 'lucide-react-native/icons/circle-minus';
import { Pen as Pencil } from '@solar-icons/react-native/category/messages/Linear/Pen';
import {
  memo,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Keyboard,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextInput,
  View,
} from 'react-native';

import {
  InteractivePressable as Pressable,
  supportsHoverPointer,
} from '@/components/common/InteractivePressable';
import { useTranslation } from 'react-i18next';
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

import { ActionRow } from '@/components/common/ActionRow';
import { AppInput } from '@/components/common/AppInput';
import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { IconButton } from '@/components/common/IconButton';
import { InputDialog } from '@/components/common/InputDialog';
import { useIsRTL } from '@/i18n/direction';
import {
  isValidEmojiShortcode,
  MAX_EMOJI_SHORTCODE_LENGTH,
  normalizeEmojiShortcode,
  type CustomEmoji,
} from '@/lib/nostr/custom-emoji';
import { impact, selectionTick } from '@/lib/haptics';
import {
  IS_ELECTRON,
  type DesktopContextMenuEvent,
} from '@/lib/platform';
import { platform } from '@/platform';
import {
  removeStandaloneEmoji,
  renameStandaloneEmoji,
  reorderStandaloneEmojis,
} from '@/services/emoji/custom-emoji.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { iconStrokeWidth } from '@/theme/icons';
import { radius, spacing, useThemeColors } from '@/theme';

import {
  CustomEmojiGrid,
  CUSTOM_EMOJI_CELL_PADDING,
  type CustomEmojiGridCellArgs,
  type CustomEmojiGridLayout,
  resolveCustomEmojiGridLayout,
} from './custom-emoji-grid';

type Props = {
  active: boolean;
  allowEditing?: boolean;
  emojis: CustomEmoji[];
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  doneActionInGrid?: boolean;
  listHeader?: ReactElement;
  onAdd: () => void;
  onRemoveEmoji?: (emoji: CustomEmoji) => void;
  onRenameEmoji?: (emoji: CustomEmoji, shortcode: string) => void;
  onReorderEmojis?: (emojis: CustomEmoji[]) => void;
  onSelect: (emoji: CustomEmoji) => void;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  removalContext?: 'collection' | 'pack';
  scrollEventThrottle?: number;
  safeBottom: number;
  /** Clear an overlaid page title bar while preserving a full-height viewport. */
  contentTopInset?: number;
  contentTopPadding?: number;
  horizontalPadding?: number;
};

type Slots = Record<string, number>;

const ENTER_EDIT_LONG_PRESS_MS = 400;
const DRAG_LONG_PRESS_MS = 180;

function emojiKey(emoji: CustomEmoji): string {
  return JSON.stringify([emoji.shortcode.toLowerCase(), emoji.url]);
}

function slotsFor(emojis: CustomEmoji[]): Slots {
  return Object.fromEntries(emojis.map((emoji, index) => [emojiKey(emoji), index]));
}

function moveSlot(slots: Slots, from: number, to: number): Slots {
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

function slotX(index: number, stepX: number, columns: number): number {
  'worklet';
  return ((index + 1) % columns) * stepX;
}

function slotY(index: number, columns: number, rowHeight: number): number {
  'worklet';
  return Math.floor((index + 1) / columns) * rowHeight;
}

export const StandaloneEmojiGrid = memo(function StandaloneEmojiGrid({
  active,
  allowEditing = true,
  emojis,
  editing: controlledEditing,
  onEditingChange,
  doneActionInGrid = true,
  listHeader,
  onAdd,
  onRemoveEmoji,
  onRenameEmoji,
  onReorderEmojis,
  onSelect,
  onScroll,
  removalContext = 'collection',
  scrollEventThrottle,
  safeBottom,
  contentTopInset = 0,
  contentTopPadding = spacing.lg,
  horizontalPadding = spacing.lg,
}: Props) {
  const { t } = useTranslation();
  const isRTL = useIsRTL();
  const accountPubkey = useActiveAccount((state) => state.activePubkey);
  const [internalEditing, setInternalEditing] = useState(false);
  const editing = controlledEditing ?? internalEditing;
  const editingRef = useRef(false);
  const [draft, setDraft] = useState(emojis);
  const [deleteTarget, setDeleteTarget] = useState<CustomEmoji | null>(null);
  const [renameTarget, setRenameTarget] = useState<CustomEmoji | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<TextInput>(null);
  const deleteAfterCloseRef = useRef<CustomEmoji | null>(null);
  const latestCollectionRef = useRef(emojis);
  const draftRef = useRef(emojis);
  const pendingMutationsRef = useRef(0);
  const mutationFailedRef = useRef(false);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const slots = useSharedValue<Slots>(slotsFor(emojis));
  const initialLayout = resolveCustomEmojiGridLayout(0, horizontalPadding);
  const stepX = useSharedValue(initialLayout.columnStep);
  const gridColumns = useSharedValue(initialLayout.columns);
  const gridRowHeight = useSharedValue(initialLayout.rowHeight);
  const editProgress = useSharedValue(0);

  const applyLocalDraft = useCallback(
    (next: CustomEmoji[]) => {
      draftRef.current = next;
      setDraft(next);
      slots.value = slotsFor(next);
    },
    [slots],
  );

  useEffect(() => {
    latestCollectionRef.current = emojis;
    if (pendingMutationsRef.current === 0) applyLocalDraft(emojis);
  }, [applyLocalDraft, emojis]);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  const updateEditing = useCallback(
    (next: boolean) => {
      editingRef.current = next;
      if (controlledEditing === undefined) setInternalEditing(next);
      onEditingChange?.(next);
    },
    [controlledEditing, onEditingChange],
  );

  useEffect(() => {
    if (active) return;
    const timeout = setTimeout(() => updateEditing(false), 0);
    return () => clearTimeout(timeout);
  }, [active, updateEditing]);

  useEffect(() => {
    editProgress.value = withTiming(editing ? 1 : 0, { duration: 160 });
  }, [editProgress, editing]);

  const enterEditing = useCallback(() => {
    if (!IS_ELECTRON) impact('medium');
    updateEditing(true);
  }, [updateEditing]);

  const leaveEditing = useCallback(() => {
    updateEditing(false);
  }, [updateEditing]);

  const selectEmoji = useCallback(
    (emoji: CustomEmoji) => {
      // A gesture object from the preceding render can finish after edit mode
      // has begun. Keep this JS guard in addition to disabling its recognizer.
      if (!editingRef.current) onSelect(emoji);
    },
    [onSelect],
  );

  const persist = useCallback(
    (
      next: CustomEmoji[],
      mutation: (pubkey: string) => Promise<void>,
    ) => {
      if (!accountPubkey) {
        slots.value = slotsFor(draftRef.current);
        return;
      }
      applyLocalDraft(next);
      pendingMutationsRef.current += 1;

      const queued = mutationQueueRef.current
        .then(
          () =>
            new Promise<void>((resolve) => {
              setTimeout(resolve, 0);
            }),
        )
        .then(() => mutation(accountPubkey))
        .catch(() => {
          mutationFailedRef.current = true;
        })
        .finally(() => {
          pendingMutationsRef.current -= 1;
          if (pendingMutationsRef.current !== 0) return;

          setTimeout(() => {
            if (pendingMutationsRef.current !== 0) return;
            if (mutationFailedRef.current) {
              mutationFailedRef.current = false;
              applyLocalDraft(latestCollectionRef.current);
              leaveEditing();
              void platform.confirmationDialog.notify({
                title: t('emoji.save_failed'),
                okLabel: t('common.ok'),
              });
            }
          }, 0);
        });
      mutationQueueRef.current = queued;
    },
    [accountPubkey, applyLocalDraft, leaveEditing, slots, t],
  );

  const commitOrder = useCallback(() => {
    const positions = slots.value;
    const next = [...draft].sort(
      (left, right) =>
        (positions[emojiKey(left)] ?? 0) - (positions[emojiKey(right)] ?? 0),
    );
    if (next.every((emoji, index) => emojiKey(emoji) === emojiKey(draft[index]))) {
      return;
    }
    if (onReorderEmojis) {
      applyLocalDraft(next);
      onReorderEmojis(next);
      return;
    }
    persist(next, (pubkey) => reorderStandaloneEmojis(pubkey, next));
  }, [applyLocalDraft, draft, onReorderEmojis, persist, slots]);

  const removeEmoji = useCallback(
    (emoji: CustomEmoji) => {
      const next = draft.filter((item) => emojiKey(item) !== emojiKey(emoji));
      if (onRemoveEmoji) {
        applyLocalDraft(next);
        onRemoveEmoji(emoji);
        return;
      }
      persist(next, (pubkey) => removeStandaloneEmoji(pubkey, emoji));
    },
    [applyLocalDraft, draft, onRemoveEmoji, persist],
  );

  const openRename = useCallback((emoji: CustomEmoji) => {
    setRenameValue(emoji.shortcode);
    setRenameTarget(emoji);
  }, []);

  const normalizedRename = normalizeEmojiShortcode(renameValue);
  const renameValid = isValidEmojiShortcode(normalizedRename);
  const renameDuplicate =
    renameTarget !== null &&
    draft.some(
      (emoji) =>
        emojiKey(emoji) !== emojiKey(renameTarget) &&
        emoji.shortcode.toLowerCase() === normalizedRename.toLowerCase(),
    );

  const saveRename = useCallback(() => {
    if (!renameTarget || !renameValid || renameDuplicate) return;
    const target = renameTarget;
    const shortcode = normalizedRename;
    Keyboard.dismiss();
    setRenameTarget(null);
    if (target.shortcode === shortcode) return;

    const renamed = { ...target, shortcode };
    const next = draft.map((emoji) =>
      emojiKey(emoji) === emojiKey(target) ? renamed : emoji,
    );
    if (onRenameEmoji) {
      applyLocalDraft(next);
      onRenameEmoji(target, shortcode);
      return;
    }
    persist(next, (pubkey) => renameStandaloneEmoji(pubkey, target, shortcode));
  }, [
    applyLocalDraft,
    draft,
    normalizedRename,
    onRenameEmoji,
    persist,
    renameDuplicate,
    renameTarget,
    renameValid,
  ]);

  const confirmRemove = useCallback(() => {
    if (!deleteTarget) return;
    deleteAfterCloseRef.current = deleteTarget;
    setDeleteTarget(null);
  }, [deleteTarget]);

  const finishDeleteSheet = useCallback(() => {
    const target = deleteAfterCloseRef.current;
    deleteAfterCloseRef.current = null;
    if (target) removeEmoji(target);
  }, [removeEmoji]);

  const renderEmojiCell = useCallback(
    ({ emoji, index, image, label, layout }: CustomEmojiGridCellArgs) => (
      <SortableEmojiCell
        key={`${emojiKey(emoji)}:${index}`}
        emoji={emoji}
        index={index}
        count={draft.length}
        slots={slots}
        stepX={stepX}
        gridColumns={gridColumns}
        gridRowHeight={gridRowHeight}
        editProgress={editProgress}
        editing={editing}
        editingEnabled={allowEditing}
        onEnterEditing={enterEditing}
        onSelect={selectEmoji}
        onRename={openRename}
        onCommit={commitOrder}
        onRemove={setDeleteTarget}
        image={image}
        label={label}
        cellSize={layout.cellSize}
        rowHeight={layout.rowHeight}
        isRTL={isRTL}
      />
    ),
    [
      commitOrder,
      draft.length,
      editing,
      allowEditing,
      enterEditing,
      openRename,
      selectEmoji,
      slots,
      stepX,
      gridColumns,
      gridRowHeight,
      editProgress,
      isRTL,
    ],
  );

  const updateGridLayout = useCallback(
    (layout: CustomEmojiGridLayout) => {
      stepX.value = layout.columnStep;
      gridColumns.value = layout.columns;
      gridRowHeight.value = layout.rowHeight;
    },
    [gridColumns, gridRowHeight, stepX],
  );
  const leadingAction = useMemo(
    () =>
      editing && doneActionInGrid
        ? {
            label: t('common.done'),
            icon: 'done' as const,
            onPress: leaveEditing,
          }
        : {
            label: t('emoji.add_custom_emoji'),
            icon: 'add' as const,
            onPress: onAdd,
          },
    [doneActionInGrid, editing, leaveEditing, onAdd, t],
  );

  return (
    <>
      <CustomEmojiGrid
        emojis={draft}
        extraData={editing}
        listHeader={listHeader}
        renderEmojiCell={renderEmojiCell}
        horizontalPadding={horizontalPadding}
        leadingAction={leadingAction}
        onLayoutResolved={updateGridLayout}
        onScroll={onScroll}
        scrollEventThrottle={scrollEventThrottle}
        contentContainerStyle={{
          paddingTop: contentTopInset + contentTopPadding,
          paddingBottom: Math.max(safeBottom, spacing.md),
        }}
        removeClippedSubviews={!editing}
      />

      {IS_ELECTRON ? (
        // A pure single-field entry — the desktop form is the centered input
        // dialog (DESIGN §10 Electron presentation split).
        <InputDialog
          visible={renameTarget !== null}
          onClose={() => setRenameTarget(null)}
          actionLayout="vertical"
          confirmLabel={t('common.save')}
          confirmDisabled={!renameValid || renameDuplicate}
          onConfirm={saveRename}
        >
          <AppInput
            description={t('emoji.shortcode_hint')}
            error={renameDuplicate ? t('emoji.duplicate_standalone_shortcode') : undefined}
            value={renameValue}
            onChangeText={(value) =>
              setRenameValue(
                value
                  .replace(/[^A-Za-z0-9_-]/g, '')
                  .slice(0, MAX_EMOJI_SHORTCODE_LENGTH),
              )
            }
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            selectTextOnFocus
            maxLength={MAX_EMOJI_SHORTCODE_LENGTH}
            placeholder={t('emoji.shortcode_placeholder')}
            invalid={renameValue.length > 0 && (!renameValid || renameDuplicate)}
            onSubmitEditing={saveRename}
          />
        </InputDialog>
      ) : (
        <BottomSheet
          visible={renameTarget !== null}
          onClose={() => setRenameTarget(null)}
          inputFocusRef={renameInputRef}
          title={t('emoji.rename_saved_title')}
          contentStyle={{ gap: spacing.lg }}
        >
          <AppInput
            ref={renameInputRef}
            description={t('emoji.shortcode_hint')}
            error={renameDuplicate ? t('emoji.duplicate_standalone_shortcode') : undefined}
            value={renameValue}
            onChangeText={(value) =>
              setRenameValue(
                value
                  .replace(/[^A-Za-z0-9_-]/g, '')
                  .slice(0, MAX_EMOJI_SHORTCODE_LENGTH),
              )
            }
            autoCapitalize="none"
            autoCorrect={false}
            selectTextOnFocus
            maxLength={MAX_EMOJI_SHORTCODE_LENGTH}
            placeholder={t('emoji.shortcode_placeholder')}
            invalid={renameValue.length > 0 && (!renameValid || renameDuplicate)}
            onSubmitEditing={saveRename}
          />
          <ActionRow
            layout="vertical"
            confirm={{
              label: t('common.save'),
              disabled: !renameValid || renameDuplicate,
              onPress: saveRename,
            }}
          />
        </BottomSheet>
      )}

      <BottomSheet
        visible={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onClosed={finishDeleteSheet}
        title={t(
          removalContext === 'pack'
            ? 'emoji.remove_from_pack_title'
            : 'emoji.delete_saved_title',
        )}
      >
        <View style={{ gap: spacing.md }}>
          <AppText variant="body" tone="muted">
            {t(
              removalContext === 'pack'
                ? 'emoji.remove_from_pack_message'
                : 'emoji.delete_saved_message',
              {
                shortcode: deleteTarget?.shortcode ?? '',
              },
            )}
          </AppText>
          <ActionRow
            layout="horizontal"
            dismiss={{ label: t('common.cancel'), onPress: () => setDeleteTarget(null) }}
            confirm={{
              label: t(
                removalContext === 'pack'
                  ? 'emoji.remove_from_pack_confirm'
                  : 'emoji.delete_saved_confirm',
              ),
              destructive: true,
              onPress: confirmRemove,
            }}
          />
        </View>
      </BottomSheet>
    </>
  );
});

type SortableEmojiCellProps = {
  emoji: CustomEmoji;
  index: number;
  count: number;
  slots: SharedValue<Slots>;
  stepX: SharedValue<number>;
  gridColumns: SharedValue<number>;
  gridRowHeight: SharedValue<number>;
  editProgress: SharedValue<number>;
  editing: boolean;
  editingEnabled: boolean;
  onEnterEditing: () => void;
  onSelect: (emoji: CustomEmoji) => void;
  onRename: (emoji: CustomEmoji) => void;
  onCommit: () => void;
  onRemove: (emoji: CustomEmoji) => void;
  image: ReactNode;
  label: ReactNode;
  cellSize: number;
  rowHeight: number;
  isRTL: boolean;
};

function SortableEmojiCell({
  emoji,
  index,
  count,
  slots,
  stepX,
  gridColumns,
  gridRowHeight,
  editProgress,
  editing,
  editingEnabled,
  onEnterEditing,
  onSelect,
  onRename,
  onCommit,
  onRemove,
  image,
  label,
  cellSize,
  rowHeight,
  isRTL,
}: SortableEmojiCellProps) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const key = emojiKey(emoji);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const dragging = useSharedValue(false);
  const [hovered, setHovered] = useState(false);

  useAnimatedReaction(
    () => [
      slots.value[key] ?? index,
      stepX.value,
      gridColumns.value,
      gridRowHeight.value,
    ] as const,
    ([slot, horizontalStep, columns, resolvedRowHeight], previous) => {
      if (
        !dragging.value &&
        (slot !== previous?.[0] ||
          horizontalStep !== previous?.[1] ||
          columns !== previous?.[2] ||
          resolvedRowHeight !== previous?.[3])
      ) {
        x.value = withSpring(
          (slotX(slot, horizontalStep, columns) - slotX(index, horizontalStep, columns)) *
            (isRTL ? -1 : 1),
        );
        y.value = withSpring(
          slotY(slot, columns, resolvedRowHeight) -
            slotY(index, columns, resolvedRowHeight),
        );
      }
    },
  );

  const pan = Gesture.Pan().enabled(
    editingEnabled && (!editing || count > 1),
  );

  if (IS_ELECTRON && editing) {
    // Once pointer editing is explicit, a normal primary-button drag reorders
    // without another hold. Outside edit mode, keep long-press as an entrance.
    pan.minDistance(spacing.xs);
  } else {
    pan.activateAfterLongPress(
      editing ? DRAG_LONG_PRESS_MS : ENTER_EDIT_LONG_PRESS_MS,
    );
  }

  pan
    .onStart(() => {
      'worklet';
      dragging.value = true;
      startX.value = x.value;
      startY.value = y.value;
      if (!editing) runOnJS(onEnterEditing)();
    })
    .onUpdate((event) => {
      'worklet';
      x.value = startX.value + event.translationX;
      y.value = startY.value + event.translationY;

      const horizontalStep = stepX.value;
      const columns = gridColumns.value;
      const resolvedRowHeight = gridRowHeight.value;
      if (horizontalStep <= 0) return;
      const column = Math.max(
        0,
        Math.min(
          columns - 1,
          Math.round(
            (slotX(index, horizontalStep, columns) + x.value * (isRTL ? -1 : 1)) /
              horizontalStep,
          ),
        ),
      );
      const row = Math.max(
        0,
        Math.round(
          (slotY(index, columns, resolvedRowHeight) + y.value) / resolvedRowHeight,
        ),
      );
      const physicalSlot = Math.max(
        1,
        Math.min(count, row * columns + column),
      );
      const from = slots.value[key];
      const to = physicalSlot - 1;
      if (to !== from) {
        slots.value = moveSlot(slots.value, from, to);
        runOnJS(selectionTick)();
      }
    })
    .onFinalize(() => {
      'worklet';
      if (dragging.value) {
        const slot = slots.value[key];
        const columns = gridColumns.value;
        const resolvedRowHeight = gridRowHeight.value;
        x.value = withSpring(
          (slotX(slot, stepX.value, columns) - slotX(index, stepX.value, columns)) *
            (isRTL ? -1 : 1),
        );
        y.value = withSpring(
          slotY(slot, columns, resolvedRowHeight) -
            slotY(index, columns, resolvedRowHeight),
        );
        dragging.value = false;
        runOnJS(onCommit)();
      }
    });

  const handleContextMenu = useCallback(
    (event: DesktopContextMenuEvent) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (!editing) onEnterEditing();
    },
    [editing, onEnterEditing],
  );

  const tap = Gesture.Tap()
    .enabled(!editing)
    .onEnd(() => {
      'worklet';
      runOnJS(onSelect)(emoji);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: withSpring(dragging.value ? 1.04 : 1) },
    ],
    zIndex: dragging.value ? 10 : 0,
  }));
  const deleteStyle = useAnimatedStyle(() => ({
    opacity: editProgress.value,
    transform: [{ scale: 0.82 + editProgress.value * 0.18 }],
  }));

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <Animated.View
        {...(IS_ELECTRON && editingEnabled
          ? { onContextMenu: handleContextMenu }
          : {})}
        accessibilityRole={editingEnabled ? 'adjustable' : 'button'}
        accessibilityLabel={
          editing
            ? t('emoji.rename_saved_accessibility', {
                shortcode: emoji.shortcode,
              })
            : emoji.shortcode
        }
        onAccessibilityTap={() =>
          editing ? onRename(emoji) : onSelect(emoji)
        }
        onPointerEnter={(event) => {
          if (supportsHoverPointer(event.nativeEvent.pointerType)) setHovered(true);
        }}
        onPointerLeave={(event) => {
          if (supportsHoverPointer(event.nativeEvent.pointerType)) setHovered(false);
        }}
        style={[
          {
            width: cellSize,
            height: rowHeight,
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.xs,
            cursor: 'pointer',
          },
          animatedStyle,
        ]}
      >
        <View
          style={{
            width: cellSize,
            height: cellSize,
            padding: CUSTOM_EMOJI_CELL_PADDING,
            borderRadius: radius.sm,
            borderCurve: 'continuous',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: hovered ? c.interactionOverlay : 'transparent',
          }}
        >
          {image}
          {editing ? (
            // Mounted only in edit mode: outside it the cell itself renders
            // as a <button> on web (accessibilityRole="button"), so a nested
            // IconButton <button> is invalid HTML and react-dom errors. While
            // editing the cell role is "adjustable" (a slider-role div),
            // which may legally contain a button.
            <Animated.View
              style={[
                {
                  position: 'absolute',
                  top: -spacing.xs,
                  end: -spacing.md,
                },
                deleteStyle,
              ]}
            >
              <IconButton
                variant="secondary"
                size={spacing.xl}
                hitSlop={spacing.sm}
                icon={<CircleMinus strokeWidth={iconStrokeWidth.default} size={16} color={c.danger} />}
                onPress={() => onRemove(emoji)}
                accessibilityLabel={t('emoji.delete_saved_accessibility', {
                  shortcode: emoji.shortcode,
                })}
              />
            </Animated.View>
          ) : null}
        </View>
        {editing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('emoji.rename_saved_accessibility', {
              shortcode: emoji.shortcode,
            })}
            onPress={() => onRename(emoji)}
            style={{
              maxWidth: cellSize,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.xs,
            }}
          >
            <AppText
              variant="caption"
              tone="accent"
              numberOfLines={1}
              style={{
                maxWidth: cellSize - spacing.lg,
              }}
            >
              {emoji.shortcode}
            </AppText>
            <Pencil size={12} color={c.accent} />
          </Pressable>
        ) : (
          label
        )}
      </Animated.View>
    </GestureDetector>
  );
}
