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
  'signing approvals prioritize impact and use two horizontal decisions with scoped duration',
  { timeout: 120000 },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'psst-napplet-signing-'));
    let browser;
    let server;
    try {
      await promisify(execFile)(
        process.execPath,
        [
          'node_modules/expo/bin/cli',
          'export:embed',
          '--entry-file',
          'scripts/fixtures/napplet-signing.tsx',
          '--platform',
          'web',
          '--bundle-output',
          path.join(dir, 'gallery.js'),
          '--assets-dest',
          dir,
          '--dev',
          'false',
          '--minify',
          'true',
        ],
        { maxBuffer: 4 * 1024 * 1024, env: { ...process.env, EXPO_PUBLIC_APP_ENV: 'development' } },
      );
      server = createServer(async (request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
        if (pathname === '/') {
          response.setHeader('Content-Type', 'text/html');
          response.end(
            '<style>html,body,#root{height:100%;margin:0}#root{display:flex}*{box-sizing:border-box}</style><div id="root"></div><script>if(new URLSearchParams(location.search).get("surface")!=="touch")window.psstpsstDesktop={system:{platform:"darwin"}}</script><script src="/gallery.js"></script>',
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
              file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream',
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
      const page = await browser.newPage({ viewport: { width: 390, height: 840 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      const assertNotSelectable = async (locator) => {
        await locator.scrollIntoViewIfNeeded();
        assert.equal(await locator.evaluate((node) => getComputedStyle(node).userSelect), 'none');
        await page.evaluate(() => window.getSelection()?.removeAllRanges());
        const box = await locator.boundingBox();
        await page.mouse.move(box.x + 2, box.y + Math.min(box.height / 2, 12));
        await page.mouse.down();
        await page.mouse.move(box.x + Math.min(box.width - 2, 160), box.y + Math.min(box.height / 2, 12), { steps: 8 });
        await page.mouse.up();
        assert.equal(await page.evaluate(() => window.getSelection()?.toString() ?? ''), '', 'dragging signing content must not select text');
      };
      const address = `http://127.0.0.1:${server.address().port}`;
      for (const [theme, surface] of [['light', 'desktop'], ['dark', 'desktop'], ['light', 'touch']]) {
        await page.goto(`${address}/?theme=${theme}&surface=${surface}`);
        const screenshot = `${theme}-${surface}`;
        const allow = page.getByRole('button', { name: 'Allow', exact: true });
        const reject = page.getByRole('button', { name: /^Reject\(\d+\)$/ });
        await allow.waitFor({ timeout: 10000 }).catch(async (error) => {
          if (process.env.NAPPLET_SIGNING_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_SIGNING_SCREENSHOTS}/failed.png` });
          throw new Error(`${error.message}\nBrowser errors: ${errors.join('\n')}\nBody: ${await page.locator('body').innerText()}`);
        });
        await page.getByText('Kind 30078', { exact: true }).waitFor();
        await page.getByText('d: "game-progress"', { exact: true }).waitFor();
        const countdown = reject;
        await countdown.waitFor();
        assert.equal(await page.getByText(/Request cancels in \d+s/).count(), 0);
        const initialCountdown = await countdown.innerText();
        await page.waitForFunction((initial) => !document.body.innerText.includes(initial), initialCountdown);
        const signer = page.getByRole('img', { name: 'Signing account: Alice', exact: true });
        await signer.waitFor();
        const signerBox = await signer.boundingBox();
        const closeBox = await page.getByRole('button', { name: 'Close', exact: true }).boundingBox();
        assert.equal(signerBox.width, closeBox.width, 'signer avatar and close control have equal widths');
        assert.equal(signerBox.height, closeBox.height, 'signer avatar and close control have equal heights');
        const titleBox = await page.getByText('Publish application data', { exact: true }).boundingBox();
        assert(Math.abs(signerBox.y + signerBox.height / 2 - titleBox.y - titleBox.height / 2) < 2, 'signer avatar aligns with the title');
        assert(signerBox.x > titleBox.x + titleBox.width, 'signer avatar occupies the trailing header slot');
        assert.equal(await page.getByText('Signing account: Alice', { exact: true }).count(), 0);
        const appNameBox = await page.getByText('Arcade', { exact: true }).boundingBox();
        const nextBox = await page.getByText('Additional requests waiting: 2', { exact: true }).boundingBox();
        // The app icon is taller than its label; use its row to compare gutters.
        const appRowBox = await page.getByText('Arcade', { exact: true }).evaluate((node) => {
          const icon = node.previousElementSibling.getBoundingClientRect();
          return { top: icon.top, bottom: icon.bottom };
        });
        assert(appNameBox.y > closeBox.y + closeBox.height, 'application identity clears the header');
        assert(Math.abs(appRowBox.top - closeBox.y - closeBox.height - (nextBox.y - appRowBox.bottom)) < 1, 'application identity has equal top and bottom gaps');
        await page.getByText('score', { exact: true }).waitFor();
        assert.equal(await page.getByText('1280', { exact: true }).count(), 1);
        assert.equal(await page.getByText('Publisher', { exact: true }).count(), 0);
        await page.waitForFunction(() => {
          const button = [...document.querySelectorAll('[role="button"]')].find((node) => node.textContent === 'Allow');
          if (!button) return false;
          const box = button.getBoundingClientRect();
          const last = window.__approvalY;
          window.__approvalY = box.y;
          window.__approvalStable = last != null && Math.abs(last - box.y) < 0.2 ? (window.__approvalStable || 0) + 1 : 0;
          return window.__approvalStable >= 4 && box.bottom <= innerHeight;
        }, undefined, { timeout: 10000 });
        const a = await allow.boundingBox(), r = await reject.boundingBox();
        assert(Math.abs(a.y - r.y) < 2, 'decisions must share one row');
        assert(a.y + a.height <= 840 && r.y + r.height <= 840, 'decisions stay visible');
        if (process.env.NAPPLET_SIGNING_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${screenshot}.png` });
        assert.equal(await page.getByText('wss://relay.example/', { exact: true }).count(), 0);
        const details = page.getByRole('button', { name: 'More information', exact: true });
        const infoBox = await details.boundingBox();
        assert(Math.abs(infoBox.x + infoBox.width / 2 - 195) < 2, 'disclosure is centred');
        await page.getByRole('button', { name: 'Only once', exact: true }).click();
        await page.getByText('1 hour', { exact: true }).waitFor();
        if (process.env.NAPPLET_SIGNING_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${screenshot}-menu.png` });

        const menuAllow = await allow.boundingBox(), menuReject = await reject.boundingBox();
        assert(Math.abs(menuAllow.y - a.y) < 1 && Math.abs(menuReject.y - r.y) < 1, 'opening the menu must not move decisions');
        const openedDetails = await details.boundingBox();
        assert(Math.abs(openedDetails.y - infoBox.y) < 1, 'opening the menu must not move content');
        const optionBox = await page.getByRole('button', { name: '1 hour', exact: true }).boundingBox();
        const triggerBox = await page.getByRole('button', { name: 'Only once', exact: true }).first().boundingBox();
        assert(optionBox.y < triggerBox.y, 'duration menu opens above its trigger');
        assert(menuAllow.y + menuAllow.height <= 840 && menuReject.y + menuReject.height <= 840, 'decisions remain visible with menu open');
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('button', { name: '1 hour', exact: true }).count(), 0);
        assert.equal(await allow.count(), 1, 'Escape closes the menu before the signing sheet');
        await page.getByRole('button', { name: 'Only once', exact: true }).click();
        await page.getByRole('button', { name: '1 hour', exact: true }).click();
        await page.waitForTimeout(300);
        if (process.env.NAPPLET_SIGNING_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${screenshot}-timed.png` });
        await reject.click();
        await page.waitForFunction(() => document.title.includes('deny-1h'));
        await page.getByRole('button', { name: 'More information', exact: true }).click();
        await page.getByText('wss://relay.example/', { exact: true }).waitFor();
        assert((await page.locator('body').innerText()).includes('"kind": 30078'));
        if (process.env.NAPPLET_SIGNING_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${screenshot}-json.png` });
        const json = page.getByText(/\"pubkey\":.*|\"kind\": 30078/).last();
        await assertNotSelectable(json);
        await assertNotSelectable(page.getByText('wss://relay.example/', { exact: true }));
        await page.getByRole('button', { name: 'Copy', exact: true }).click();
        await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
        const copiedEvent = await page.evaluate(() => JSON.parse(window.copiedEvent));
        assert.equal(copiedEvent.kind, 30078);
        assert.deepEqual(JSON.parse(copiedEvent.content), { score: 1280, level: 4, lives: 3 });
        await allow.click();
        await page.waitForFunction(() => document.title.includes('allow-1h'));
      }
      await page.goto(`${address}/?scenario=auth`);
      await page.getByText('relay.example', { exact: true }).waitFor();
      assert.equal(await page.getByText('game-progress', { exact: true }).count(), 0);
      await page.getByText('Kind 22242', { exact: true }).waitFor();
      assert.equal(await page.getByText(/^d:/).count(), 0);
      await assertNotSelectable(page.getByText('relay.example', { exact: true }));
      await page.goto(`${address}/?scenario=raw`);
      await assertNotSelectable(page.getByText('{"score":1280,"level":4,"lives":3}', { exact: true }));
      await page.goto(`${address}/?scenario=scroll`);
      await page.getByRole('button', { name: 'More information', exact: true }).click();
      const heading = page.getByText('Publish application data', { exact: true });
      const jsonBlock = page.getByText(/\"kind\": 30078/).last();
      const scrollBody = await jsonBlock.evaluateHandle((node) => {
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          if (parent.scrollHeight > parent.clientHeight + 10 && ['auto', 'scroll'].includes(getComputedStyle(parent).overflowY)) return parent;
        }
        throw new Error('Scrollable sheet body not found');
      });
      await scrollBody.evaluate((node) => { node.scrollTop = 80; node.dispatchEvent(new Event('scroll')); });
      await page.waitForTimeout(300);
      const resting = await heading.boundingBox();
      const viewport = await scrollBody.asElement().boundingBox();
      const start = { x: viewport.x + viewport.width - 12, y: viewport.y + 80 };
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.mouse.move(start.x, start.y + 40, { steps: 4 });
      await scrollBody.evaluate((node) => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
      await page.mouse.move(start.x, start.y + 100, { steps: 6 });
      const duringScroll = await heading.boundingBox();
      assert(Math.abs(duringScroll.y - resting.y) < 1, 'a scroll reaching the top must not move the sheet');
      await page.mouse.up();
      await page.waitForTimeout(250);
      const afterScroll = await heading.boundingBox();
      assert(Math.abs(afterScroll.y - resting.y) < 1, 'scroll release must not bounce or dismiss the sheet');
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.mouse.move(start.x, start.y + 60, { steps: 8 });
      const freshDrag = await heading.boundingBox();
      assert(freshDrag.y > resting.y + 20, 'a fresh downward drag at the top must still move the sheet');
      await page.mouse.move(start.x, start.y + 180, { steps: 8 });
      await page.mouse.up();
      await heading.waitFor({ state: 'hidden' });
      await scrollBody.dispose();
      for (const theme of ['light', 'dark']) {
        await page.goto(`${address}/?scenario=menu&theme=${theme}`);
        await page.getByRole('button', { name: 'App menu', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByText('A small game for your account.', { exact: true }).waitFor();
        await page.waitForFunction(() => window.nappletVisible === false);
        await page.waitForFunction(() => {
          const button = [...document.querySelectorAll('[role="dialog"] [role="button"]')].find((node) => node.textContent === 'Share');
          if (!button) return false;
          const box = button.getBoundingClientRect();
          const previous = window.__menuY;
          window.__menuY = box.y;
          window.__menuStable = previous != null && Math.abs(previous - box.y) < 0.2 ? (window.__menuStable || 0) + 1 : 0;
          return window.__menuStable >= 4 && box.bottom <= innerHeight;
        });
        assert.equal(await page.getByRole('dialog').count(), 1);
        if (process.env.NAPPLET_SIGNING_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-app-menu.png` });
        await dialog.getByRole('button', { name: 'Settings', exact: true }).click();
        await dialog.getByText(/Kind 1/).waitFor();
        assert.equal(await page.getByRole('dialog').count(), 1, 'settings reuse the host sheet');
        if (process.env.NAPPLET_SIGNING_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-app-permissions.png` });
        await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();
        await dialog.getByText(/Kind 1/).waitFor({ state: 'hidden' });
        await dialog.getByRole('switch').click();
        await dialog.getByRole('button', { name: 'Save and reload', exact: true }).click();
        await page.waitForFunction(() => window.savedDomains?.includes('identity'));
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => window.nappletVisible === true);
        await page.getByRole('button', { name: 'App menu', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Reload', exact: true }).click();
        await page.waitForFunction(() => document.title === 'reloaded');
        await page.getByRole('button', { name: 'App menu', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Share', exact: true }).click();
        await page.getByRole('button', { name: 'Finish sharing', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.lastRoute), undefined, 'sharing stays on the mini-app route');
        await page.waitForFunction(() => window.nappletVisible === false);
        const draft = await page.evaluate(() => window.forwardDraft());
        assert.equal(draft.accountPubkey, 'a'.repeat(64));
        assert(draft.messages[0].content.includes('nostr:naddr1'));
        assert.equal(await page.getByRole('dialog').count(), 0, 'sharing starts only after closing the app sheet');
        await page.getByRole('button', { name: 'Finish sharing', exact: true }).click();
        await page.waitForFunction(() => window.nappletVisible === true);
        await page.getByRole('button', { name: 'App menu', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        await page.waitForFunction(() => document.title === 'closed');
      }
      await page.clock.install();
      await page.goto(`${address}/?scenario=timeout`);
      await page.getByRole('button', { name: 'Allow', exact: true }).waitFor();
      await page.waitForTimeout(350);
      await page.getByRole('button', { name: 'Only once', exact: true }).click();
      await page.getByRole('button', { name: '1 hour', exact: true }).waitFor();
      await page.getByText('Publish application data', { exact: true }).evaluate((heading) => {
        let card = heading.parentElement;
        while (card && !(card.clientWidth > 200 && parseFloat(getComputedStyle(card).borderTopLeftRadius) > 0)) card = card.parentElement;
        if (!card) throw new Error('Sheet card not found');
        window.__sheetExitFrames = [];
        const sample = () => {
          if (!card.isConnected) { window.__sheetExitFrames.push({ gone: true }); return; }
          const box = card.getBoundingClientRect();
          window.__sheetExitFrames.push({ top: box.top, height: box.height, content: card.textContent.includes('Arcade'),
            menu: [...document.querySelectorAll('[role="button"]')].some((node) => node.textContent === '1 hour') });
          requestAnimationFrame(sample);
        };
        sample();
      });
      await page.clock.fastForward(25000);
      await page.waitForFunction(() => window.__sheetExitFrames.some((frame) => frame.gone));
      const exitFrames = await page.evaluate(() => window.__sheetExitFrames.filter((frame) => !frame.gone));
      assert(exitFrames.some((frame) => frame.top > exitFrames[0].top + 10 && frame.top < 840), 'timeout dismissal visibly slides downward');
      assert(exitFrames.filter((frame) => frame.top > exitFrames[0].top + 10).every((frame) => !frame.menu), 'floating menus close when their sheet begins exiting');
      assert(exitFrames.every((frame) => Math.abs(frame.height - exitFrames[0].height) < 1 && frame.content), 'sheet content and geometry survive through the exit transition');
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  },
);
