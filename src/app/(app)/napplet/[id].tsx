import { useOpenPublisher } from '@/hooks/use-open-publisher';
import { useExploreShare } from '@/hooks/use-explore-share';
import { tryOpenApplicationWindow } from '@/services/explore/windows';
import { useMemo, useState } from 'react';
import { router,useLocalSearchParams } from 'expo-router';
import { ApplicationDetailsPage } from '@/components/napplet/ApplicationDetailsPage';
import { useNappletAccess } from '@/hooks/use-napplet-access';
import { useNappletRelease } from '@/hooks/use-napplet-release';
import { NAP_DOMAINS } from '@/services/napplet/protocol';
import { nappletService } from '@/services/napplet/service';
import { fromNapplet, applicationPresentation } from '@/services/explore/model';

export default function NappletDetailScreen() {
  const openPublisher=useOpenPublisher();
  const {id}=useLocalSearchParams<{id:string}>();
  const {release,accountPubkey,error:loadError}=useNappletRelease(id);
  const share=useExploreShare(accountPubkey??null);
  const entry=useMemo(()=>release?fromNapplet(release):undefined,[release]);
  const access=useNappletAccess(release,accountPubkey);
  const [error,setError]=useState<string>();
  return <ApplicationDetailsPage application={release?applicationPresentation(release):undefined}
    actions={entry?{entry,account:accountPubkey,onShare:accountPubkey?()=>share(entry):undefined}:undefined}
    discussion={entry&&accountPubkey?{entry,account:accountPubkey}:undefined}
    access={access} error={error??loadError??access.error}
    unsupported={release?.required.filter(domain=>!(NAP_DOMAINS as readonly string[]).includes(domain))}
    onPublisher={()=>{if(release)openPublisher(release.event.pubkey);}}
    onOpen={async()=>{
      if(!release)return;
      try {
        if (await tryOpenApplicationWindow(fromNapplet(release), accountPubkey ?? '', access.approved ? undefined : [...new Set(['shell', ...release.required])])) return;
        const runId=nappletService.prepareOpen(release,accountPubkey??'',access.approved?undefined:[...new Set(['shell',...release.required])]);
        router.push({pathname:'/napplet-run',params:{runId}});
      } catch {setError('napplets.request_failed');}
    }}/>;
}
