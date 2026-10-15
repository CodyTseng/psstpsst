import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
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
        results.ready=true;
      })().catch(error=>results.error=String(error));
    </script>`;
      const html = await buildDocument(artifact, [
        'shell',
        'identity',
        'storage',
        'config',
        'resource',
      ]);
      server = createServer((_request, response) => {
        response.setHeader('Content-Type', 'text/html');
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
      let attemptedNetwork = 0;
      await page.route('https://blocked.example/**', (route) => {
        attemptedNetwork++;
        return route.abort();
      });
      await page.exposeFunction('bridge', async (raw) => {
        const m = JSON.parse(raw);
        messages.push(m);
        let reply = { type: `${m.type}.result`, id: m.id };
        if (m.type === 'shell.ready')
          reply = {
            type: 'shell.init',
            capabilities: { domains: ['shell', 'identity', 'storage', 'config', 'resource'] },
            services: [],
          };
        else if (m.type === 'identity.getPublicKey') reply.pubkey = 'a'.repeat(64);
        else if (m.type === 'storage.get') reply.value = 'value';
        else if (m.type === 'config.registerSchema') reply.ok = true;
        else if (m.type === 'config.get')
          reply = { type: 'config.values', id: m.id, values: { enabled: true } };
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
      assert.equal(result.domains.includes('dm'), false);
      assert.equal(await frame.evaluate(() => typeof window.nostr), 'undefined');
      assert.ok(messages.some((message) => message.type === 'storage.set'));
    } finally {
      await browser?.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
