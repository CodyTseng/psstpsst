import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import electron from 'electron';

test('Explore serves verified bundles and binds NIP-07 and WebLN requests and replies to the real top-level document', {timeout:60000}, async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'psst-explore-electron-'));
 try {
  await build({entryPoints:['desktop/napplet-preload.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:path.join(dir,'napplet-preload.js')});
  await writeFile(path.join(dir,'owner-preload.js'),`const {contextBridge,ipcRenderer}=require('electron');let events=[];ipcRenderer.on('napplet:message',(_e,id,raw)=>events.push({id,raw}));contextBridge.exposeInMainWorld('testHost',{invoke:(...args)=>ipcRenderer.invoke(...args),events:()=>events});`);
  const entry=`
   import { app,BrowserWindow,webContents } from 'electron';
   import { strict as assert } from 'node:assert';
   import { createServer } from 'node:http';
   import { writeFileSync } from 'node:fs';
   import { registerNappletHandlers } from ${JSON.stringify(path.resolve('desktop/napplet-service.ts'))};
   import { IPC } from ${JSON.stringify(path.resolve('desktop/ipc-channels.ts'))};
   const wait=ms=>new Promise(r=>setTimeout(r,ms));
   app.setPath('userData',${JSON.stringify(path.join(dir,'profile'))});
   app.whenReady().then(async()=>{
    const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');if(req.url==='/attachment'){res.setHeader('Content-Disposition','attachment; filename=report.txt');res.end('report');return;}if(req.url==='/child'){res.end('<p>Child</p>');return;}const html='<script>window.result=nostr.getPublicKey();window.walletResult=webln.getInfo();</script><iframe src="/child"></iframe>';if(req.url==='/next'){setTimeout(()=>res.end(html),300);return;}res.end(html);});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
    const owner=new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(path.join(dir,'owner-preload.js'))},sandbox:true,contextIsolation:true,nodeIntegration:false}});
    registerNappletHandlers(e=>e.sender===owner.webContents&&e.senderFrame===owner.webContents.mainFrame,()=>owner);
    await owner.loadURL('data:text/html,<title>Owner</title>');
    const invoke=(channel,...args)=>owner.webContents.executeJavaScript('testHost.invoke('+[channel,...args].map(x=>JSON.stringify(x)).join(',')+')');
    const events=()=>owner.webContents.executeJavaScript('testHost.events()');
    const page={sourceId:'account:naddr',network:false,script:'',bootstrap:{napp:false,domains:[],instance:'fixture'},files:[
      {path:'/index.html',mime:'text/html',body:Buffer.from('<script src="/app.js"></script>').toString('base64')},
      {path:'/app.js',mime:'text/javascript',body:Buffer.from('window.loaded=true;window.result=nostr.getPublicKey();window.walletResult=webln.getInfo();').toString('base64')} ]};
    const id=await invoke(IPC.exploreOpen,page);
    let guest=webContents.getAllWebContents().find(w=>w.getURL().includes('.explore.psstpsst.invalid'));assert(guest);
    await invoke(IPC.nappletBounds,id,{x:0,y:0,width:400,height:600},true);
    for(let i=0;i<100&&!await guest.executeJavaScript('!!window.loaded');i++) await wait(20);
    assert.equal(await guest.executeJavaScript('window.loaded'),true);
    let request;
    for(let i=0;i<100;i++){request=(await events()).map(e=>({...e,message:JSON.parse(e.raw)})).find(e=>e.id===id&&e.message.raw?.includes('getPublicKey'));if(request)break;await wait(20);}
    assert(request,'document-start NIP-07 request must be delivered: '+JSON.stringify({events:await events(),state:await guest.executeJavaScript('({committed:window.__exploreDocumentCommitted,token:window.__exploreNativeDocumentToken,installed:window.__psstExploreInstalled})')}));
    const envelope=request.message;assert.equal(envelope.origin,new URL(guest.getURL()).origin);
    await invoke(IPC.nappletSend,id,JSON.stringify({document:envelope.document,reply:{id:'1',nonce:JSON.parse(envelope.raw).nonce,result:'key'}}));
    assert.equal(await guest.executeJavaScript('window.result'),'key');
    let walletRequest;
    for(let i=0;i<100;i++){walletRequest=(await events()).map(e=>({...e,message:JSON.parse(e.raw)})).find(e=>e.id===id&&e.message.raw?.includes('webln.getInfo'));if(walletRequest)break;await wait(20);}
    assert(walletRequest,'document-start WebLN request must be delivered');
    const walletEnvelope=walletRequest.message,walletRaw=JSON.parse(walletEnvelope.raw);
    assert.equal(walletEnvelope.origin,envelope.origin);
    assert.equal(walletEnvelope.document,envelope.document);
    await invoke(IPC.nappletSend,id,JSON.stringify({document:walletEnvelope.document,reply:{id:walletRaw.id,nonce:walletRaw.nonce,result:{node:{alias:'Wallet',pubkey:''},methods:['sendPayment']}}}));
    assert.deepEqual(await guest.executeJavaScript('window.walletResult'),{node:{alias:'Wallet',pubkey:''},methods:['sendPayment']});

    assert.equal(await guest.executeJavaScript('typeof require'),'undefined');
    assert.equal(await guest.executeJavaScript('typeof window.__psstNapplet'),'undefined');
    const streaming=await invoke(IPC.exploreOpen,{sourceId:'account:streams',network:false,script:'',bootstrap:{napp:true,domains:['config','inc'],instance:'fixture'},files:[
      {path:'/index.html',mime:'text/html',body:Buffer.from('<script>window.iterator=nostrdb.subscribe({kinds:[1]});window.nextEvent=iterator.next();</script>').toString('base64')}
    ]});
    guest=webContents.getAllWebContents().find(w=>w.getURL().includes('.explore.psstpsst.invalid'));assert(guest);
    let streamRequest;
    for(let i=0;i<100;i++){
      streamRequest=(await events()).map(e=>({...e,message:JSON.parse(e.raw)})).find(e=>e.id===streaming&&e.message.raw?.includes('storeSubscribe'));
      if(streamRequest)break;await wait(20);
    }
    assert(streamRequest,'napp async iterator must register its host subscription');
    const streamEnvelope=streamRequest.message,streamRaw=JSON.parse(streamEnvelope.raw);
    await invoke(IPC.nappletSend,streaming,JSON.stringify({document:streamEnvelope.document,reply:{type:'stream',nonce:streamRaw.nonce,streamId:streamRaw.args[0],phase:'event',event:{id:'stored'}}}));
    assert.deepEqual(await guest.executeJavaScript('window.nextEvent'),{done:false,value:{id:'stored'}});
    await guest.executeJavaScript('window.iterator.return()');
    for(let i=0;i<100;i++){
      if((await events()).some(e=>e.id===streaming&&JSON.parse(e.raw).raw?.includes('streamClose')))break;
      await wait(20);
    }
    assert((await events()).some(e=>e.id===streaming&&JSON.parse(e.raw).raw?.includes('streamClose')));
    const website=await invoke(IPC.exploreOpen,{url:'http://127.0.0.1:'+port+'/',sourceId:'account:site',storageId:'A',network:true,script:'',bootstrap:{napp:false,domains:[],instance:'fixture'}});
    guest=webContents.getAllWebContents().find(w=>w.getURL().startsWith('http://127.0.0.1:'+port));assert(guest);
    let first;
    for(let i=0;i<100;i++){first=(await events()).map(e=>({...e,message:JSON.parse(e.raw)})).find(e=>e.id===website&&e.message.raw?.includes('getPublicKey'));if(first)break;await wait(20);}
    assert(first);assert.equal(first.message.origin,'http://127.0.0.1:'+port);
    const oldRequest=JSON.parse(first.message.raw);
    await guest.executeJavaScript('location.href="/next"');await wait(50);
    await guest.executeJavaScript('window.__psstExplore.post('+JSON.stringify(JSON.stringify({...oldRequest,id:'transition-probe'}))+')');
    await wait(50);
    assert(!(await events()).some(e=>JSON.parse(e.raw).raw?.includes('transition-probe')),'old document cannot send during navigation');
    await wait(400);
    await guest.executeJavaScript('window.__psstExplore.post('+JSON.stringify(JSON.stringify({...oldRequest,id:'old-token-probe'}))+')');
    await wait(30);
    assert(!(await events()).some(e=>JSON.parse(e.raw).raw?.includes('old-token-probe')),'old document token cannot authorize a committed document');
    await invoke(IPC.nappletSend,website,JSON.stringify({document:first.message.document,reply:{id:'1',nonce:JSON.parse(first.message.raw).nonce,result:'stale'}}));
    assert.equal(await guest.executeJavaScript('Promise.race([window.result,new Promise(r=>setTimeout(()=>r("pending"),50))])'),'pending');
    // Cancelling a provisional navigation must retain the DOM but rotate its native authority.
    const beforeCancel=await guest.executeJavaScript('window.__exploreNativeDocumentToken');
    await guest.executeJavaScript('location.href="/next"');await wait(50);guest.stop();
    let resumed;
    for(let i=0;i<100;i++){
      resumed=(await events()).map(e=>JSON.parse(e.raw)).find(e=>e.phase==='resume'&&e.previousDocument===beforeCancel);
      if(resumed)break;await wait(20);
    }
    assert(resumed,'cancelled navigation must reactivate its retained document');
    for(let i=0;i<100&&await guest.executeJavaScript('window.__exploreNativeDocumentToken')!==resumed.document;i++)await wait(20);
    await guest.executeJavaScript('window.afterCancel=nostr.getPublicKey();void 0');
    let recovered;
    for(let i=0;i<100;i++){
      recovered=(await events()).map(e=>JSON.parse(e.raw)).find(e=>e.document===resumed.document&&e.raw?.includes('getPublicKey'));
      if(recovered)break;await wait(20);
    }
    assert(recovered,'retained page must regain bridge access after cancellation');
    const recoveredRaw=JSON.parse(recovered.raw);
    await invoke(IPC.nappletSend,website,JSON.stringify({document:resumed.document,reply:{id:recoveredRaw.id,nonce:recoveredRaw.nonce,result:'resumed-key'}}));
    assert.equal(await guest.executeJavaScript('window.afterCancel'),'resumed-key');
    // Chromium may restore the DOM before or after announcing a response download; its policy must remain routable.
    const beforeDownload=await guest.executeJavaScript('window.__exploreNativeDocumentToken');
    await guest.executeJavaScript('location.href="/attachment"');
    let download;
    for(let i=0;i<100;i++){
      download=(await events()).map(e=>JSON.parse(e.raw)).find(e=>e.browser?.action==='download');
      if(download)break;await wait(20);
    }
    assert(download,'native response download policy must reach the owner');
    await wait(50);
    assert(!(await events()).some(e=>{const m=JSON.parse(e.raw);return m.phase==='resume'&&m.previousDocument===download.document;}),'pending download policy must not be invalidated by a later resume');
    await invoke(IPC.nappletSend,website,JSON.stringify({document:download.document,reply:{type:'browser.result',id:download.browser.id,result:false}}));
    let downloadResume;
    for(let i=0;i<100;i++){
      downloadResume=(await events()).map(e=>JSON.parse(e.raw)).find(e=>e.phase==='resume'&&e.previousDocument===beforeDownload);
      if(downloadResume)break;await wait(20);
    }
    assert(downloadResume,'declined download must leave the old page usable');
    for(let i=0;i<100&&await guest.executeJavaScript('window.__exploreNativeDocumentToken')!==downloadResume.document;i++)await wait(20);
    await guest.executeJavaScript('window.afterDownload=nostr.getPublicKey();void 0');
    let afterDownloadRequest;
    for(let i=0;i<100;i++){
      afterDownloadRequest=(await events()).map(e=>JSON.parse(e.raw)).filter(e=>e.document===downloadResume.document&&e.raw?.includes('getPublicKey')).at(-1);
      if(afterDownloadRequest)break;await wait(20);
    }
    assert(afterDownloadRequest,'declined download retains bridge access');
    const afterDownloadRaw=JSON.parse(afterDownloadRequest.raw);
    await invoke(IPC.nappletSend,website,JSON.stringify({document:afterDownloadRequest.document,reply:{id:afterDownloadRaw.id,nonce:afterDownloadRaw.nonce,result:'download-cancelled'}}));
    assert.equal(await guest.executeJavaScript('window.afterDownload'),'download-cancelled');
    const frame=guest.mainFrame.frames[0];if(frame) { assert.equal(await frame.executeJavaScript('typeof window.nostr'),'undefined'); assert.equal(await frame.executeJavaScript('typeof window.webln'),'undefined'); assert.equal(await frame.executeJavaScript('typeof top.nostr.getPublicKey'),'function','same-origin frames share the origin authority'); }
    await guest.executeJavaScript('localStorage.setItem("account-secret","A")');
    const openWebsite=async account=>{
      const id=await invoke(IPC.exploreOpen,{url:'http://127.0.0.1:'+port+'/',sourceId:'site',storageId:account,network:true,script:'',bootstrap:{napp:false,domains:[],instance:'fixture'}});
      const view=webContents.getAllWebContents().find(w=>w.getURL().startsWith('http://127.0.0.1:'+port));
      return {id,view};
    };
    let reopened=await openWebsite('B');
    assert.equal(await reopened.view.executeJavaScript('localStorage.getItem("account-secret")'),null);
    await reopened.view.executeJavaScript('localStorage.setItem("account-secret","B")');
    reopened=await openWebsite('A');
    assert.equal(await reopened.view.executeJavaScript('localStorage.getItem("account-secret")'),'A');
    await invoke(IPC.exploreClearData,'A');
    reopened=await openWebsite('A');
    assert.equal(await reopened.view.executeJavaScript('localStorage.getItem("account-secret")'),null);
    reopened=await openWebsite('B');
    assert.equal(await reopened.view.executeJavaScript('localStorage.getItem("account-secret")'),'B');
    await invoke(IPC.nappletClose,reopened.id);owner.destroy();server.close();
    writeFileSync(${JSON.stringify(path.join(dir,'result.json'))},JSON.stringify({ok:true}));app.exit(0);
   }).catch(e=>{console.error(e);app.exit(1);});
  `;
  await build({stdin:{contents:entry,loader:'ts',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:path.join(dir,'main.js')});
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(electron,[path.join(dir,'main.js')],{env,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const exit=await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve('timeout');},50000);child.on('exit',code=>{clearTimeout(timer);resolve(code);});});
  assert.equal(exit,0,output);assert.equal(JSON.parse(await readFile(path.join(dir,'result.json'),'utf8')).ok,true);
 } finally {await rm(dir,{recursive:true,force:true});}
});
