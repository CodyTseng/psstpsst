import { useTranslation } from 'react-i18next';
import { ActionRow } from '@/components/common/ActionRow';

/** Approval decisions remain available until the user acts or the request is cancelled. */
export function SigningDecisions({ onApprove, onReject }: {
  onApprove: () => void; onReject: () => void;
}) {
  const { t } = useTranslation();
  return <ActionRow layout="horizontal"
    confirm={{ label: t('applications.signing_approve'), onPress: onApprove }}
    dismiss={{ label: t('applications.signing_reject'), onPress: onReject }} />;
}
