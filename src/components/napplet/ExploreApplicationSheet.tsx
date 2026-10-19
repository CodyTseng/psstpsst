import { platform } from '@/platform';
import { useRef } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '@/components/common/BottomSheet';
import { NappletPanelActions } from './NappletPanel';
import { SigningAccountAvatar } from './SigningRequestDetails';
import { exploreService } from '@/services/explore/service';
import { applicationPresentation,type ExploreEntry } from '@/services/explore/model';
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
    contentStyle={{gap:spacing.lg}}
    fixedFooter={page==='about'?<NappletPanelActions onAction={action=>{
      if(action==='settings')onPageChange('settings');
      else if(action==='share')schedule(()=>share(entry));
      else schedule(()=>exploreService.reload(runId));
    }}/>:undefined}>
    <ApplicationPanel application={applicationPresentation(entry)} page={page??'about'}
      settings={<ApplicationSettings access={entry.required.length?<ApplicationAccessControls required={entry.required} selected={entry.required}/>:undefined} sourceId={sourceId} onReset={async()=>{await exploreService.reset(entry,account);close();}}/>}
      onPublisher={()=>{if(entry.manifest)schedule(()=>{if(platform.napplet.windows?.isHost)void platform.napplet.windows.action({type:'profile',pubkey:entry.manifest!.pubkey});else router.push(`/profile/${entry.manifest!.pubkey}`);});}}/>
  </BottomSheet>;
}
