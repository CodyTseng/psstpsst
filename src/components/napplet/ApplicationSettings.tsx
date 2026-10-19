import { useState,type ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { BrowserPermissions } from './BrowserPermissions';
import { signingSourceFromLegacyKey } from '@/services/signing/source';
import { NappletPermissions } from './NappletPermissions';
import type { NappletRelease } from '@/services/napplet/protocol';
import { platform } from '@/platform';
import { spacing } from '@/theme';

/** Shared signing controls and reset flow; capability-specific controls are an optional slot. */
export function ApplicationSettings({release,sourceId,access,onReset}:{
  release?:NappletRelease;sourceId?:string;access?:ReactNode;onReset():Promise<void>;
}) {
  const {t}=useTranslation();
  const [busy,setBusy]=useState(false),[error,setError]=useState(false),[revision,setRevision]=useState(0);
  async function reset() {
    if(busy)return;
    setBusy(true);setError(false);
    try {
      if(!await platform.confirmationDialog.confirm({title:t('napplets.revoke'),message:t('napplets.revoke_notice'),confirmLabel:t('common.reset'),cancelLabel:t('common.cancel'),destructive:true}))return;
      await onReset();setRevision(value=>value+1);
    } catch {setError(true);} finally {setBusy(false);}
  }
  return <View style={{gap:spacing.xl}}>
    <NappletPermissions key={`signing:${revision}`} release={release} sourceId={sourceId} initiallyExpanded/>
    {sourceId || release ? <BrowserPermissions key={`browser:${revision}`} sourceId={sourceId ?? signingSourceFromLegacyKey(release!.key)} /> : null}
    {access?<View key={`access:${revision}`}>{access}</View>:null}
    <AppButton variant="danger" label={t('napplets.revoke')} loading={busy} onPress={()=>{void reset();}}/>
    {error?<AppText tone="danger">{t('napplets.request_failed')}</AppText>:null}
  </View>;
}
