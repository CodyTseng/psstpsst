import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

test(
  'recent apps support pointer menus, drag targets and both themes',
  { timeout: 120000 },
  async () => {
    const development = process.env.NAPPLET_GALLERY_DEV !== '0';
    const dir = await mkdtemp(path.join(tmpdir(), 'psst-napplet-gallery-'));
    let browser;
    let server;
    try {
      await promisify(execFile)(
        process.execPath,
        [
          'node_modules/expo/bin/cli',
          'export:embed',
          '--entry-file',
          'scripts/fixtures/napplet-gallery.tsx',
          '--platform',
          'web',
          '--bundle-output',
          path.join(dir, 'gallery.js'),
          '--assets-dest',
          dir,
          '--dev',
          development ? 'true' : 'false',
          '--minify',
          development ? 'false' : 'true',
        ],
        { maxBuffer: 4 * 1024 * 1024, env: { ...process.env, EXPO_PUBLIC_APP_ENV: 'development' } },
      );
      server = createServer(async (request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        if (pathname === '/') {
          response.setHeader('Content-Type', 'text/html');
          response.end(
            '<style>html,body,#root{height:100%;margin:0}#root{display:flex}*{box-sizing:border-box}</style><div id="root"></div><script>window.psstpsstDesktop={system:{platform:"darwin"}}</script><script src="/gallery.js"></script>',
          );
        } else {
          const file = path.resolve(dir, `.${decodeURIComponent(pathname)}`);
          if (!file.startsWith(`${dir}${path.sep}`)) {
            response.writeHead(403).end();
            return;
          }
          try {
            response.setHeader(
              'Content-Type',
              file.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'application/octet-stream',
            );
            response.end(await readFile(file));
          } catch {
            response.writeHead(404).end();
          }
        }
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const chrome =
        process.env.NAPPLET_CHROME ??
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      browser = await chromium.launch({
        headless: true,
        ...(existsSync(chrome) ? { executablePath: chrome } : {}),
      });
      const page = await browser.newPage({ viewport: { width: 420, height: 840 } });
      const errors = [];
      const animationWarnings = [];
      page.on('console', (message) => {
        if (message.type() === 'warning' && message.text().includes('[Reanimated]')) {
          animationWarnings.push(message.text());
        }
      });
      page.on('pageerror', (error) => errors.push(error.message));
      const address = `http://127.0.0.1:${server.address().port}`;
      await page.goto(address);
      await page.getByRole('button', { name: 'Weather', exact: true }).waitFor({ timeout: 10000 }).catch(async (error) => {
        throw new Error(`${error.message}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`);
      });
      await page.getByRole('button', { name: 'Weather', exact: true }).click();
      await page.getByRole('button', { name: 'Close app', exact: true }).click();
      await page.getByRole('button', { name: 'Weather', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Notes', exact: true }).click({ button: 'right' });
      await page.getByText('Pin', { exact: true }).click();
      await page.waitForFunction(() => document.title === 'pin:Notes');
      await page.getByRole('button', { name: 'Notes', exact: true }).click({ button: 'right' });
      await page.getByText('Remove', { exact: true }).click();
      await page.waitForFunction(() => document.title === 'remove:Notes');
      assert.equal(await page.getByRole('button', { name: 'Notes', exact: true }).count(), 0);
      const drag = async (name, target, expected) => {
        const bounds = await page.getByRole('button', { name, exact: true }).boundingBox();
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(550);
        await page.mouse.move(bounds.x + bounds.width / 2 + 20, bounds.y + bounds.height / 2 + 20, {
          steps: 3,
        });
        const drop = page.getByText(target, { exact: true });
        await drop.waitFor();
        const destination = await drop.boundingBox();
        await page.mouse.move(
          destination.x + destination.width / 2,
          destination.y + destination.height / 2,
          { steps: 10 },
        );
        await page.mouse.up();
        await page.waitForFunction((value) => document.title === value, expected);
      };
      await drag('Chess', 'Pin', 'pin:Chess');
      await drag('Timer', 'Remove', 'remove:Timer');
      await page.goto(`${address}/?theme=dark`);
      await page.getByRole('button', { name: 'Weather', exact: true }).waitFor();
      const background = await page
        .getByText('Mini apps', { exact: true })
        .evaluate((element) => getComputedStyle(element.parentElement).backgroundColor);
      assert.notEqual(background, 'rgba(0, 0, 0, 0)');
      assert.deepEqual(errors, []);
      assert.deepEqual(animationWarnings, [], 'returning to recents and interacting with apps must not read shared values during render');
    } finally {
      await browser?.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  },
);
