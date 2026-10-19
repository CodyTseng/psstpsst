import { platform } from '@/platform';
import { openApplicationWindow } from '@/services/explore/windows';
import { useState } from 'react';
import { router,useLocalSearchParams } from 'expo-router';
import { ApplicationDetailsPage } from '@/components/napplet/ApplicationDetailsPage';
import { useNappletAccess } from '@/hooks/use-napplet-access';
import { useNappletRelease } from '@/hooks/use-napplet-release';
import { NAP_DOMAINS } from '@/services/napplet/protocol';
import { nappletService } from '@/services/napplet/service';
import { fromNapplet, applicationPresentation } from '@/services/explore/model';

export default function NappletDetailScreen() {
  const {id}=useLocalSearchParams<{id:string}>();
  const {release,accountPubkey,error:loadError}=useNappletRelease(id);
  const access=useNappletAccess(release,accountPubkey);
  const [error,setError]=useState<string>();
  return <ApplicationDetailsPage application={release?applicationPresentation(release):undefined}
    access={access} error={error??loadError??access.error}
    unsupported={release?.required.some(domain=>!(NAP_DOMAINS as readonly string[]).includes(domain))}
    onPublisher={()=>{if(release)router.push(`/profile/${release.event.pubkey}`);}}
    onOpen={()=>{
      if(!release)return;
      try {
        if (platform.napplet.windows) {
          void openApplicationWindow(fromNapplet(release), accountPubkey ?? '', access.approved ? undefined : [...new Set(['shell', ...release.required])]).catch(() => setError('napplets.request_failed'));
          return;
        }
        const runId=nappletService.prepareOpen(release,accountPubkey??'',access.approved?undefined:[...new Set(['shell',...release.required])]);
        router.push({pathname:'/napplet-run',params:{runId}});
      } catch {setError('napplets.request_failed');}
    }}/>;
}
