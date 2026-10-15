import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionRow } from '@/components/common/ActionRow';

/** Only the two decision buttons rerender on ticks; the queue owns expiration and cancellation. */
export function SigningDecisions({ expiresAt, onApprove, onReject }: {
  expiresAt: number; onApprove: () => void; onReject: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  const { t } = useTranslation();
  useEffect(() => {
    if (expiresAt <= Date.now()) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= expiresAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return <ActionRow layout="horizontal"
    confirm={{ label: t('napplets.signing_approve'), onPress: onApprove }}
    dismiss={{ label: t('napplets.signing_reject_countdown', { seconds }), onPress: onReject }} />;
}
