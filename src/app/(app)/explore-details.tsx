import { useFavoriteMetadata } from '@/hooks/use-favorite-metadata';
import { useOpenPublisher } from '@/hooks/use-open-publisher';
import { useExploreShare } from '@/hooks/use-explore-share';
import { tryOpenApplicationWindow } from '@/services/explore/windows';
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
  const {key,permissions,catalog,publisher,discovery:discoveryScope}=useLocalSearchParams<{key:string;permissions?:string;catalog?:string;publisher?:string;discovery?:string}>();
  const openPublisher=useOpenPublisher();
  const publisherApps=usePublisherApplications(publisher);
  const state=useExplore();
  const share=useExploreShare(state.account);
  const loadPublisher=publisherApps.load;
  useEffect(()=>{if(state.account&&loadPublisher)void loadPublisher(state.account);},[state.account,loadPublisher]);
  const discovery=useDiscovery(discoveryScope==='napps'?'napps':'all');
  const discovered=publisherApps.entries.find(entry=>entry.key===key)??(discovery.addressCache.account===state.account?discovery.addressCache.entries.find(entry=>entry.key===key):undefined)??discovery.entries.find(entry=>entry.key===key);
  const cachedApp=(catalog==='1'?discovered:undefined)??state.entries.find(entry=>entry.key===key)??(state.entry?.key===key?state.entry:undefined)??discovered;
  const metadata=useFavoriteMetadata(cachedApp,state.account);
  const app=metadata.entry;
  const genericAccess=useExploreAccess(app?.release?undefined:app,state.account,state.accessRevision);
  const nappletAccess=useNappletAccess(app?.release,state.account);
  const access=app?.release?nappletAccess:genericAccess;
  const [error,setError]=useState<string>();
  const application=app?applicationPresentation(app):undefined;
  const required = application?.required ?? [];
  const publisherPending=!!loadPublisher&&!publisherApps.loaded&&!publisherApps.error;
  const message=error??metadata.error??access.error??(!app&&publisherApps.error?'napplets.request_failed':state.loaded&&!app&&!publisherPending?'napplets.not_found':undefined);
  if(permissions==='1')return <ApplicationPermissionsPage application={application} error={message}>
    {app&&state.account?<ApplicationSettings accountPubkey={state.account} access={required.length?<ApplicationAccessControls required={required} selected={required}/>:undefined} sourceId={exploreService.signingSource(app)} onReset={()=>exploreService.reset(app,state.account!)}
      onUninstall={app.local?async()=>{await exploreService.uninstallLocal(app,state.account!);router.back();}:undefined}/>:null}
  </ApplicationPermissionsPage>;
  return <ApplicationDetailsPage application={metadata.unresolved?undefined:application} access={metadata.unresolved?{loaded:false,approved:false}:access} error={message}
    actions={app?{entry:app,account:state.account,onShare:state.account?()=>share(app):undefined}:undefined}
    discussion={app&&!app.local&&state.account?{entry:app,account:state.account}:undefined}
    unsupported={app?.release?app.required.filter(domain=>!(NAP_DOMAINS as readonly string[]).includes(domain)):app?.kind==='napp'?app.required.filter(domain=>!SUPPORTED_NAPP_DOMAINS.includes(domain)):[]}
    onPublisher={()=>{if(app?.manifest)openPublisher(app.manifest.pubkey);}}
    onOpen={async()=>{
      if(!app||!state.account)return;
      try {
        const reviewed = access.approved ? undefined : app.release ? [...new Set(['shell', ...app.required])] : required;
        if (await tryOpenApplicationWindow(app, state.account, reviewed)) return;
        if(app.release) {
          await nappletService.activateAccount(state.account);
          const runId=nappletService.prepareOpen(app.release,state.account,access.approved?undefined:[...new Set(['shell',...app.required])]);
          router.push({pathname:'/napplet-run',params:{runId}});
          return;
        }
        const runId=exploreService.prepare(app,state.account,access.approved?undefined:required);
        router.push({pathname:'/explore-run',params:{runId}});
      } catch {setError('napplets.request_failed');}
    }}/>;
}
