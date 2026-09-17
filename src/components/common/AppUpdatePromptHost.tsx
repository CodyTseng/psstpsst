import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { IS_ELECTRON } from '@/lib/platform';
import { platform, type AppUpdateStatus } from '@/platform';
import { registerAppUpdateCheck } from '@/services/app-update';
import { showToast } from '@/stores/toast.store';

/**
 * Presents the two explicit decisions in the Electron update flow: download,
 * then restart and install. Automatic prompts do not repeat declined actions
 * in the same session; manual checks can reopen them. The main process never
 * installs a downloaded update on quit.
 */
export function AppUpdatePromptHost() {
  const { t } = useTranslation();
  const prompted = useRef(new Set<string>());
  const busy = useRef(false);

  useEffect(() => {
    if (!IS_ELECTRON) return;
    let active = true;

    const promptToInstall = async (version: string) => {
      const key = `install:${version}`;
      if (!active || prompted.current.has(key)) return;
      prompted.current.add(key);
      const confirmed = await platform.confirmationDialog.confirm({
        title: t('app_update.ready_title'),
        message: t('app_update.ready_message', { version }),
        cancelLabel: t('app_update.later'),
        confirmLabel: t('app_update.restart_and_install'),
        actionLayout: 'vertical',
      });
      if (!active || !confirmed) return;
      try {
        await platform.appUpdate.install();
      } catch {
        if (!active) return;
        await platform.confirmationDialog.notify({
          title: t('app_update.install_failed_title'),
          message: t('app_update.install_failed_message'),
          okLabel: t('common.ok'),
        });
      }
    };

    const handleStatus = async (status: AppUpdateStatus) => {
      if (!active || busy.current) return;
      if (status.state !== 'available' && status.state !== 'downloaded') return;

      const key = `${status.state}:${status.version}`;
      if (prompted.current.has(key)) return;
      prompted.current.add(key);
      busy.current = true;
      try {
        if (status.state === 'downloaded') {
          await promptToInstall(status.version);
          return;
        }

        const confirmed = await platform.confirmationDialog.confirm({
          title: t('app_update.available_title'),
          message: t('app_update.available_message', { version: status.version }),
          cancelLabel: t('app_update.not_now'),
          confirmLabel: t('app_update.download'),
        });
        if (!active || !confirmed) return;

        showToast(t('app_update.downloading', { version: status.version }));
        try {
          await platform.appUpdate.download();
        } catch {
          if (!active) return;
          await platform.confirmationDialog.notify({
            title: t('app_update.download_failed_title'),
            message: t('app_update.download_failed_message'),
            okLabel: t('common.ok'),
          });
          return;
        }

        if (!active) return;
        const current = await platform.appUpdate.getStatus();
        if (current.state === 'downloaded') await promptToInstall(current.version);
      } finally {
        busy.current = false;
      }
    };

    const removeManualCheck = registerAppUpdateCheck(async () => {
      if (busy.current) {
        showToast(t('app_update.busy'));
        return;
      }
      busy.current = true;
      let current: AppUpdateStatus;
      try {
        current = await platform.appUpdate.check();
      } catch {
        if (active) await platform.confirmationDialog.notify({
          title: t('app_update.check_failed'),
          okLabel: t('common.ok'),
        });
        return;
      } finally {
        busy.current = false;
      }
      if (!active) return;
      if (current.state === 'idle') {
        showToast(t('app_update.up_to_date'));
      } else if (current.state === 'available' || current.state === 'downloaded') {
        prompted.current.delete(`${current.state}:${current.version}`);
        prompted.current.delete(`install:${current.version}`);
        await handleStatus(current);
      } else {
        showToast(t('app_update.busy'));
      }
    });
    const remove = platform.appUpdate.addStatusListener((status) => void handleStatus(status));
    void platform.appUpdate.getStatus().then(handleStatus).catch(() => {});
    return () => {
      active = false;
      remove();
      removeManualCheck();
    };
  }, [t]);

  return null;
}
