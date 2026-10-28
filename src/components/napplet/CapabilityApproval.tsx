import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { NappletRequiredAccess } from './NappletRequiredAccess';
import { AppText } from '@/components/common/AppText';
import { AppCard } from '@/components/common/AppCard';
import { ActionRow } from '@/components/common/ActionRow';
import type { QueuedPrompt } from '@/services/napplet/prompt-queue';
import { nappletService } from '@/services/napplet/service';
import { PermissionActions, SigningDurationMenu } from './SigningApproval';
import type { ContextMenuAnchor } from '@/components/common/ContextMenu';
import { rememberBrowserPermission, browserPermissionLabel } from '@/services/explore/browser-permissions';
import { spacing } from '@/theme';

export function CapabilityActions({ prompt, duration = 'allow', menuOpen = false, onMenuChange = () => {} }: {
  prompt: QueuedPrompt; duration?: string; menuOpen?: boolean; onMenuChange?: (anchor: ContextMenuAnchor | null) => void;
}) {
  const { t } = useTranslation();
  if (prompt.capabilities?.requested) return <ActionRow layout="horizontal"
    confirm={{ label: t('applications.allow'), onPress: () => nappletService.answer(prompt.requestId, 'allow') }}
    dismiss={{ label: t('applications.signing_reject'), onPress: () => nappletService.answer(prompt.requestId, 'deny') }} />;
  if (prompt.browser?.action === 'permission' && rememberBrowserPermission(prompt.browser.resources ?? []))
    return <PermissionActions prompt={prompt} duration={duration} menuOpen={menuOpen} onMenuChange={onMenuChange}
      remember label={t('applications.signing_remember')} />;
  return <ActionRow layout="horizontal"
    confirm={{ label: t('applications.allow'), onPress: () => nappletService.answer(prompt.requestId, prompt.capabilities ? 'domains:[]' : 'allow') }}
    dismiss={{ label: t('common.cancel'), onPress: () => nappletService.answer(prompt.requestId, false) }} />;
}

/** Approval content describes this request, independently of application marketing metadata. */
export function CapabilityApproval({ prompt, hideActions = false }: { prompt: QueuedPrompt; hideActions?: boolean }) {
  const { t } = useTranslation();
  const [duration, setDuration] = useState('allow');
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  const browser = prompt.browser;
  const required = prompt.capabilities?.required ?? prompt.application?.required ?? prompt.app?.required ?? [];
  return <View style={{ gap: spacing.lg }}>
    {prompt.installation ? <>
      <AppText>{t(prompt.installation.replacing ? 'applications.local_replace_notice' : 'applications.local_install_notice')}</AppText>
      <AppCard variant="muted" style={{ gap: spacing.md }}>
        <AppText variant="subtitle">{prompt.installation.target.title}</AppText>
        <AppText variant="code">{prompt.installation.id}</AppText>
        <AppText variant="caption" tone="muted">{t('applications.local_unsigned_notice')}</AppText>
        {prompt.installation.otherInstaller ? <AppText tone="danger">{t('applications.local_other_installer_notice')}</AppText> : null}
      </AppCard>
      <NappletRequiredAccess release={{ required: prompt.installation.target.required }} />
    </> : browser ? <AppCard variant="muted" style={{ gap: spacing.md }}>
      {browser.action === 'permission' ? <>
        {browser.resources?.length ? [...new Set(browser.resources)].map(resource =>
          <AppText key={resource} variant="body">{browserPermissionLabel(resource, t)}</AppText>)
          : <AppText variant="body">{prompt.detail || t('applications.browser_permission')}</AppText>}
      </> : <AppText variant="body">{t(`applications.browser_${browser.action}`)}</AppText>}
      {browser.filename ? <AppText>{browser.filename}</AppText> : null}
      {browser.url ? <>
        <AppText variant="caption" tone="muted">{t('applications.signing_destinations')}</AppText>
        <AppText variant="caption">{browser.url}</AppText>
      </> : null}
    </AppCard> : prompt.device ? <>
      <AppText>{t(prompt.device.operation === 'save-file' ? 'applications.save_file_notice' : 'applications.copy_text_notice')}</AppText>
      <AppCard variant="muted"><AppText variant="code">{prompt.detail}</AppText></AppCard>
    </> : prompt.crypto ? <>
      <AppText>{t(prompt.crypto.operation === 'encrypt' ? 'applications.crypto_encrypt_notice' : 'applications.crypto_decrypt_notice')}</AppText>
      <AppCard variant="muted" style={{ gap: spacing.md }}>
        <AppText variant="body">{prompt.crypto.algorithm === 'nip04' ? 'NIP-04' : 'NIP-44'}</AppText>
      </AppCard>
    </> : <>
      <NappletRequiredAccess release={{ required }} showHeading={false} />
    </>}
    {!hideActions && anchor ? <SigningDurationMenu standalone anchor={anchor} duration={duration} onChange={setDuration} onClose={() => setAnchor(null)} /> : null}
    {!hideActions ? <CapabilityActions prompt={prompt} duration={duration} menuOpen={anchor !== null} onMenuChange={setAnchor} /> : null}
  </View>;
}
