import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import electron from 'electron';

test(
  'Electron uses a separate profile, frame-bound preload and ordered host replies',
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
      import { app, BrowserWindow, webContents } from 'electron';
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
        await owner.loadURL('data:text/html,<title>Owner</title>');
        const invoke = (channel,...args)=>owner.webContents.executeJavaScript('window.testHost.invoke('+[channel,...args].map(v=>JSON.stringify(v)).join(',')+')');
        const html=await buildDocument('<script>window.result={};napplet.identity.getPublicKey().then(key=>result.key=key);try{parent.document;result.escape=true;}catch{result.escape=false;}</script>',['shell','identity']);
        const id=await invoke(IPC.nappletOpen,html);
        const guest=webContents.getAllWebContents().find(w=>w.getURL().includes('napplet.psstpsst.invalid'));
        assert(guest);assert.notEqual(guest.session,owner.webContents.session);
        await invoke(IPC.nappletSend,id,JSON.stringify({type:'identity.getPublicKey.result',id:'unused',pubkey:'unused'}));
        const frame=guest.mainFrame.frames[0];assert(frame);
        assert.equal(await frame.executeJavaScript('typeof window.__psstNapplet'),'undefined');
        assert.equal(await frame.executeJavaScript('typeof window.psstpsstDesktop'),'undefined');
        assert.equal(await frame.executeJavaScript('window.result.escape'),false);
        const keyId=await frame.executeJavaScript("(()=>{const id='test-id';window.reply=new Promise(resolve=>window.addEventListener('message',event=>{if(event.data.id===id)resolve(event.data.pubkey);}));return id;})()");
        await invoke(IPC.nappletSend,id,JSON.stringify({type:'identity.getPublicKey.result',id:keyId,pubkey:'account-A'}));
        assert.equal(await frame.executeJavaScript('window.reply'),'account-A');
        await assert.rejects(fetchNappletResource('https://127.0.0.1/',1024));
        await invoke(IPC.nappletClose,id);assert(guest.isDestroyed());
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
