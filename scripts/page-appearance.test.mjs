import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

// Exercise the shipped generated bridge in both ordinary documents and opaque frames.
test('mobile document appearance follows metadata, media and background changes across formats', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'psst-appearance-'));
  let browser;
  try {
    const outfile = path.join(directory, 'bridge.mjs');
    await build({ stdin: { contents: "export { exploreBridge } from './src/lib/napp/bridge'; export { buildDocument } from './src/services/napplet/document';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile });
    const { exploreBridge, buildDocument } = await import(pathToFileURL(outfile).href);
    const chrome = process.env.NAPPLET_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
    const html = `<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#121212">
      <style>html { background: transparent } body { background: rgb(20, 40, 60) }</style><body>Application</body>`;
    for (const format of ['napp', 'nsite', 'website', 'napplet']) {
      const page = await browser.newPage({ colorScheme: 'light' });
      const colors = [];
      await page.exposeFunction('appearanceMessage', raw => {
        const message = JSON.parse(raw);
        if (message.type === 'psst.appearance') colors.push(message.color);
      });
      await page.evaluate(() => { window.__exploreDocumentCommitted = true; window.__exploreNativeDocumentToken = 'fixture'; window.__nappletHost = { postMessage: window.appearanceMessage }; });
      if (format === 'napplet') await page.setContent(await buildDocument(html, ['shell']));
      else {
        await page.setContent(html);
        await page.addScriptTag({ content: exploreBridge(format === 'napp') });
      }
      const document = format === 'napplet' ? page.frames().find(frame => frame.parentFrame()) : page.mainFrame();
      const expectColor = async color => {
        for (let i = 0; i < 100 && colors.at(-1) !== color; i++) await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(colors.at(-1), color, format);
      };
      await expectColor('#ffffff');
      await page.emulateMedia({ colorScheme: 'dark' });
      await expectColor('#121212');
      await document.evaluate(() => { document.querySelector('meta[media="(prefers-color-scheme: dark)"]').content = 'rgb(1, 2, 3)'; });
      await expectColor('#010203');
      await document.evaluate(() => { document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.remove()); });
      await expectColor('#14283c');
      await document.evaluate(() => { document.body.style.background = '#abcdef'; });
      await expectColor('#abcdef');
      await document.evaluate(() => {
        document.body.style.background = 'transparent';
        document.documentElement.style.background = '#654321';
      });
      await expectColor('#654321');
      await document.evaluate(() => { document.documentElement.style.background = 'transparent'; });
      await expectColor(null);
      await document.evaluate(() => {
        const meta = document.createElement('meta'); meta.name = 'theme-color'; meta.content = 'invalid-color'; document.head.append(meta);
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(colors.at(-1), null, `${format}: invalid colors fall back`);
      const count = colors.length;
      await document.evaluate(() => { for (let i = 0; i < 100; i++) document.body.append(document.createElement('div')); });
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(colors.length, count, `${format}: content updates do not emit appearance updates`);
      await page.close();
    }
  } finally { await browser?.close(); await rm(directory, { recursive: true, force: true }); }
});
