import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

test('wallet requests reuse payment sheets, choose wallets at confirmation without exposing credential inputs', { timeout: 120000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'psst-webln-ui-'));
  const screenshots = process.env.WEBLN_SCREENSHOTS;
  let browser, server;
  try {
    await promisify(execFile)(process.execPath, ['node_modules/expo/bin/cli', 'export:embed',
      '--entry-file', 'scripts/fixtures/napplet-signing.tsx', '--platform', 'web', '--bundle-output', path.join(directory, 'fixture.js'),
      '--assets-dest', directory, '--dev', 'false', '--minify', 'true'],
    { maxBuffer: 4 * 1024 * 1024, env: { ...process.env, EXPO_PUBLIC_APP_ENV: 'development' } });
    server = createServer(async (request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
      if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<style>html,body,#root{height:100%;margin:0}#root{display:flex}*{box-sizing:border-box}</style><div id="root"></div><script>if(new URLSearchParams(location.search).get("surface")!=="touch")window.psstpsstDesktop={system:{platform:"darwin"}}</script><script src="/fixture.js"></script>');
        return;
      }
      const file = path.resolve(directory, `.${decodeURIComponent(pathname)}`);
      if (!file.startsWith(`${directory}${path.sep}`)) { response.writeHead(403).end(); return; }
      try {
        response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
        response.end(await readFile(file));
      } catch { response.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const chrome = process.env.NAPPLET_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
    const page = await browser.newPage({ viewport: { width: 390, height: 840 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const address = `http://127.0.0.1:${server.address().port}`;
    if (screenshots) await mkdir(screenshots, { recursive: true });
    for (const theme of ['light', 'dark']) for (const surface of ['desktop', 'touch']) {
      const base = `${address}/?scenario=wallet&theme=${theme}&surface=${surface}`;
      await page.goto(base);
      await page.getByRole('button', { name: 'Pay', exact: true }).waitFor();
      const headerGap = await page.getByRole('button', { name: 'Close', exact: true }).evaluate((close, source) =>
        source.getBoundingClientRect().top - close.getBoundingClientRect().bottom,
      await page.getByTestId('application-identity').elementHandle());
      assert.ok(Math.abs(headerGap - 16) < 1, 'the shared header owns the source gap');
      assert.equal(await page.getByText('https://jumble.social', { exact: true }).count(), 1);
      assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Pay', exact: true }).click({ trial: true });
      if (screenshots) await page.screenshot({ path: path.join(screenshots, `${theme}-${surface}-payment.png`) });
      await page.getByText('ln.coinos.io', { exact: true }).click();
      await page.getByText('Second wallet', { exact: true }).click();
      await page.getByRole('button', { name: 'Pay', exact: true }).waitFor();
      await page.getByText('Second wallet', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Pay', exact: true }).click();
      await page.waitForFunction(() => window.walletFixture.result !== undefined);
      assert.deepEqual(JSON.parse(await page.evaluate(() => window.walletFixture.result)), { walletId: 'second' });
      assert.equal(await page.getByRole('dialog').count(), 0);
      assert.equal(await page.locator('input[type="password"]').count(), 0, 'credential input belongs to the trusted platform');
      await page.goto(base);
      await page.getByRole('button', { name: 'Pay', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.waitForFunction(() => window.walletFixture.result === false);
      assert.equal(await page.getByRole('dialog').count(), 0);
    }
    for (const { surface, width, height, expectedWidth } of [
      { surface: 'desktop', width: 520, height: 900, expectedWidth: 520 },
      { surface: 'desktop', width: 600, height: 900, expectedWidth: 480 },
      { surface: 'desktop', width: 1280, height: 900, expectedWidth: 480 },
      { surface: 'touch', width: 932, height: 430, expectedWidth: 932 },
      { surface: 'touch', width: 932, height: 600, expectedWidth: 480 },
    ]) for (const theme of ['light', 'dark']) for (const operation of ['payment']) {
      await page.setViewportSize({ width, height });
      await page.goto(`${address}/?scenario=wallet&surface=${surface}&theme=${theme}&operation=${operation}`);
      const action = page.getByRole('button', { name: 'Pay', exact: true });
      await action.click({ trial: true });
      const bounds = await action.boundingBox();
      assert.ok(bounds);
      assert.equal(bounds.width + 32, expectedWidth, 'single-pane sheets fill the window; two-pane sheets apply the cap');
      assert.equal(bounds.x, (width - bounds.width) / 2, 'sheet content remains centered');
      if (screenshots) await page.screenshot({ path: path.join(screenshots, `${theme}-${surface}-${width}x${height}-${operation}.png`) });
    }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
