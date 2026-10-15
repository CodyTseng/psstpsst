import { useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SigningDecisions } from './SigningDecisions';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { ContextMenu, ContextMenuOverlay, type ContextMenuAnchor } from '@/components/common/ContextMenu';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TFunction } from 'i18next';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Check from 'lucide-react-native/icons/check';
import { IS_ELECTRON } from '@/lib/platform';
import { canRememberSigning, SIGNING_PERIODS } from '@/services/napplet/signing-permissions';
import type { QueuedPrompt } from '@/services/napplet/prompt-queue';
import { nappletService } from '@/services/napplet/service';
import { SigningRequestDetails } from './SigningRequestDetails';
import { spacing, useThemeColors } from '@/theme';

export function SigningApproval({ prompt, value, onChange, hideActions = false }: {
  prompt: QueuedPrompt; value?: string; onChange?: (value: string) => void; hideActions?: boolean;
}) {
  const [selected, setSelected] = useState('allow');
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  const duration = value ?? selected;
  return (
    <View style={{ gap: spacing.lg }}>
      <SigningRequestDetails request={prompt.signing!} showTitle={!hideActions} />
      {!hideActions && anchor ? <SigningDurationMenu standalone anchor={anchor} duration={duration}
        onChange={onChange ?? setSelected} onClose={() => setAnchor(null)} /> : null}
      {!hideActions ? <SigningActions prompt={prompt} duration={duration}
        menuOpen={anchor !== null} onMenuChange={setAnchor} /> : null}
    </View>
  );
}

/** The selected duration applies equally to allowing and refusing the same scope. */
export function SigningActions({ prompt, duration, menuOpen, onMenuChange }: {
  prompt: QueuedPrompt; duration: string;
  menuOpen: boolean; onMenuChange: (anchor: ContextMenuAnchor | null) => void;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const trigger = useRef<View>(null);
  const insets = useSafeAreaInsets();
  const remember = canRememberSigning(prompt.signing!);
  const timed = duration.startsWith('allow-') && Object.prototype.hasOwnProperty.call(SIGNING_PERIODS, duration.slice(6));
  const mode = duration === 'allow-always' ? 'always' : timed ? 'timed' : 'once';
  const decision = remember && (mode === 'always' || timed) ? duration : 'allow';
  const reject = decision === 'allow' ? false : decision.replace(/^allow-/, 'deny-');
  const options = durationOptions(t);
  return <View style={{ gap: spacing.md }}>
    {remember ? <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
        <AppText variant="caption" tone="muted" style={{ flex: 1 }}>{t('napplets.signing_remember')}</AppText>
        <View ref={trigger} collapsable={false}><AppButton variant="secondary" size="sm" fullWidth={false}
          label={options.find((option) => option.value === decision)!.label}
          accessibilityState={{ expanded: menuOpen }}
          iconRight={<ChevronDown size={spacing.lg} color={c.text} />}
          onPress={() => {
            if (menuOpen) { onMenuChange(null); return; }
            trigger.current?.measureInWindow((x, y, width) => onMenuChange({
              x: x + width, y: y + (Platform.OS === 'android' ? insets.top : 0) - spacing.xs,
            }));
          }} /></View>
      </View>
    </> : <AppText variant="caption" tone="muted">{t('napplets.signing_unknown_notice')}</AppText>}
    <SigningDecisions key={`${prompt.requestId}:${prompt.expiresAt}`} expiresAt={prompt.expiresAt}
      onApprove={() => nappletService.answer(prompt.requestId, decision)}
      onReject={() => nappletService.answer(prompt.requestId, reject)} />
  </View>;
}

function durationOptions(t: TFunction) {
  return [
    { value: 'allow', label: t('napplets.signing_duration_once') },
    ...Object.keys(SIGNING_PERIODS).map((period) => ({
      value: `allow-${period}`, label: t(`napplets.signing_period_${period}`),
    })),
    { value: 'allow-always', label: t('napplets.signing_duration_always') },
  ];
}

export function SigningDurationMenu({ anchor, duration, onChange, onClose, standalone = false }: {
  standalone?: boolean; anchor: ContextMenuAnchor; duration: string; onChange: (value: string) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const Menu = standalone ? ContextMenu : ContextMenuOverlay;
  return <Menu anchor={anchor} align="end" placement="above"
    density={IS_ELECTRON ? 'pointer' : 'touch'} onClose={onClose}
    items={durationOptions(t).map((option) => ({
      key: option.value, title: option.label, selected: option.value === duration,
      icon: <Check size={spacing.lg} color={option.value === duration ? c.accent : 'transparent'} />,
      onPress: () => onChange(option.value),
    }))} />;
}
