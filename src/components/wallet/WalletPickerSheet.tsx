import Check from 'lucide-react-native/icons/check';
import GripVertical from 'lucide-react-native/icons/grip-vertical';
import CircleMinus from 'lucide-react-native/icons/circle-minus';
import SquarePen from 'lucide-react-native/icons/square-pen';
import { Pen as Pencil } from '@solar-icons/react-native/category/messages/Linear/Pen';
import { type TextInput, View } from 'react-native';
import { useEffect, useRef, useState } from 'react';
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
import { supportsHoverPointer } from '@/components/common/InteractivePressable';
import { InputDialog } from '@/components/common/InputDialog';
import { ListRow } from '@/components/common/ListRow';
import Plus from 'lucide-react-native/icons/plus';
import { useLanguageDirection } from '@/i18n/direction';
import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import type { WalletRow } from '@/services/wallet/wallet.service';
import {
  removeWallet,
  renameWallet,
  reorderWallets,
  setDefaultWallet,
} from '@/services/wallet/wallet.service';
import { showToast } from '@/stores/toast.store';
import { iconStrokeWidth } from '@/theme/icons';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

type Props = {
  visible: boolean;
  accountPubkey: string;
  wallets: WalletRow[];
  onClose: () => void;
  onAdd: () => void;
};

const ROW_HEIGHT = uiDensity.listRowHeight;
// Match AccountSwitcherSheet: the interaction pill bleeds 8px past the sheet
// gutter, while content and trailing action containers align with the header.
const ROW_BLEED = spacing.sm;
const ROW_CONTENT_INSET = spacing.sm;
const GRIP_W = 36;
const CHECK_W = uiDensity.headerActionSize;
const ACTION_BUTTON_SIZE = uiDensity.iconButtonSize;
// Two action buttons plus their gap and symmetric slack, keeping the delete
// button centered beneath the header action at either platform density.
const ACTION_W =
  ACTION_BUTTON_SIZE * 2 + spacing.sm + (CHECK_W - ACTION_BUTTON_SIZE);
const LONG_PRESS_MS = 180;
const EDIT_MS = 200;
const HEIGHT_MS = 220;

type Slots = Record<string, number>;

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

export function WalletPickerSheet({ visible, accountPubkey, wallets, onClose, onAdd }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState<WalletRow | null>(null);
  const [name, setName] = useState('');
  const renameInputRef = useRef<TextInput>(null);
  // Electron: renaming leaves the management sheet and continues in the
  // centered input dialog once the sheet has fully closed (two-modals rule).
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const slots = useSharedValue<Slots>(Object.fromEntries(wallets.map((wallet, i) => [wallet.id, i])));
  const orderKey = wallets.map((wallet) => wallet.id).join(',');
  const editProgress = useSharedValue(0);
  const listHeight = useSharedValue(wallets.length * ROW_HEIGHT);

  useEffect(() => {
    if (visible) return;
    // On Electron the rename dialog owns `renaming` after the sheet closes.
    if (IS_ELECTRON) return;
    setRenaming(null);
  }, [visible]);

  useEffect(() => {
    slots.value = Object.fromEntries(wallets.map((wallet, i) => [wallet.id, i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);

  useEffect(() => {
    editProgress.value = withTiming(editing ? 1 : 0, { duration: EDIT_MS });
  }, [editing, editProgress]);

  useEffect(() => {
    listHeight.value = withTiming(wallets.length * ROW_HEIGHT, { duration: HEIGHT_MS });
  }, [wallets.length, listHeight]);

  const listStyle = useAnimatedStyle(() => ({ height: listHeight.value }));

  function reportUpdateFailure(): void {
    showToast(t('wallet.update_failed'));
  }

  function closeRenameDialog() {
    setRenameDialogOpen(false);
    setRenaming(null);
  }

  function commitRename() {
    if (!renaming) return;
    void renameWallet(accountPubkey, renaming.id, name).catch(reportUpdateFailure);
    closeRenameDialog();
  }

  function confirmRemove(wallet: WalletRow) {
    void platform.confirmationDialog
      .confirm({
        title: t('wallet.remove_title'),
        message: t('wallet.remove_message'),
        cancelLabel: t('common.cancel'),
        confirmLabel: t('wallet.remove_confirm'),
        destructive: true,
      })
      .then((confirmed) => {
        if (confirmed) {
          void removeWallet(accountPubkey, wallet.id).catch(reportUpdateFailure);
        }
      });
  }

  function commitOrder() {
    const pos = slots.value;
    const ordered = [...wallets].sort((a, b) => (pos[a.id] ?? 0) - (pos[b.id] ?? 0));
    void reorderWallets(accountPubkey, ordered.map((wallet) => wallet.id)).catch(
      reportUpdateFailure,
    );
  }

  const headerAction = !renaming && wallets.length > 0 ? (
    <IconButton
      accessibilityLabel={t(editing ? 'common.done' : 'common.edit')}
      variant={editing ? 'accent' : 'secondary'}
      size={uiDensity.headerActionSize}
      icon={editing
        ? <Check strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.accentForeground} />
        : <SquarePen strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.text} />}
      onPress={() => setEditing((current) => !current)}
    />
  ) : undefined;

  return (
    <>
      <BottomSheet
        visible={visible}
        onClose={onClose}
        onClosed={() => {
          setEditing(false);
          // Electron: a pending rename continues in the input dialog now that
          // the sheet has fully closed; otherwise the mode is simply dropped.
          if (IS_ELECTRON && renaming) {
            setRenameDialogOpen(true);
          } else {
            setRenaming(null);
          }
        }}
        inputFocusRef={renameInputRef}
        inputFocusKey={renaming?.id ?? null}
        title={t(renaming && !IS_ELECTRON ? 'wallet.rename' : 'wallet.manage')}
        headerAction={headerAction}
        contentStyle={
          renaming
            ? { gap: spacing.md }
            : wallets.length === 0
              ? { gap: spacing.lg }
              : undefined
        }
      >
      {renaming && !IS_ELECTRON ? (
        <>
          <AppInput
            ref={renameInputRef}
            value={name}
            onChangeText={setName}
            placeholder={renaming.customName || renaming.name}
          />
          <ActionRow
            layout="horizontal"
            dismiss={{ label: t('common.cancel'), onPress: () => setRenaming(null) }}
            confirm={{
              label: t('wallet.save_name'),
              onPress: () => {
                void renameWallet(accountPubkey, renaming.id, name).catch(reportUpdateFailure);
                setRenaming(null);
              },
            }}
          />
        </>
      ) : (
        <>
          {wallets.length > 0 ? (
            <Animated.View style={listStyle}>
              {wallets.map((wallet, index) => {
                const displayName = wallet.customName || wallet.name;
                return (
                  <WalletPickerRow
                    key={wallet.id}
                    wallet={wallet}
                    index={index}
                    count={wallets.length}
                    slots={slots}
                    editProgress={editProgress}
                    editing={editing}
                    displayName={displayName}
                    onSelect={(id) => {
                      void setDefaultWallet(accountPubkey, id).catch(reportUpdateFailure);
                      onClose();
                    }}
                    onRename={() => {
                      setName(displayName);
                      setRenaming(wallet);
                      // Electron continues the rename in the input dialog once
                      // the sheet has closed (see onClosed).
                      if (IS_ELECTRON) onClose();
                    }}
                    onRemove={() => confirmRemove(wallet)}
                    onCommitOrder={commitOrder}
                  />
                );
              })}
            </Animated.View>
          ) : null}

          {wallets.length === 0 ? (
            <AppText variant="body" tone="muted" align="center">
              {t('wallet.empty_hint')}
            </AppText>
          ) : null}

          <ListRow
            variant="plain"
            title={t('wallet.add')}
            disabled={editing}
            icon={<Plus strokeWidth={iconStrokeWidth.default} size={22} color={c.text} />}
            onPress={() => {
              onClose();
              onAdd();
            }}
          />
        </>
      )}
    </BottomSheet>

    <InputDialog
      visible={renameDialogOpen && renaming != null}
      onClose={closeRenameDialog}
      actionLayout="horizontal"
      cancelLabel={t('common.cancel')}
      confirmLabel={t('wallet.save_name')}
      onConfirm={commitRename}
    >
      <AppInput
        value={name}
        onChangeText={setName}
        placeholder={renaming?.customName || renaming?.name}
        autoFocus
        onSubmitEditing={commitRename}
      />
    </InputDialog>
  </>
  );
}

type RowProps = {
  wallet: WalletRow;
  index: number;
  count: number;
  slots: SharedValue<Slots>;
  editProgress: SharedValue<number>;
  editing: boolean;
  displayName: string;
  onSelect: (walletId: string) => void;
  onRename: () => void;
  onRemove: () => void;
  onCommitOrder: () => void;
};

function WalletPickerRow({
  wallet,
  index,
  count,
  slots,
  editProgress,
  editing,
  displayName,
  onSelect,
  onRename,
  onRemove,
  onCommitOrder,
}: RowProps) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const direction = useLanguageDirection();
  const y = useSharedValue(index * ROW_HEIGHT);
  const dragging = useSharedValue(false);
  const pressed = useSharedValue(false);
  const [hovered, setHovered] = useState(false);
  const startY = useSharedValue(0);

  useAnimatedReaction(
    () => slots.value[wallet.id],
    (slot, prev) => {
      if (slot != null && slot !== prev && !dragging.value) y.value = withSpring(slot * ROW_HEIGHT);
    },
  );

  const pan = Gesture.Pan()
    .enabled(editing)
    .activateAfterLongPress(LONG_PRESS_MS)
    .onStart(() => {
      dragging.value = true;
      startY.value = slots.value[wallet.id] * ROW_HEIGHT;
    })
    .onUpdate((e) => {
      y.value = startY.value + e.translationY;
      const from = slots.value[wallet.id];
      const to = Math.max(0, Math.min(count - 1, Math.round(y.value / ROW_HEIGHT)));
      if (to !== from) slots.value = moveRow(slots.value, from, to);
    })
    .onEnd(() => {
      y.value = withSpring(slots.value[wallet.id] * ROW_HEIGHT);
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
      runOnJS(onSelect)(wallet.id);
    });

  const rowStyle = useAnimatedStyle(() => {
    const startInset = ROW_CONTENT_INSET + editProgress.value * GRIP_W;
    const endInset = ROW_CONTENT_INSET + (wallet.isDefault
      ? CHECK_W + editProgress.value * (ACTION_W - CHECK_W)
      : editProgress.value * ACTION_W);
    return {
      transform: [{ translateY: y.value }, { scale: withSpring(dragging.value ? 1.03 : 1) }],
      zIndex: dragging.value ? 1 : 0,
      backgroundColor: dragging.value
        ? c.surfaceMuted
        : pressed.value
          ? c.interactionOverlay
          : 'transparent',
      // Reanimated updates the DOM directly on Electron. Resolve logical
      // insets here because paddingStart/End are not CSS properties.
      paddingLeft: direction === 'rtl' ? endInset : startInset,
      paddingRight: direction === 'rtl' ? startInset : endInset,
    };
  });
  const gripStyle = useAnimatedStyle(() => ({ opacity: editProgress.value }));
  const actionStyle = useAnimatedStyle(() => ({ opacity: editProgress.value }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: 1 - editProgress.value }));

  // See AccountSwitcherSheet: on the web renderer an Exclusive-composed Tap
  // against a disabled Pan never fires, so compose per mode instead.
  // Apply animated styles directly to the host view so Pressable interaction
  // updates cannot overwrite the row's animated position and edit insets.
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
            direction,
            start: -ROW_BLEED,
            end: -ROW_BLEED,
            top: 0,
            height: ROW_HEIGHT,
            flexDirection: 'row',
            alignItems: 'center',
            borderRadius: radius.lg,
            cursor: 'pointer',
          },
          rowStyle,
          hovered && !editing ? { backgroundColor: c.interactionOverlay } : undefined,
        ]}
      >
        <Animated.View
          style={[
            {
              position: 'absolute',
              start: 0,
              top: 0,
              bottom: 0,
              width: GRIP_W,
              alignItems: 'center',
              justifyContent: 'center',
            },
            gripStyle,
            { pointerEvents: 'none' },
          ]}
        >
          <GripVertical strokeWidth={iconStrokeWidth.default} size={20} color={c.textMuted} />
        </Animated.View>

        <View style={{ flex: 1 }}>
          <AppText
            variant="subtitle"
            weight="regular"
            numberOfLines={1}
            style={wallet.isDefault ? { color: c.accent } : undefined}
          >
            {displayName}
          </AppText>
        </View>

        {wallet.isDefault ? (
          <Animated.View
            style={[
              {
                position: 'absolute',
                end: ROW_CONTENT_INSET,
                top: 0,
                bottom: 0,
                width: CHECK_W,
                alignItems: 'center',
                justifyContent: 'center',
              },
              checkStyle,
              { pointerEvents: 'none' },
            ]}
          >
            <Check strokeWidth={iconStrokeWidth.default} size={20} color={c.accent} />
          </Animated.View>
        ) : null}

        <Animated.View
          style={[
            {
              position: 'absolute',
              end: ROW_CONTENT_INSET,
              top: 0,
              bottom: 0,
              width: ACTION_W,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.sm,
            },
            actionStyle,
            { pointerEvents: editing ? 'auto' : 'none' },
          ]}
        >
          <IconButton
            variant="plain"
            size={ACTION_BUTTON_SIZE}
            onPress={onRename}
            icon={<Pencil size={18} color={c.textMuted} />}
            accessibilityLabel={t('wallet.rename')}
          />
          <IconButton
            variant="plain"
            size={ACTION_BUTTON_SIZE}
            onPress={onRemove}
            icon={<CircleMinus strokeWidth={iconStrokeWidth.default} size={22} color={c.danger} />}
            accessibilityLabel={t('wallet.remove_confirm')}
          />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}
