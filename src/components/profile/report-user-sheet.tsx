import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ActionRow } from '@/components/common/ActionRow';
import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { ListRow } from '@/components/common/ListRow';
import { RadioIndicator } from '@/components/common/radio-indicator';
import {
  PROFILE_REPORT_TYPES,
  reportUser,
  type ProfileReportType,
} from '@/services/nostr/report.service';
import { showToast } from '@/stores/toast.store';
import { spacing } from '@/theme';

type Props = {
  visible: boolean;
  accountPubkey: string;
  reportedPubkey: string;
  onClose: () => void;
};

/** Select and publish one public NIP-56 profile report. */
export function ReportUserSheet({
  visible,
  accountPubkey,
  reportedPubkey,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [type, setType] = useState<ProfileReportType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const successToastPendingRef = useRef(false);

  function close() {
    onClose();
  }

  function handleClosed() {
    setType(null);
    if (!successToastPendingRef.current) return;
    successToastPendingRef.current = false;
    showToast(t('report.success'));
  }

  async function submit() {
    if (!type || submitting) return;
    setSubmitting(true);
    try {
      await reportUser({ accountPubkey, reportedPubkey, type });
      successToastPendingRef.current = true;
      close();
    } catch {
      showToast(t('report.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      onClosed={handleClosed}
      title={t('report.title')}
      contentStyle={{ gap: spacing.lg }}
      fixedFooter={
        <ActionRow
          layout="vertical"
          confirm={{
            label: t('report.submit'),
            loading: submitting,
            disabled: type === null,
            onPress: submit,
          }}
        />
      }
    >
      <AppText variant="body" tone="muted">
        {t('report.description')}
      </AppText>
      <View accessibilityRole="radiogroup">
        {PROFILE_REPORT_TYPES.map((reportType) => {
          const selected = reportType === type;
          return (
            <ListRow
              key={reportType}
              variant="plain"
              title={t(`report.types.${reportType}`)}
              active={selected}
              selectionMode="single"
              trailing={<RadioIndicator selected={selected} />}
              disabled={submitting}
              onPress={() => setType(reportType)}
            />
          );
        })}
      </View>
    </BottomSheet>
  );
}
