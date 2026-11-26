import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Timer from 'lucide-react-native/icons/timer';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { ContextMenuOverlay, type ContextMenuAnchor } from '@/components/common/ContextMenu';
import { DirectionalChevron } from '@/components/common/DirectionalChevron';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { RadioIndicator } from '@/components/common/radio-indicator';
import { useMessageExpirySettings } from '@/hooks/use-message-expiry-settings';
import { useLanguageDirection } from '@/i18n/direction';
import { DISAPPEARING_DURATIONS, validExpiryDuration } from '@/lib/nostr/disappearing-message';
import { IS_ELECTRON } from '@/lib/platform';
import { DEFAULT_MESSAGE_EXPIRY_SLOT, messageExpiryDuration } from '@/services/conversation/message-expiry-preference';
import { setMessageExpirySetting } from '@/services/conversation/message-expiry-sync';
import { spacing, uiDensity, useThemeColors } from '@/theme';

const UNITS = [
  { name: 'week', seconds: 604800 },
  { name: 'day', seconds: 86400 },
  { name: 'hour', seconds: 3600 },
  { name: 'minute', seconds: 60 },
  { name: 'second', seconds: 1 },
] as const;

type Unit = typeof UNITS[number];

function durationParts(seconds: number): Unit {
  return UNITS.find(unit => seconds % unit.seconds === 0) ?? UNITS[UNITS.length - 1];
}

export function MessageExpirySetting({
  accountPubkey, conversationKey, legacyDuration, disabled,
}: {
  accountPubkey: string;
  conversationKey?: string;
  legacyDuration?: number | null;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const c = useThemeColors();
  const direction = useLanguageDirection();
  const insets = useSafeAreaInsets();
  const { values, loaded } = useMessageExpirySettings(accountPubkey);
  const fallback = values?.get(DEFAULT_MESSAGE_EXPIRY_SLOT) ?? 0;
  const duration = conversationKey ? messageExpiryDuration(values, conversationKey, legacyDuration) : fallback;
  const title = t(conversationKey ? 'chat.disappearing.title' : 'chat.disappearing.default_title');
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [open, setOpen] = useState(false);
  const [editingCustom, setEditingCustom] = useState(false);
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<Unit>(UNITS[1]);
  const unitTrigger = useRef<View>(null);
  const [unitMenu, setUnitMenu] = useState<ContextMenuAnchor | null>(null);
  const closeUnitMenu = () => setUnitMenu(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const formatUnit = (entry: Unit) => new Intl.NumberFormat(locale, { style: 'unit', unit: entry.name, unitDisplay: 'long' });
  const unitLabel = (entry: Unit) => formatUnit(entry).formatToParts(1).find(part => part.type === 'unit')?.value ?? entry.name;
  function openUnitMenu() {
    unitTrigger.current?.measureInWindow((x, y, width, height) => {
      setUnitMenu({ x: direction === 'rtl' ? x : x + width, y: y + (Platform.OS === 'android' ? insets.top : 0), height });
    });
  }
  function formatDuration(seconds: number): string {
    if (seconds === 0) return t('chat.disappearing.off');
    const entry = durationParts(seconds);
    return formatUnit(entry).format(seconds / entry.seconds);
  }
  function startCustom() {
    const effectiveDuration = duration ?? fallback;
    const current = effectiveDuration > 0 ? effectiveDuration : 86400;
    const entry = durationParts(current);
    setUnit(entry);
    setAmount(String(current / entry.seconds));
    setError(false);
    setEditingCustom(true);
  }
  async function save(seconds: number | null) {
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      await setMessageExpirySetting(accountPubkey, conversationKey ?? null, seconds);
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  const customSeconds = Number(amount) * unit.seconds;
  const canSaveCustom = customSeconds > 0 && validExpiryDuration(customSeconds);
  function saveCustom() {
    if (canSaveCustom && !unitMenu) void save(customSeconds);
  }
  const hasPreset = duration === null || duration === 0 || DISAPPEARING_DURATIONS.some(seconds => seconds === duration);
  const showDefault = !!conversationKey && fallback > 0;
  const offValue = conversationKey && !showDefault && duration !== 0 ? null : 0;
  const defaultValue = t('chat.disappearing.use_default', { duration: formatDuration(fallback) });
  const options = [
    ...DISAPPEARING_DURATIONS.map(seconds => ({ seconds, title: formatDuration(seconds) })),
    { seconds: offValue, title: formatDuration(0) },
    ...(showDefault ? [{ seconds: null, title: defaultValue }] : []),
  ];
  return (
    <>
      <ListRow
        icon={<Timer size={22} color={c.text} />}
        title={title}
        value={duration === null && showDefault ? defaultValue : formatDuration(duration ?? 0)}
        trailing={<DirectionalChevron size={18} color={c.textMuted} />}
        onPress={loaded && !!accountPubkey && !disabled ? () => {
          setError(false);
          setEditingCustom(false);
          setOpen(true);
        } : undefined}
      />
      <BottomSheet visible={open} title={editingCustom ? t('chat.disappearing.custom') : title}
        onHeaderBack={editingCustom ? () => {
          if (saving) return;
          closeUnitMenu();
          setError(false);
          setEditingCustom(false);
        } : undefined}
        scrollResetKey={editingCustom ? 'custom' : 'presets'}
        onClose={unitMenu ? closeUnitMenu : () => setOpen(false)}
        modalOverlay={unitMenu && (
          <ContextMenuOverlay anchor={unitMenu} align={direction === 'rtl' ? 'start' : 'end'} placement="auto"
            density={IS_ELECTRON ? 'pointer' : 'touch'} onClose={closeUnitMenu}
            items={UNITS.map(entry => ({
              key: entry.name,
              title: unitLabel(entry),
              selected: unit === entry,
              icon: <RadioIndicator selected={unit === entry} />,
              onPress: () => setUnit(entry),
            }))}
          />
        )}
        contentStyle={{ gap: spacing.md }}>
        {editingCustom ? (
          <>
            <AppInput label={t('message_detail.duration')} value={amount}
              onChangeText={value => {
                const digits = value
                  .replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x0660))
                  .replace(/[\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) - 0x06f0));
                if (digits === '' || (!/\D/.test(digits) && Number(digits) > 0)) setAmount(digits);
              }}
              inputMode="numeric" keyboardType="number-pad" selectTextOnFocus returnKeyType="done"
              onSubmitEditing={saveCustom} editable={!saving}
              trailingAccessory={
                <View ref={unitTrigger} collapsable={false} style={{ width: '40%', alignSelf: 'center' }}>
                  <AppButton variant="secondary" minimumSize={uiDensity.inputHeight}
                    contentJustify="between" label={unitLabel(unit)} labelWeight="regular"
                    iconRight={<ChevronDown size={spacing.lg} color={c.textMuted} />}
                    accessibilityState={{ expanded: unitMenu !== null }}
                    disabled={saving} onPress={openUnitMenu} />
                </View>
              } />
            <AppButton label={t('common.save')} loading={saving} disabled={!canSaveCustom} onPress={saveCustom} />
          </>
        ) : (
          <>
            <AppText variant="caption" tone="muted">{t('chat.disappearing.hint')}</AppText>
            <ListGroup>
              {options.map(option => (
                <ListRow key={option.seconds ?? 'default'} title={option.title}
                  active={duration === option.seconds} selectionMode="single"
                  trailing={<RadioIndicator selected={duration === option.seconds} />}
                  onPress={saving ? undefined : () => void save(option.seconds)} />
              ))}
              <ListRow title={t('chat.disappearing.custom')} value={!hasPreset && duration !== null ? formatDuration(duration) : undefined}
                trailing={<DirectionalChevron size={18} color={c.textMuted} />}
                onPress={saving ? undefined : startCustom} />
            </ListGroup>
          </>
        )}
        {error ? <AppText tone="muted">{t('chat.disappearing.save_failed')}</AppText> : null}
      </BottomSheet>
    </>
  );
}
