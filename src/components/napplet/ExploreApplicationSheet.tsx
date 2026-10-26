import { useOpenPublisher } from '@/hooks/use-open-publisher';
import { platform } from '@/platform';
import { useRef } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '@/components/common/BottomSheet';
import { AppButton } from '@/components/common/AppButton';
import { showToast } from '@/stores/toast.store';
import { NappletPanelActions } from './NappletPanel';
import { SigningAccountAvatar } from './SigningRequestDetails';
import { exploreService } from '@/services/explore/service';
import { applicationPresentation,type ExploreEntry } from '@/services/explore/model';
import { ApplicationOpenSetting } from './ApplicationOpenSetting';
import { ApplicationPanel } from './ApplicationPanel';
import { ApplicationSettings } from './ApplicationSettings';
import { ApplicationAccessControls } from './ApplicationAccessControls';
import { useExploreShare } from '@/hooks/use-explore-share';
import { contentWidth, spacing } from '@/theme';

export function ExploreApplicationSheet({ entry, account, runId, page, onPageChange }: {
  entry: ExploreEntry; account: string; runId: number; page: 'about'|'settings'|null;
  onPageChange(page: 'about'|'settings'|null): void;
}) {
  const {t}=useTranslation();
  const openPublisher=useOpenPublisher();
  const share=useExploreShare(account);
  const pending=useRef<(()=>void)|null>(null);
  const close=()=>onPageChange(null);
  const schedule=(action:()=>void)=>{pending.current=()=>{if(exploreService.isCurrentRun(account,runId))action();};close();};
  const sourceId=exploreService.signingSource(entry);
  return <BottomSheet visible={page!==null} onClose={close}
    onClosed={()=>{const action=pending.current;pending.current=null;action?.();}}
    title={t(page==='settings'?'napplets.permissions_manage':'napplets.details')}
    headerAction={page==='settings'?<SigningAccountAvatar pubkey={account}/>:undefined}
    scrollResetKey={page??'closed'} maxWidth={contentWidth.focused}
    fixedFooter={page==='about'?<NappletPanelActions entry={entry} account={account}
      onOpenExternal={entry.kind === 'website' ? () => schedule(() => {
        void platform.urlOpener.openExternalUrl(entry.address)
          .then(opened => { if (!opened) showToast(t('napplets.request_failed'), { variant: 'error' }); })
          .catch(() => showToast(t('napplets.request_failed'), { variant: 'error' }));
      }) : undefined}
      onAction={action=>{
      if(action==='settings')onPageChange('settings');
      else if(action==='share')schedule(()=>share(entry));
      else schedule(()=>exploreService.reload(runId));
    }}/>:undefined}>
    <ApplicationPanel application={applicationPresentation(entry)} page={page??'about'}
      settings={<ApplicationSettings access={entry.required.length ? <View style={{ gap: spacing.lg }}>
        <ApplicationAccessControls required={entry.required} selected={entry.required}/>
        {entry.kind === 'napp' && entry.required.includes('config') ? <AppButton variant="secondary" label={t('napplets.settings')}
          onPress={() => schedule(() => { void exploreService.configure(runId).catch(() => showToast(t('napplets.request_failed'), { variant: 'error' })); })}/> : null}
      </View> : undefined} sourceId={sourceId} onReset={async()=>{await exploreService.reset(entry,account);close();}}/>}
      onPublisher={()=>{if(entry.manifest)schedule(()=>openPublisher(entry.manifest!.pubkey));}}/>
    {page === 'about' ? <ApplicationOpenSetting entry={entry} account={account} /> : null}
  </BottomSheet>;
}
