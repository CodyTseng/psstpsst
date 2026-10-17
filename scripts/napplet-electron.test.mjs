import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import electron from 'electron';

test(
  'Electron isolates the app bridge and traverses app history before reaching its root',
  { timeout: 30000 },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'psst-napplet-electron-'));
    try {
      await build({
        entryPoints: ['desktop/napplet-preload.ts'],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron'],
        outfile: path.join(dir, 'napplet-preload.js'),
      });
      await writeFile(
        path.join(dir, 'owner-preload.js'),
        `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('testHost',{invoke:(...args)=>ipcRenderer.invoke(...args)});window.addEventListener('DOMContentLoaded',()=>{});`,
      );
      const entry = `
      import { app, BrowserWindow, webContents, ipcMain } from 'electron';
      import { strict as assert } from 'node:assert';
      import { writeFileSync } from 'node:fs';
      import { registerNappletHandlers, fetchNappletResource } from ${JSON.stringify(path.resolve('desktop/napplet-service.ts'))};
      import { buildDocument } from ${JSON.stringify(path.resolve('src/services/napplet/document.ts'))};
      import { IPC } from ${JSON.stringify(path.resolve('desktop/ipc-channels.ts'))};
      app.setPath('userData',${JSON.stringify(path.join(dir, 'profile'))});
      const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
      app.whenReady().then(async()=>{
        const owner = new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(path.join(dir, 'owner-preload.js'))},sandbox:true,contextIsolation:true,nodeIntegration:false}});
        registerNappletHandlers(event=>event.sender===owner.webContents&&event.senderFrame===owner.webContents.mainFrame,()=>owner);
        const presented=new Set();
        ipcMain.on(IPC.nappletMessage,(event,raw)=>{if(raw==='{"type":"psst.frameReady"}')presented.add(event.sender.id);});
        await owner.loadURL('data:text/html,<title>Owner</title>');
        const invoke = (channel,...args)=>owner.webContents.executeJavaScript('window.testHost.invoke('+[channel,...args].map(v=>JSON.stringify(v)).join(',')+')');
        const html=(await buildDocument('<script>window.result={};napplet.identity.getPublicKey().then(key=>result.key=key);try{parent.document;result.escape=true;}catch{result.escape=false;}</script>',['shell','identity','upload']))
          .replace('<iframe ', '<script>window.pendingFrames=[];window.requestAnimationFrame=fn=>pendingFrames.push(fn);</script><iframe ');
        const id=await invoke(IPC.nappletOpen,html);
        const guest=webContents.getAllWebContents().find(w=>w.getURL().includes('napplet.psstpsst.invalid'));
        assert(guest);assert.notEqual(guest.session,owner.webContents.session);
        const view=owner.contentView.children.find(child=>child.webContents===guest);
        await invoke(IPC.nappletBounds,id,{x:0,y:0,width:100,height:100},true);
        assert.equal(view.getVisible(),true);
        let startupBlocked=0;
        guest.emit('before-input-event',{preventDefault:()=>startupBlocked++});
        guest.emit('before-mouse-event',{preventDefault:()=>startupBlocked++});
        assert.equal(startupBlocked,2);
        assert.equal(await guest.executeJavaScript('pendingFrames.length'),1);
        await guest.executeJavaScript('pendingFrames.shift()(0)');
        assert.equal(view.getVisible(),true);
        assert.equal(guest.backgroundThrottling,false);
        await guest.executeJavaScript('pendingFrames.shift()(0)');
        for(let i=0;i<100&&!presented.has(guest.id);i++)await wait(10);
        assert(presented.has(guest.id));
        assert.equal(view.getVisible(),true);
        assert.equal(guest.backgroundThrottling,true);
        owner.showInactive();
        let preview=null;
        for(let i=0;i<100&&!preview;i++){
          preview=await invoke(IPC.nappletCapture,id);
          if(!preview)await wait(10);
        }
        assert(preview.startsWith('data:image/png;base64,'));
        assert.equal(view.getVisible(),true);
        let prevented=0;
        guest.emit('before-input-event',{preventDefault:()=>prevented++});
        guest.emit('before-mouse-event',{preventDefault:()=>prevented++});
        assert.equal(prevented,2);
        await invoke(IPC.nappletBounds,id,{x:0,y:0,width:100,height:100},false);
        assert((await invoke(IPC.nappletCapture,id)).startsWith('data:image/png;base64,'));
        assert.equal(view.getVisible(),false);
        await invoke(IPC.nappletBounds,id,{x:0,y:0,width:100,height:100},true);
        guest.emit('before-input-event',{preventDefault:()=>prevented++});
        assert.equal(prevented,2);
        await invoke(IPC.nappletSend,id,JSON.stringify({type:'identity.getPublicKey.result',id:'unused',pubkey:'unused'}));
        const frame=guest.mainFrame.frames[0];assert(frame);
        assert.equal(await frame.executeJavaScript('typeof window.__psstNapplet'),'undefined');
        assert.equal(await frame.executeJavaScript('typeof window.psstpsstDesktop'),'undefined');
        assert.equal(await frame.executeJavaScript('window.result.escape'),false);
        const keyId=await frame.executeJavaScript("(()=>{const id='test-id';window.reply=new Promise(resolve=>window.addEventListener('message',event=>{if(event.data.id===id)resolve(event.data.pubkey);}));return id;})()");
        await invoke(IPC.nappletSend,id,JSON.stringify({type:'identity.getPublicKey.result',id:keyId,pubkey:'account-A'}));
        assert.equal(await frame.executeJavaScript('window.reply'),'account-A');
        const chunks=[];
        const receiveUpload=async(event,raw)=>{
          if(event.sender!==guest)return;
          const m=JSON.parse(raw);if(!m.type.startsWith('upload.transfer.'))return;
          if(m.type==='upload.transfer.chunk')chunks.push(Buffer.from(m.data,'base64'));
          if(m.type==='upload.transfer.end')await invoke(IPC.nappletSend,id,JSON.stringify({type:'upload.upload.result',id:m.id,result:{ok:true,uploadId:'desktop-upload',status:'complete',rail:'blossom',url:'https://media.example/file'}}));
          await invoke(IPC.nappletSend,id,JSON.stringify({type:'psst.upload.ack',id:m.id,seq:m.seq}));
        };
        ipcMain.on(IPC.nappletMessage,receiveUpload);
        const uploaded=await frame.executeJavaScript("napplet.upload.upload({data:new Blob([new Uint8Array([1,2,3])]),filename:'desktop.bin'})");
        assert.equal(uploaded.status,'complete');assert.deepEqual([...Buffer.concat(chunks)],[1,2,3]);
        ipcMain.removeListener(IPC.nappletMessage,receiveUpload);
        assert.equal(await invoke(IPC.nappletGoBack,id),false);
        await frame.executeJavaScript("history.pushState({page:1},'');history.pushState({page:2},'');window.pops=0;addEventListener('popstate',()=>pops++);");
        for(let i=0;i<100&&guest.navigationHistory.getActiveIndex()<2;i++)await wait(10);
        assert.equal(await invoke(IPC.nappletGoBack,id),true);
        for(let i=0;i<100&&await frame.executeJavaScript('window.pops')<1;i++)await wait(10);
        assert.deepEqual(await frame.executeJavaScript('history.state'),{page:1});
        assert.equal(await invoke(IPC.nappletGoBack,id),true);
        for(let i=0;i<100&&await frame.executeJavaScript('window.pops')<2;i++)await wait(10);
        assert.equal(await frame.executeJavaScript('history.state'),null);
        assert.equal(await invoke(IPC.nappletGoBack,id),false);
        assert.equal(guest.isDestroyed(),false);
        await assert.rejects(fetchNappletResource('https://127.0.0.1/',1024));
        await invoke(IPC.nappletClose,id);assert(guest.isDestroyed());
        // Real frame callbacks must complete for module apps; mocked RAF hid a startup deadlock.
        const realHtml=await buildDocument('<style>html,body{margin:0;background:rgb(20,80,40);color:white}</style><script type="module">await Promise.resolve();document.body.textContent="module-app-ready";</script>',['shell'],'Module app','#09090b');
        const realId=await invoke(IPC.nappletOpen,realHtml);
        const realGuest=webContents.getAllWebContents().find(w=>w.getURL().includes('napplet.psstpsst.invalid'));
        const realView=owner.contentView.children.find(child=>child.webContents===realGuest);
        await invoke(IPC.nappletBounds,realId,{x:0,y:0,width:320,height:240},true);
        for(let i=0;i<300&&!presented.has(realGuest.id);i++)await wait(10);
        assert(presented.has(realGuest.id));
        assert.equal(realGuest.backgroundThrottling,true,'real paint readiness must finish without manual frame callbacks');
        assert.equal(realView.getVisible(),true);
        assert.equal(await realGuest.mainFrame.frames[0].executeJavaScript('document.body.innerText'),'module-app-ready');
        let realBlocked=0;
        realGuest.emit('before-input-event',{preventDefault:()=>realBlocked++});
        assert.equal(realBlocked,0,'input becomes interactive after real first-paint readiness');
        const realImage=await realGuest.capturePage(undefined,{stayHidden:true,stayAwake:true});
        assert.equal(realImage.isEmpty(),false);
        await invoke(IPC.nappletClose,realId);

        writeFileSync(${JSON.stringify(path.join(dir, 'result.json'))},JSON.stringify({ok:true}));
        owner.destroy();app.quit();
      }).catch(error=>{console.error(error);app.exit(1);});
    `;
      await build({
        stdin: {
          contents: entry,
          resolveDir: process.cwd(),
          sourcefile: 'napplet-electron-fixture.ts',
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron'],
        outfile: path.join(dir, 'fixture.js'),
      });
      const result = await new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(electron, [path.join(dir, 'fixture.js')], {
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (data) => {
          output += data;
        });
        child.stderr.on('data', (data) => {
          output += data;
        });
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(output || 'Electron fixture timed out'));
        }, 25000);
        child.on('error', reject);
        child.on('exit', (code) => {
          clearTimeout(timer);
          resolve({ code, output });
        });
      });
      assert.equal(result.code, 0, result.output);
      assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'result.json'), 'utf8')), {
        ok: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
