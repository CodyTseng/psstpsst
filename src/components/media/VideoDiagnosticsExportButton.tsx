import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { platform } from '@/platform';
import {
  APP_ERROR_DIAGNOSTICS_FILENAME,
  exportAppErrorDiagnostics,
} from '@/services/diagnostics/app-error-diagnostics.service';

export function VideoDiagnosticsExportButton({ size }: { size?: 'sm' | 'md' }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  async function saveDiagnostics() {
    if (busy) return;
    setBusy(true);
    try {
      const uri = await exportAppErrorDiagnostics();
      if (!uri) throw new Error('Diagnostics export unavailable');
      await platform.fileSaver.save(uri, {
        suggestedName: APP_ERROR_DIAGNOSTICS_FILENAME,
        mimeType: 'application/json',
      });
    } catch {
      void platform.confirmationDialog.notify({
        title: t('backup.export_failed'),
        okLabel: t('common.ok'),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ maxWidth: '100%' }}>
      <AppButton
        variant="secondary"
        size={size}
        label={t('error.export_diagnostics')}
        loading={busy}
        onPress={() => void saveDiagnostics()}
      />
    </View>
  );
}
