import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import electron from 'electron';

test('Explore serves verified bundles and binds NIP-07 requests and replies to the real top-level document', {timeout:60000}, async()=>{
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
   import { exploreBridge } from ${JSON.stringify(path.resolve('src/services/explore/bridge.ts'))};
   import { IPC } from ${JSON.stringify(path.resolve('desktop/ipc-channels.ts'))};
   const wait=ms=>new Promise(r=>setTimeout(r,ms));
   app.setPath('userData',${JSON.stringify(path.join(dir,'profile'))});
   app.whenReady().then(async()=>{
    const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');if(req.url==='/child'){res.end('<p>Child</p>');return;}res.end('<script>window.result=nostr.getPublicKey();</script><iframe src="/child"></iframe>');});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
    const owner=new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(path.join(dir,'owner-preload.js'))},sandbox:true,contextIsolation:true,nodeIntegration:false}});
    registerNappletHandlers(e=>e.sender===owner.webContents&&e.senderFrame===owner.webContents.mainFrame,()=>owner);
    await owner.loadURL('data:text/html,<title>Owner</title>');
    const invoke=(channel,...args)=>owner.webContents.executeJavaScript('testHost.invoke('+[channel,...args].map(x=>JSON.stringify(x)).join(',')+')');
    const events=()=>owner.webContents.executeJavaScript('testHost.events()');
    const page={sourceId:'account:naddr',network:false,script:exploreBridge(false),files:[
      {path:'/index.html',mime:'text/html',body:Buffer.from('<script src="/app.js"></script>').toString('base64')},
      {path:'/app.js',mime:'text/javascript',body:Buffer.from('window.loaded=true;window.result=nostr.getPublicKey();').toString('base64')} ]};
    const id=await invoke(IPC.exploreOpen,page);
    let guest=webContents.getAllWebContents().find(w=>w.getURL().includes('.explore.psstpsst.invalid'));assert(guest);
    await invoke(IPC.nappletBounds,id,{x:0,y:0,width:400,height:600},true);
    for(let i=0;i<100&&!await guest.executeJavaScript('!!window.loaded');i++) await wait(20);
    assert.equal(await guest.executeJavaScript('window.loaded'),true);
    let request;
    for(let i=0;i<100;i++){request=(await events()).map(e=>({...e,message:JSON.parse(e.raw)})).find(e=>e.id===id&&e.message.raw?.includes('getPublicKey'));if(request)break;await wait(20);}
    assert(request,'document-start NIP-07 request must be delivered');
    const envelope=request.message;assert.equal(envelope.origin,new URL(guest.getURL()).origin);
    await invoke(IPC.nappletSend,id,JSON.stringify({document:envelope.document,reply:{id:'1',nonce:JSON.parse(envelope.raw).nonce,result:'key'}}));
    assert.equal(await guest.executeJavaScript('window.result'),'key');
    assert.equal(await guest.executeJavaScript('typeof require'),'undefined');
    assert.equal(await guest.executeJavaScript('typeof window.__psstNapplet'),'undefined');
    const streaming=await invoke(IPC.exploreOpen,{sourceId:'account:streams',network:false,script:exploreBridge(true),files:[
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
    const website=await invoke(IPC.exploreOpen,{url:'http://127.0.0.1:'+port+'/',sourceId:'account:site',storageId:'A',network:true,script:exploreBridge(false)});
    guest=webContents.getAllWebContents().find(w=>w.getURL().startsWith('http://127.0.0.1:'+port));assert(guest);
    let first;
    for(let i=0;i<100;i++){first=(await events()).map(e=>({...e,message:JSON.parse(e.raw)})).find(e=>e.id===website&&e.message.raw?.includes('getPublicKey'));if(first)break;await wait(20);}
    assert(first);assert.equal(first.message.origin,'http://127.0.0.1:'+port);
    await guest.executeJavaScript('location.href="/next"');await wait(250);
    await invoke(IPC.nappletSend,website,JSON.stringify({document:first.message.document,reply:{id:'1',nonce:JSON.parse(first.message.raw).nonce,result:'stale'}}));
    assert.equal(await guest.executeJavaScript('Promise.race([window.result,new Promise(r=>setTimeout(()=>r("pending"),50))])'),'pending');
    const frame=guest.mainFrame.frames[0];if(frame) assert.equal(await frame.executeJavaScript('typeof window.nostr'),'undefined');
    await guest.executeJavaScript('localStorage.setItem("account-secret","A")');
    const openWebsite=async account=>{
      const id=await invoke(IPC.exploreOpen,{url:'http://127.0.0.1:'+port+'/',sourceId:'site',storageId:account,network:true,script:exploreBridge(false)});
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
