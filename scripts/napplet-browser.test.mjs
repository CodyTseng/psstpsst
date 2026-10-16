import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

test(
  'the shipped shim runs inside the opaque sandbox with mediated resources and WASM',
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'psst-napplet-browser-'));
    let browser;
    let server;
    try {
      const output = path.join(directory, 'document.mjs');
      await build({
        entryPoints: ['src/services/napplet/document.ts'],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: output,
      });
      const { buildDocument } = await import(pathToFileURL(output).href);
      const artifact = `<title>Protocol fixture</title><script>
      window.results={};
      parent.postMessage({type:'psst.frameReady'},'*');
      requestAnimationFrame(()=>{results.painted=true;});
      (async()=>{
        results.domains=Object.keys(window.napplet).sort();
        try{parent.document.body;results.parentReadable=true;}catch{results.parentReadable=false;}
        try{localStorage.setItem('escape','1');results.browserStorage=true;}catch{results.browserStorage=false;}
        try{await fetch('https://blocked.example/leak');results.network=true;}catch{results.network=false;}
        await WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0]));results.wasm=true;
        results.pubkey=await napplet.identity.getPublicKey();
        await napplet.storage.setItem('key','value');results.stored=await napplet.storage.getItem('key');
        await napplet.config.registerSchema({type:'object',properties:{enabled:{type:'boolean',default:true}}});
        results.config=await napplet.config.get();
        const image=await napplet.resource.bytes('https://images.example/image.svg');results.imageType=image.type;
        results.uploadInfo=await napplet.upload.info();
        results.uploadStatuses=[];
        const progress=napplet.upload.onStatus(status=>results.uploadStatuses.push(status.status));
        const data=Uint8Array.from({length:130000},(_,i)=>i%251);
        results.upload=await napplet.upload.upload({data:new Blob([data],{type:'application/octet-stream'}),filename:'fixture.bin',noTransform:true});
        results.uploadStatus=await napplet.upload.status(results.upload.uploadId);progress.close();
        results.ready=true;
      })().catch(error=>results.error=String(error));
    </script>`;
      const html = await buildDocument(artifact, [
        'shell',
        'identity',
        'storage',
        'config',
        'resource',
        'upload',
      ]);
      server = createServer((_request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(html);
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const chrome =
        process.env.NAPPLET_CHROME ??
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      browser = await chromium.launch({
        headless: true,
        ...(existsSync(chrome) ? { executablePath: chrome } : {}),
      });
      const page = await browser.newPage();
      const messages = [];
      const uploadChunks = [];
      let uploadBytes;
      let resolveFirstFrame;
      const firstFrame = new Promise((resolve) => { resolveFirstFrame = resolve; });
      let attemptedNetwork = 0;
      await page.route('https://blocked.example/**', (route) => {
        attemptedNetwork++;
        return route.abort();
      });
      await page.exposeFunction('bridge', async (raw) => {
        const m = JSON.parse(raw);
        messages.push(m);
        if (m.type === 'psst.frameReady') {
          const frame = page.frames().find((candidate) => candidate.parentFrame());
          resolveFirstFrame(await frame.evaluate(() => ({ painted: window.results.painted, loaded: document.readyState })));
          return;
        }
        if (m.type.startsWith('upload.transfer.')) {
          if (m.type === 'upload.transfer.start') assert.equal(m.size,130000);
          if (m.type === 'upload.transfer.chunk') uploadChunks.push(Buffer.from(m.data,'base64'));
          if (m.type === 'upload.transfer.end') {
            uploadBytes=Buffer.concat(uploadChunks);
            assert.equal(uploadBytes.length,130000);
            assert(uploadBytes.every((byte,index)=>byte===index%251));
            await page.evaluate((id)=>window.__hostReceive({type:'upload.upload.result',id,result:{ok:true,uploadId:'fixture-upload',status:'pending',rail:'blossom'}}),m.id);
            await page.evaluate(()=>window.__hostReceive({type:'upload.status.changed',status:{ok:true,uploadId:'fixture-upload',status:'complete',rail:'blossom',url:'https://media.example/file',updatedAt:Date.now()}}));
          }
          await page.evaluate((m)=>window.__hostReceive({type:'psst.upload.ack',id:m.id,seq:m.seq}),m);
          return;
        }
        let reply = { type: `${m.type}.result`, id: m.id };
        if (m.type === 'shell.ready')
          reply = {
            type: 'shell.init',
            capabilities: { domains: ['shell', 'identity', 'storage', 'config', 'resource', 'upload'] },
            services: [],
          };
        else if (m.type === 'identity.getPublicKey') reply.pubkey = 'a'.repeat(64);
        else if (m.type === 'storage.get') reply.value = 'value';
        else if (m.type === 'config.registerSchema') reply.ok = true;
        else if (m.type === 'config.get')
          reply = { type: 'config.values', id: m.id, values: { enabled: true } };
        else if (m.type === 'upload.info') reply.info={rails:[{rail:'blossom',enabled:true}]};
        else if (m.type === 'upload.status') reply.status={ok:true,uploadId:m.uploadId,status:'complete',rail:'blossom',url:'https://media.example/file',updatedAt:Date.now()};
        else if (m.type === 'resource.bytes') {
          const svg = Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>',
          ).toString('base64');
          reply.blob = { __nappletBlob: svg, mime: 'image/svg+xml' };
          reply.mime = 'image/svg+xml';
        }
        await page.evaluate((message) => window.__hostReceive(message), reply);
      });
      await page.addInitScript(() => {
        if (window === window.top) window.__psstNapplet = { post: (raw) => window.bridge(raw) };
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const frame = page.frames().find((candidate) => candidate.parentFrame());
      assert.ok(frame);
      await frame.waitForFunction(() => window.results?.ready || window.results?.error, {
        timeout: 10000,
      });
      const result = await frame.evaluate(() => window.results);
      assert.deepEqual(await firstFrame, { painted: true, loaded: 'complete' });
      assert.equal(messages.filter((message) => message.type === 'psst.frameReady').length, 1);
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.equal(result.parentReadable, false);
      assert.equal(result.browserStorage, false);
      assert.equal(result.network, false);
      assert.equal(attemptedNetwork, 0);
      assert.equal(result.wasm, true);
      assert.equal(result.pubkey, 'a'.repeat(64));
      assert.equal(result.stored, 'value');
      assert.deepEqual(result.config, { enabled: true });
      assert.equal(result.imageType, 'image/png');
      assert.equal(result.upload.status,'pending');
      assert.equal(result.uploadStatus.status,'complete');
      assert.deepEqual(result.uploadStatuses,['complete']);
      assert.equal(uploadChunks.length,3);
      assert.equal(result.domains.includes('dm'), false);
      assert.equal(await frame.evaluate(() => typeof window.nostr), 'undefined');
      assert.ok(messages.some((message) => message.type === 'storage.set'));
      for (const [background, expected, changed, changedExpected] of [
        ['#F2F2F7', 'rgb(242, 242, 247)', '#09090B', 'rgb(9, 9, 11)'],
        ['#09090B', 'rgb(9, 9, 11)', '#F2F2F7', 'rgb(242, 242, 247)'],
      ]) {
        const canvasPage = await browser.newPage();
        await canvasPage.setContent(await buildDocument(
          '<script>window.firstBackground=getComputedStyle(document.documentElement).backgroundColor;</script><main>Canvas</main>',
          [], 'Canvas fixture', background,
        ));
        const canvasFrame = canvasPage.frames().find((candidate) => candidate.parentFrame());
        await canvasFrame.waitForFunction(() => window.firstBackground);
        assert.equal(await canvasFrame.evaluate(() => window.firstBackground), expected);
        assert.deepEqual(await canvasPage.evaluate(() => [document.documentElement, document.body, document.querySelector('iframe')]
          .map((element) => getComputedStyle(element).backgroundColor)), [expected, expected, expected]);
        // Container theme changes also work when the app has not requested THEME.
        await canvasPage.evaluate((background) => window.__hostReceive({ type: 'theme.changed', theme: { colors: { background } } }), changed);
        await canvasFrame.waitForFunction((expected) => getComputedStyle(document.documentElement).backgroundColor === expected, changedExpected);
        assert.equal(await canvasPage.evaluate(() => getComputedStyle(document.body).backgroundColor), changedExpected);
        // An app's own stylesheet still controls its page fill.
        await canvasFrame.evaluate(() => {
          const style = document.createElement('style');
          style.textContent = 'html{background-color:rgb(12,34,56)}';
          document.head.appendChild(style);
        });
        await canvasPage.evaluate((background) => window.__hostReceive({ type: 'theme.changed', theme: { colors: { background } } }), background);
        await canvasFrame.waitForFunction((background) => getComputedStyle(document.documentElement).getPropertyValue('--psst-host-background').trim() === background, background);
        assert.equal(await canvasFrame.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgb(12, 34, 56)');
        await canvasPage.close();
      }
    } finally {
      await browser?.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
