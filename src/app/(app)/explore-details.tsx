import { useOpenPublisher } from '@/hooks/use-open-publisher';
import { useExploreShare } from '@/hooks/use-explore-share';
import { platform } from '@/platform';
import { openApplicationWindow } from '@/services/explore/windows';
import { usePublisherApplications } from '@/stores/explore-publisher.store';
import { useDiscovery } from '@/stores/explore-discovery.store';
import { useNappletAccess } from '@/hooks/use-napplet-access';
import { nappletService } from '@/services/napplet/service';
import { NAP_DOMAINS } from '@/services/napplet/protocol';
import { useEffect, useState } from 'react';
import { router,useLocalSearchParams } from 'expo-router';
import { ApplicationDetailsPage } from '@/components/napplet/ApplicationDetailsPage';
import { ApplicationPermissionsPage } from '@/components/napplet/ApplicationPermissionsPage';
import { ApplicationSettings } from '@/components/napplet/ApplicationSettings';
import { ApplicationAccessControls } from '@/components/napplet/ApplicationAccessControls';
import { useExplore } from '@/stores/explore.store';
import { useExploreAccess } from '@/hooks/use-explore-access';
import { applicationPresentation } from '@/services/explore/model';
import { exploreService,SUPPORTED_NAPP_DOMAINS } from '@/services/explore/service';

export default function ExploreDetailsScreen() {
  const {key,permissions,catalog,publisher}=useLocalSearchParams<{key:string;permissions?:string;catalog?:string;publisher?:string}>();
  const openPublisher=useOpenPublisher();
  const publisherApps=usePublisherApplications(publisher);
  const state=useExplore();
  const share=useExploreShare(state.account);
  const loadPublisher=publisherApps.load;
  useEffect(()=>{if(state.account&&loadPublisher)void loadPublisher(state.account);},[state.account,loadPublisher]);
  const discovery=useDiscovery();
  const discovered=publisherApps.entries.find(entry=>entry.key===key)??(discovery.addressCache.account===state.account?discovery.addressCache.entries.find(entry=>entry.key===key):undefined)??discovery.entries.find(entry=>entry.key===key);
  const app=(catalog==='1'?discovered:undefined)??state.entries.find(entry=>entry.key===key)??(state.entry?.key===key?state.entry:undefined)??discovered;
  const genericAccess=useExploreAccess(app?.release?undefined:app,state.account,state.accessRevision);
  const nappletAccess=useNappletAccess(app?.release,state.account);
  const access=app?.release?nappletAccess:genericAccess;
  const [error,setError]=useState<string>();
  const application=app?applicationPresentation(app):undefined;
  const required = application?.required ?? [];
  const publisherPending=!!loadPublisher&&!publisherApps.loaded&&!publisherApps.error;
  const message=error??access.error??(!app&&publisherApps.error?'napplets.request_failed':state.loaded&&!app&&!publisherPending?'napplets.not_found':undefined);
  if(permissions==='1')return <ApplicationPermissionsPage application={application} error={message}>
    {app&&state.account?<ApplicationSettings access={required.length?<ApplicationAccessControls required={required} selected={required}/>:undefined} sourceId={exploreService.signingSource(app)} onReset={()=>exploreService.reset(app,state.account!)}/>:null}
  </ApplicationPermissionsPage>;
  return <ApplicationDetailsPage application={application} access={access} error={message}
    actions={app?{entry:app,onShare:state.account?()=>share(app):undefined}:undefined}
    discussion={app&&state.account?{entry:app,account:state.account}:undefined}
    unsupported={app?.release?app.required.some(domain=>!(NAP_DOMAINS as readonly string[]).includes(domain)):app?.kind==='napp'&&app.required.some(domain=>!SUPPORTED_NAPP_DOMAINS.includes(domain))}
    onPublisher={()=>{if(app?.manifest)openPublisher(app.manifest.pubkey);}}
    onOpen={()=>{
      if(!app||!state.account)return;
      try {
        if (platform.napplet.windows || platform.napplet.tasks) {
          const reviewed = access.approved ? undefined : app.release ? [...new Set(['shell', ...app.required])] : required;
          void openApplicationWindow(app, state.account, reviewed).catch(() => setError('napplets.request_failed'));
          return;
        }
        if(app.release) {
          const runId=nappletService.prepareOpen(app.release,state.account,access.approved?undefined:[...new Set(['shell',...app.required])]);
          router.push({pathname:'/napplet-run',params:{runId}});
          return;
        }
        const runId=exploreService.prepare(app,state.account,access.approved?undefined:required);
        router.push({pathname:'/explore-run',params:{runId}});
      } catch {setError('napplets.request_failed');}
    }}/>;
}
