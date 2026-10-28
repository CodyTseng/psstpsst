import { useFavoriteMetadata } from '@/hooks/use-favorite-metadata';
import { useOpenPublisher } from '@/hooks/use-open-publisher';
import { useExploreShare } from '@/hooks/use-explore-share';
import { tryOpenApplicationWindow } from '@/services/explore/windows';
import { usePublisherApplications } from '@/stores/explore-publisher.store';
import { useDiscovery } from '@/stores/explore-discovery.store';
import { useNappletAccess } from '@/hooks/use-napplet-access';
import { nappletService } from '@/services/napplet/service';
import { NAP_DOMAINS } from '@/services/napplet/protocol';
import { useEffect, useMemo, useState } from 'react';
import { router,useLocalSearchParams } from 'expo-router';
import { ApplicationDetailsPage } from '@/components/napplet/ApplicationDetailsPage';
import { ApplicationPermissionsPage } from '@/components/napplet/ApplicationPermissionsPage';
import { ApplicationSettings } from '@/components/napplet/ApplicationSettings';
import { ApplicationAccessControls } from '@/components/napplet/ApplicationAccessControls';
import { useExplore } from '@/stores/explore.store';
import { useExploreAccess } from '@/hooks/use-explore-access';
import { applicationPresentation } from '@/services/explore/model';
import { exploreService,SUPPORTED_NAPP_DOMAINS } from '@/services/explore/service';
import { useActiveAccount } from '@/stores/active-account.store';
import { applicationEntryFromAddress } from '@/services/explore/application-reference';

export default function ExploreDetailsScreen() {
  const {key,address,permissions,catalog,publisher,discovery:discoveryScope}=useLocalSearchParams<{key:string;address?:string;permissions?:string;catalog?:string;publisher?:string;discovery?:string}>();
  const openPublisher=useOpenPublisher();
  const publisherApps=usePublisherApplications(publisher);
  const state=useExplore();
  const account=useActiveAccount(state=>state.activePubkey);
  const ready=!!account&&state.account===account&&state.loaded;
  const [activationError,setActivationError]=useState<{account:string}>();
  const lookup=address??key;
  const routeEntry=useMemo(()=>lookup?applicationEntryFromAddress(lookup):undefined,[lookup]);
  const lookupKey=routeEntry?.key??key;
  const share=useExploreShare(account);
  const loadPublisher=publisherApps.load;
  useEffect(()=>{if(account&&loadPublisher)void loadPublisher(account);},[account,loadPublisher]);
  const discovery=useDiscovery(discoveryScope==='napps'?'napps':'all');
  const discovered=publisherApps.entries.find(entry=>entry.key===lookupKey)??(discovery.addressCache.account===account?discovery.addressCache.entries.find(entry=>entry.key===lookupKey):undefined)??discovery.entries.find(entry=>entry.key===lookupKey);
  const saved=state.account===account?state.entries.find(entry=>entry.key===lookupKey)??(state.entry?.key===lookupKey?state.entry:undefined):undefined;
  const listed=(catalog==='1'?discovered:undefined)??saved??discovered;
  const cachedApp=useMemo(()=>listed&&routeEntry&&address?{...listed,address:routeEntry.address}:listed??routeEntry,[listed,routeEntry,address]);
  useEffect(()=>{
    if(!cachedApp||!account||ready)return;
    let active=true;
    void exploreService.activate(account).catch(()=>{if(active)setActivationError({account});});
    return()=>{active=false;};
  },[cachedApp,account,ready]);
  const metadata=useFavoriteMetadata(cachedApp,ready?account:null);
  const app=metadata.entry;
  const genericAccess=useExploreAccess(metadata.unresolved||app?.release?undefined:app,ready?account:null,state.accessRevision);
  const nappletAccess=useNappletAccess(metadata.unresolved?undefined:app?.release,ready?account:null);
  const access=app?.release?nappletAccess:genericAccess;
  const [error,setError]=useState<string>();
  const application=app?applicationPresentation(app):undefined;
  const required = application?.required ?? [];
  const publisherPending=!!loadPublisher&&!publisherApps.loaded&&!publisherApps.error;
  const message=!cachedApp&&!publisherPending?(address?'napplets.invalid_manifest':'napplets.not_found'):!ready&&activationError?.account===account?'napplets.request_failed':error??metadata.error??access.error;
  if(permissions==='1')return <ApplicationPermissionsPage application={metadata.unresolved?undefined:application} error={message}>
    {app&&!metadata.unresolved&&ready&&account?<ApplicationSettings accountPubkey={account} access={required.length?<ApplicationAccessControls required={required} selected={required}/>:undefined} sourceId={exploreService.signingSource(app)} onReset={()=>exploreService.reset(app,account!)}
      onUninstall={app.local?async()=>{await exploreService.uninstallLocal(app,account!);router.back();}:undefined}/>:null}
  </ApplicationPermissionsPage>;
  return <ApplicationDetailsPage application={metadata.unresolved?undefined:application} access={metadata.unresolved?{loaded:false,approved:false}:access} error={message}
    actions={app?{entry:app,account,onShare:account?()=>share(app):undefined}:undefined}
    discussion={app&&!app.local&&account?{entry:app,account}:undefined}
    unsupported={app?.release?app.required.filter(domain=>!(NAP_DOMAINS as readonly string[]).includes(domain)):app?.kind==='napp'?app.required.filter(domain=>!SUPPORTED_NAPP_DOMAINS.includes(domain)):[]}
    onPublisher={()=>{if(app?.manifest)openPublisher(app.manifest.pubkey);}}
    onOpen={async()=>{
      if(!app||!account)return;
      try {
        const reviewed = access.approved ? undefined : app.release ? [...new Set(['shell', ...app.required])] : required;
        if (await tryOpenApplicationWindow(app, account, reviewed)) return;
        if(app.release) {
          await nappletService.activateAccount(account);
          const runId=nappletService.prepareOpen(app.release,account,access.approved?undefined:[...new Set(['shell',...app.required])]);
          router.push({pathname:'/napplet-run',params:{runId}});
          return;
        }
        const runId=exploreService.prepare(app,account,access.approved?undefined:required);
        router.push({pathname:'/explore-run',params:{runId}});
      } catch {setError('napplets.request_failed');}
    }}/>;
}
