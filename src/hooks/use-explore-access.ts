import { useEffect,useState } from 'react';
import { exploreService } from '@/services/explore/service';
import type { ExploreEntry } from '@/services/explore/model';

export function useExploreAccess(entry:ExploreEntry|undefined,account:string|null,revision:number) {
  const key=JSON.stringify([account,entry?.key,entry?.required,revision]);
  const [result,setResult]=useState<{key:string;approved?:boolean;error?:string}>();
  useEffect(()=>{
    let active=true;
    if(entry&&account)void exploreService.access(entry,account)
      .then(approved=>{if(active)setResult({key,approved});})
      .catch(()=>{if(active)setResult({key,error:'applications.request_failed'});});
    return ()=>{active=false;};
  },[entry,account,key]);
  const current=result?.key===key?result:undefined;
  return {loaded:current?.approved!==undefined,approved:current?.approved===true,error:current?.error};
}
