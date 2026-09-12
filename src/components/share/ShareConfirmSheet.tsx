import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions } from 'react-native';

import { ActionRow } from '@/components/common/ActionRow';
import { BottomSheet } from '@/components/common/BottomSheet';
import { RecipientSummary } from '@/components/share/SelectedRecipientsRow';
import type { ShareTarget } from '@/lib/share/share-target';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Intent-specific content rendered with the app's real outgoing bubbles. */
  preview: ReactNode;
  /** Chosen conversations shown above the preview and used by the Send label. */
  recipients: ShareTarget[];
  sending: boolean;
  onConfirm: () => void;
};

/**
 * Share/forward confirm: rises after the recipients are picked and **Send** is
 * tapped. The preview hugs short payloads and grows only until its height cap;
 * longer payloads scroll, followed by one pinned Send action.
 *
 * The shared BottomSheet owns the Modal, enter/exit animation, fixed footer
 * gesture, and the preview's single drag-coordinated ScrollView.
 */
export function ShareConfirmSheet({
  visible,
  onClose,
  preview,
  recipients,
  sending,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();

  // A max height, not a fixed height: one short bubble should make a compact
  // confirmation sheet, while a large batch still gets a bounded scroll area.
  const previewMaxHeight = Math.min(height * 0.42, 360);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('share.title')}
      fixedSubheader={<RecipientSummary label={t('share.send_to')} targets={recipients} />}
      fixedFooter={
        <ActionRow
          layout="vertical"
          confirm={{
            label: t('share.send_to_count', { count: recipients.length }),
            loading: sending,
            onPress: onConfirm,
          }}
        />
      }
      scrollStyle={{ maxHeight: previewMaxHeight }}
      contentStyle={{ paddingHorizontal: 0 }}
    >
      {preview}
    </BottomSheet>
  );
}
