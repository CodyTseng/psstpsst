import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

test('shipped napp UI and dev bindings work in a browser without fetching kit assets', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'psst-napp-ui-dev-'));
  let browser;
  try {
    const outfile = path.join(directory, 'bridge.mjs');
    await build({ entryPoints: ['src/lib/napp/bridge.ts'], bundle: true, platform: 'node', format: 'esm', outfile });
    const { exploreBridge } = await import(pathToFileURL(outfile).href);
    const chrome = process.env.NAPPLET_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
    const page = await browser.newPage();
    const network = [];
    page.on('request', request => network.push(request.url()));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<head><style>body{background:var(--surface);color:var(--text);padding:16px}.app-override{color:rgb(1,2,3)}</style></head><body></body>');
    await page.evaluate(() => {
      window.__exploreDocumentCommitted = true;
      window.__exploreNativeDocumentToken = 'native';
      window.requests = []; window.chunks = [];
      window.__psstExplore = { post(raw) {
        const request = JSON.parse(raw); window.requests.push(request);
        let result = true;
        if (request.method === 'instance') result = 'fixture';
        if (request.method === 'dev.installLocal.begin') result = { id: 'transfer', chunkBytes: 49152 };
        if (request.method === 'dev.installLocal.chunk') window.chunks.push(request.args);
        if (request.method === 'dev.installLocal.finish') result = { nappId: 'local~fixture' };
        queueMicrotask(() => window.__exploreReceive({ id: request.id, nonce: request.nonce, result }));
      } };
    });
    await page.addScriptTag({ content: exploreBridge(true, { background: '#112233', text: '#ddeeff', primary: '#abcdef' }, ['ui', 'dev'], 'fixture') });
    const ui = await page.evaluate(async () => {
      await window.napp.ready;
      const u = window.napp.ui;
      const expected = ['button','chip','tab','tabs','icon','icons','iconInk','appIcon','author','authors','authorPicker',
        'badge','empty','notice','busy','spinner','details','sticky','code','codeBlock','input','field','check','radio','radios',
        'overline','ring','list','itemList','item','rowList','row','addControl','el','stack','bar','flow','fonts'];
      let clicked = 0, changed = '';
      const button = u.button({ label: '<img src=x onerror=alert(1)>', onClick: () => clicked++ });
      button.click();
      const tabs = u.tabs({ items: ['one', 'two'], active: 'one', onChange: value => changed = value });
      tabs.select('two');
      const list = u.list({ items: ['a'], label: item => item }); list.add('b'); list.delete('a');
      const input = u.input({ value: 'hello' });
      const code = u.codeBlock('<script>window.stolen=true</script>');
      const text = u.stack(button, tabs, list, input, code); document.body.append(text);
      const a = u.fonts(), b = u.fonts(); await a;
      return { missing: expected.filter(name => !(name in u)), clicked, selected: tabs.value, changed,
        items: list.items, input: input.value, images: button.querySelectorAll('img').length, code: code.textContent,
        firstStyle: document.head.querySelector('style').dataset.nappUi, sameFonts: a === b,
        surface: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() };
    });
    assert.deepEqual(ui, { missing: [], clicked: 1, selected: 'two', changed: '', items: ['b'], input: 'hello', images: 0,
      code: '<script>window.stolen=true</script>', firstStyle: '08a7f6f', sameFonts: true, surface: '#112233' });
    for (const background of ['#ffffff', '#121212']) {
      await page.evaluate(background => window.__exploreReceive({ type: 'theme', value: { background,
        text: background === '#ffffff' ? '#111111' : '#ddeeff', primary: '#0000ff' } }), background);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()), background);
      await page.screenshot({ path: path.join(tmpdir(), background === '#ffffff' ? 'psst-napp-ui-light.png' : 'psst-napp-ui-dark.png') });
    }
    const binary = await page.evaluate(async () => {
      const bytes = new Uint8Array([99, 1, 2, 3, 88]);
      const result = await window.napp.dev.installLocal([
        { path: 'metadata.json', data: '{"id":"fixture"}' },
        { path: 'index.html', data: new Blob(['hello'], { type: 'text/html' }) },
        { path: 'array.bin', data: bytes.subarray(1, 4) },
        { path: 'buffer.bin', data: new Uint8Array([4, 5]).buffer },
        { path: 'empty.txt', data: '' },
      ]);
      return { result, chunks: window.chunks.map(([, index, data]) => [index, [...atob(data)].map(c => c.charCodeAt(0))]),
        descriptor: window.requests.find(r => r.method === 'dev.installLocal.begin').args[0] };
    });
    assert.deepEqual(binary.result, { nappId: 'local~fixture' });
    assert.deepEqual(binary.chunks.slice(2), [[2, [1, 2, 3]], [3, [4, 5]], [4, []]]);
    assert.equal(binary.descriptor[2].size, 3);
    assert.equal(binary.descriptor[1].type, 'text/html');
    assert.deepEqual(network, []);
    assert.deepEqual(errors, []);
    await page.close();
    const plain = await browser.newPage();
    await plain.setContent('<body>Plain application</body>');
    await plain.addScriptTag({ content: exploreBridge(true) });
    assert.deepEqual(await plain.evaluate(() => ({ ui: 'ui' in window.napp, dev: 'dev' in window.napp,
      styles: document.querySelectorAll('[data-napp-ui]').length })), { ui: false, dev: false, styles: 0 });
    await plain.close();
  } finally { await browser?.close(); await rm(directory, { recursive: true, force: true }); }
});
