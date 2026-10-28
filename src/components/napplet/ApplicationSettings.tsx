import { useErrorToast } from '@/hooks/use-error-toast';
import { Fragment,useState,type ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppButton } from '@/components/common/AppButton';
import { BrowserPermissions } from './BrowserPermissions';
import { normalizeSigningSource } from '@/services/signing/source';
import { NappletPermissions } from './NappletPermissions';
import type { NappletRelease } from '@/services/napplet/protocol';
import { platform } from '@/platform';
import { spacing } from '@/theme';

/** Shared signing controls and reset flow; capability-specific controls are an optional slot. */
export function ApplicationSettings({accountPubkey,release,sourceId,access,onReset,onUninstall}:{
  accountPubkey:string;release?:NappletRelease;sourceId?:string;access?:ReactNode;onReset():Promise<void>;onUninstall?():Promise<void>;
}) {
  const {t}=useTranslation();
  const [busy,setBusy]=useState(false),[error,setError]=useState(false),[revision,setRevision]=useState(0);
  useErrorToast(error && 'applications.request_failed');
  async function reset() {
    if(busy)return;
    setBusy(true);setError(false);
    try {
      if(!await platform.confirmationDialog.confirm({title:t('applications.revoke'),message:t('applications.revoke_notice'),confirmLabel:t('common.reset'),cancelLabel:t('common.cancel'),destructive:true}))return;
      await onReset();setRevision(value=>value+1);
    } catch {setError(true);} finally {setBusy(false);}
  }
  return <View style={{gap:spacing.xl}}>
    {access?<Fragment key={`access:${revision}`}>{access}</Fragment>:null}
    <NappletPermissions accountPubkey={accountPubkey} key={`signing:${revision}`} release={release} sourceId={sourceId} initiallyExpanded/>
    {sourceId || release ? <BrowserPermissions accountPubkey={accountPubkey} key={`browser:${revision}`} sourceId={sourceId ?? normalizeSigningSource(release!.eventKey)} /> : null}
    <AppButton variant="danger" label={t('applications.revoke')} loading={busy} onPress={()=>{void reset();}}/>
    {onUninstall ? <AppButton variant="danger" label={t('applications.local_uninstall')} disabled={busy} onPress={()=>{void (async()=>{
      if (!await platform.confirmationDialog.confirm({title:t('applications.local_uninstall'),message:t('applications.local_uninstall_notice'),confirmLabel:t('common.remove'),cancelLabel:t('common.cancel'),destructive:true})) return;
      setBusy(true); try { await onUninstall(); } catch {setError(true);} finally {setBusy(false);}
    })();}}/> : null}
  </View>;
}
