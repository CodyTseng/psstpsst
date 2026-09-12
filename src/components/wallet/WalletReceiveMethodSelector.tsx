import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Check from 'lucide-react-native/icons/check';
import { Bolt } from '@solar-icons/react-native/category/ui/Linear/Bolt';
import { Wallet } from '@solar-icons/react-native/category/money/Linear/Wallet';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { BottomSheet } from '@/components/common/BottomSheet';
import { ListRow } from '@/components/common/ListRow';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

export type WalletReceiveMethodOption = {
  id: string;
  kind: 'wallet' | 'profile';
  label: string;
};

type Props = {
  options: WalletReceiveMethodOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function WalletReceiveMethodSelector({ options, selectedId, onSelect }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.id === selectedId) ?? options[0] ?? null;

  if (!selectedOption) return null;

  const canSelect = options.length > 1;

  return (
    <>
      <ListRow
        variant="plain"
        title={t('wallet.receive_method')}
        value={selectedOption.label}
        icon={
          selectedOption.kind === 'wallet' ? (
            <Wallet size={22} color={c.text} />
          ) : (
            <Bolt size={22} color={c.text} />
          )
        }
        trailing={canSelect ? <ChevronDown strokeWidth={iconStrokeWidth.default} size={18} color={c.textMuted} /> : null}
        onPress={canSelect ? () => setOpen(true) : undefined}
      />

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={t('wallet.select_receive_method')}
        contentStyle={{ gap: spacing.xl }}
      >
        <View>
          {options.map((option) => {
            const selected = option.id === selectedOption.id;
            return (
              <ListRow
                key={option.id}
                variant="plain"
                title={option.label}
                subtitle={
                  option.kind === 'wallet'
                    ? t('wallet.title')
                    : t('wallet.profile_lightning_address')
                }
                titleTone={selected ? 'accent' : 'default'}
                icon={
                  option.kind === 'wallet' ? (
                    <Wallet size={22} color={selected ? c.accent : c.text} />
                  ) : (
                    <Bolt size={22} color={selected ? c.accent : c.text} />
                  )
                }
                trailing={selected ? <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.accent} /> : null}
                onPress={() => {
                  onSelect(option.id);
                  setOpen(false);
                }}
              />
            );
          })}
        </View>
      </BottomSheet>
    </>
  );
}
