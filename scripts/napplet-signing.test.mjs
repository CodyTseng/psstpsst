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
import { naddrEncode } from 'nostr-tools/nip19';

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
            '<style>html,body,#root{height:100%;margin:0}#root{display:flex}*{box-sizing:border-box}</style><div id="root"></div><script>if(new URLSearchParams(location.search).get("surface")!=="touch")window.psstpsstDesktop={system:{platform:new URLSearchParams(location.search).get("os")||"darwin"}}</script><script src="/gallery.js"></script>',
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
      const assertRuntimeHeader = async (surface='desktop') => {
        const size=surface==='touch'?40:36;
        const iconSize=surface==='touch'?24:20;
        for(const label of surface==='touch'?['Close','App menu']:['Close','Open in new window','App menu']) {
          const button=page.getByRole('button',{name:label,exact:true});
          await button.waitFor();
          const box=await button.boundingBox();
          assert.equal(box.width,size,`${label} uses the header control width`);
          assert.equal(box.height,size,`${label} uses the header control height`);
          const icon=button.locator('svg').first();
          assert.equal(Number(await icon.getAttribute('width')),iconSize);
          assert.equal(Number(await icon.getAttribute('height')),iconSize);
          assert.equal(Number(await icon.getAttribute('stroke-width')),1.5);
        }
      };
      const address = `http://127.0.0.1:${server.address().port}`;
      if (process.env.NAPPLET_MEMBERSHIP_ONLY === '1') {
        for (const theme of ['light', 'dark']) {
          await page.goto(`${address}/?scenario=explore-detail&detail-actions=1&theme=${theme}`);
          await page.getByRole('button', { name: 'Add app', exact: true }).click();
          await page.getByText('Added to My apps', { exact: true }).waitFor();
          await page.getByRole('button', { name: 'Remove app', exact: true }).waitFor();
          const more = page.getByRole('button', { name: 'More', exact: true });
          await more.click();
          const menu = page.getByRole('dialog');
          await menu.getByRole('button', { name: 'Remove app', exact: true }).click();
          await page.getByText('Removed from My apps', { exact: true }).waitFor();
          await more.click();
          await menu.getByRole('button', { name: 'Add app', exact: true }).click();
          await page.getByRole('button', { name: 'Remove app', exact: true }).click();
          await page.getByText('Removed from My apps', { exact: true }).waitFor();
          await page.goto(`${address}/?scenario=explore-discovery&theme=${theme}`);
          await page.getByText('No apps added yet', { exact: true }).waitFor();
          await page.getByRole('button', { name: 'Discover', exact: true }).click();
          await page.getByText('Photo Gallery', { exact: true }).waitFor();
          await page.getByRole('tab', { name: 'My apps', exact: true }).click();
          await page.getByText('No apps added yet', { exact: true }).waitFor();
          await page.goto(`${address}/?scenario=explore-discovery&list-actions=1&saved-apps=1&theme=${theme}`);
          await page.getByRole('tab', { name: 'My apps', exact: true }).click();
          await page.getByRole('tab', { name: 'Discover', exact: true }).click();
          await page.getByText('Photo Gallery', { exact: true }).click({ button: 'right' });
          await page.getByRole('button', { name: 'Add app', exact: true }).click();
          await page.waitForFunction(() => document.title === 'move:Photo Gallery:1');
          await page.getByRole('tab', { name: 'My apps', exact: true }).click();
          await page.getByText('Photo Gallery', { exact: true }).waitFor();
        }
        assert.deepEqual(errors, []);
        return;
      }

      for (const theme of ['light', 'dark']) {
        for (const duration of ['Always', '1 hour']) {
          await page.goto(`${address}/?scenario=queued-approvals&theme=${theme}`);
          await page.getByRole('button', { name: 'Only once', exact: true }).click();
          await page.getByRole('button', { name: duration, exact: true }).click();
          await page.getByRole('button', { name: 'Allow', exact: true }).click();
          await page.waitForFunction(() => window.approvalQueue?.complete);
          const state = await page.evaluate(() => window.approvalQueue);
          assert.equal(state.presentations.filter(Boolean).length, 1, 'matching permissions present exactly one sheet');
          assert.deepEqual(state.results, ['fulfilled', 'fulfilled', 'fulfilled']);
          assert.equal(await page.getByRole('dialog').count(), 0, 'automatic approvals finish after sheet exit');
        }
        await page.goto(`${address}/?scenario=queued-approvals&distinct=1&theme=${theme}`);
        await page.getByRole('button', { name: 'Only once', exact: true }).click();
        await page.getByRole('button', { name: 'Always', exact: true }).click();
        await page.getByRole('button', { name: 'Allow', exact: true }).click();
        await page.getByText('Encrypt data', { exact: true }).waitFor();
        const transitions = await page.evaluate(() => window.approvalQueue.presentations);
        assert.equal(transitions.filter(Boolean).length, 2, 'a different method still needs review');
        assert.equal(transitions[1], null, 'the previous sheet closes before a different request is presented');
        await page.getByRole('button', { name: 'Allow', exact: true }).click();
        await page.waitForFunction(() => window.approvalQueue?.complete);
        await page.goto(`${address}/?scenario=queued-approvals&underlay=1&theme=${theme}`);
        await page.getByRole('button', { name: 'Only once', exact: true }).click();
        await page.getByRole('button', { name: 'Always', exact: true }).click();
        await page.getByRole('button', { name: 'Allow', exact: true }).click();
        await page.waitForFunction(() => window.approvalQueue?.complete);
        assert.equal((await page.evaluate(() => window.approvalQueue.presentations)).filter(Boolean).length, 1,
          'a host configuration panel does not prevent the approval from dismissing');
      }
      if (process.env.NAPPLET_SIGNING_SCENARIO === 'queued-approvals') {
        assert.deepEqual(errors, []);
        return;
      }
      for (const os of ['darwin', 'win32', 'linux']) {
        for (const theme of ['light', 'dark']) {
          await page.setViewportSize({ width: 900, height: 700 });
          await page.goto(`${address}/?scenario=window&os=${os}&theme=${theme}`);
          const bar = page.getByTestId('desktop-window-titlebar');
          const more = page.getByRole('button', { name: 'App menu', exact: true });
          await more.waitFor();
          assert.equal(await bar.count(), 1);
          assert.equal(await page.getByText('Arcade', { exact: true }).count(), 1);
          assert.equal(await page.getByRole('button', { name: 'Close', exact: true }).count(), 0);
          assert.equal(await page.getByRole('button', { name: 'Open in new window', exact: true }).count(), 0);
          const bounds = await more.boundingBox();
          assert(bounds.y >= 0 && bounds.y + bounds.height <= 44, 'app actions stay inside the native title strip');
          if (os !== 'darwin') assert(bounds.x + bounds.width <= 900 - 144, 'menu reserves the native caption controls at the right');
          await more.click();
          const sheet = page.getByRole('dialog');
          await sheet.getByText('A small game for your account.', { exact: true }).waitFor();
          assert.equal(await sheet.getByRole('button', { name: 'Open in new window', exact: true }).count(), 0);
          assert.equal(await page.title(), 'Arcade');
        }
      }
      await page.setViewportSize({ width: 390, height: 840 });
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
      const checkAppInfoSpacing = async () => {
        const metrics = await page.getByTestId('napplet-info').evaluate((node) => {
          const blocks = [...node.children].map((child) => child.getBoundingClientRect());
          const access = node.lastElementChild;
          const title = access.firstElementChild.getBoundingClientRect();
          const list = access.lastElementChild.getBoundingClientRect();
          return { gaps: blocks.slice(1).map((rect, index) => rect.top - blocks[index].bottom),
            publisherHeight: blocks[1].height, permissionGap: list.top - title.bottom };
        });
        assert(metrics.gaps.every((gap) => Math.abs(gap - 16) < 1),
          'identity, publisher, description and permissions have consistent 16px gaps');
        assert.equal(metrics.publisherHeight, 24, 'publisher fits its avatar instead of adding row whitespace');
        assert.equal(metrics.permissionGap, 12, 'permissions use the shared heading-to-list spacing');
      };

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
      for (const theme of ['light', 'dark']) {
        await page.goto(`${address}/?scenario=upload&surface=touch&theme=${theme}`);
        const file = page.getByRole('dialog');
        const approve = file.getByRole('button', { name: 'Allow', exact: true });
        await approve.click({ trial: true });
        assert.equal(await file.getByText('report.pdf', { exact: true }).count(), 1);
        assert.equal(await file.getByText('storage.example', { exact: true }).count(), 1);
        assert.equal(await file.getByText('Kind 24242', { exact: true }).count(), 0);
        assert.equal(await file.getByRole('button', { name: 'More information', exact: true }).count(), 0);
        assert.equal(await file.getByText('Remember this decision', { exact: true }).count(), 0);
        if (process.env.NAPPLET_SIGNING_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-upload.png` });
        await file.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(JSON.parse(await page.title()).value, false);
      }
      await page.goto(`${address}/?scenario=raw`);
      await assertNotSelectable(page.getByText('{"score":1280,"level":4,"lives":3}', { exact: true }));
      await page.goto(`${address}/?scenario=scroll`);
      await page.getByRole('button', { name: 'More information', exact: true }).click();
      const heading = page.getByText('Publish application data', { exact: true });
      const jsonBlock = page.getByText(/\"kind\": 30078/).last();
      await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] *')].some(node =>
        node.scrollHeight > node.clientHeight + 10 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY)));
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
        await assertRuntimeHeader();
        await page.getByRole('button', { name: 'Open in new window', exact: true }).click();
        await page.waitForFunction(() => document.title === 'New window 35129:publisher:arcade');
        await page.getByRole('button', { name: 'App menu', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByText('A small game for your account.', { exact: true }).waitFor({ timeout: 5000 }).catch(async (error) => {
          throw new Error(`${error.message}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`);
        });
        await checkAppInfoSpacing();
        // Input is blocked immediately, including while a renderer preview is prepared.
        await page.waitForFunction(() => window.nappletInputEnabled === false);
        await page.waitForFunction(() => {
          const button = [...document.querySelectorAll('[role="dialog"] [role="button"]')].find((node) => node.getAttribute('aria-label') === 'Share');
          if (!button) return false;
          const box = button.getBoundingClientRect();
          const previous = window.__menuY;
          window.__menuY = box.y;
          window.__menuStable = previous != null && Math.abs(previous - box.y) < 0.2 ? (window.__menuStable || 0) + 1 : 0;
          return window.__menuStable >= 4 && box.bottom <= innerHeight;
        });
        assert.equal(await page.getByRole('dialog').count(), 1);
        let previousX = -1;
        for (const label of ['Share', 'Permissions', 'Open in new window', 'Reload']) {
          const button = dialog.getByRole('button', { name: label, exact: true });
          const box = await button.boundingBox();
          const caption = await dialog.getByText(label === 'Open in new window' ? 'New window' : label, { exact: true }).boundingBox();
          assert(Math.abs(box.width - box.height) < 1, 'menu icons use square controls');
          assert(box.x > previousX, 'actions retain their defined order');
          assert(caption.y >= box.y + box.height, 'action captions sit below the icon control');
          assert(box.width >= 64, 'menu controls retain their enlarged touch target');
          assert(await dialog.getByText(label === 'Open in new window' ? 'New window' : label, { exact: true }).evaluate((node) =>
            node.clientHeight <= parseFloat(getComputedStyle(node).lineHeight) + 1 && node.scrollWidth <= node.clientWidth + 1),
          'captions stay on one line without truncation');
          previousX = box.x;
        }
        if (process.env.NAPPLET_SIGNING_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-app-menu.png` });
        await page.setViewportSize({ width: 250, height: 840 });
        const rail = await dialog.getByRole('button', { name: 'Share', exact: true }).evaluateHandle((node) => {
          for (let parent = node.parentElement; parent; parent = parent.parentElement) {
            if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth) return parent;
          }
          throw new Error('Overflowing action rail not found');
        });
        await rail.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
        assert(await rail.evaluate((node) => node.scrollLeft > 0), 'overflow actions can be scrolled into view');
        await rail.dispose();
        await page.setViewportSize({ width: 390, height: 840 });
        await dialog.getByRole('button', { name: 'Open in new window', exact: true }).click();
        await page.getByRole('dialog').waitFor({state:'hidden'});
        await page.waitForFunction(() => document.title === 'New window 35129:publisher:arcade');
        await page.getByRole('button', { name: 'App menu', exact: true }).click();
        await dialog.getByRole('button', { name: 'Permissions', exact: true }).click();
        await dialog.getByText('Signing rules', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.lastRoute), undefined, 'runtime permissions stay inside the app sheet');
        assert.equal(await page.evaluate(() => window.nappletVisible), false, 'the container remains covered while changing sheet pages');
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
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
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${address}/?scenario=capabilities&theme=${theme}`);
        const consent = page.getByRole('dialog');
        await consent.getByText('Required access', { exact: true }).waitFor();
        assert.equal(await consent.getByText('Publisher', { exact: true }).count(), 1);
        assert.equal(await consent.getByText('A small game for your account.', { exact: true }).count(), 1);
        assert.equal(await consent.getByLabel('Signing account: Alice', { exact: true }).count(), 0,
          'launch consent omits the account avatar');
        assert.equal(await consent.getByText('Host environment', { exact: true }).count(), 0,
          'required access matches the details list without internal shell metadata');
        assert.equal(await consent.getByText('Optional access', { exact: true }).count(), 0);
        assert.equal(await consent.getByText('App storage', { exact: true }).count(), 0,
          'launch consent omits optional capability controls');
        const grant = consent.getByRole('button', { name: 'Allow', exact: true });
        await grant.click({ trial: true });
        await checkAppInfoSpacing();
        const grantBox = await grant.boundingBox();
        const cancelBox = await consent.getByRole('button', { name: 'Cancel', exact: true }).boundingBox();
        assert(Math.abs(grantBox.y - cancelBox.y) < 1 && cancelBox.x < grantBox.x,
          'Cancel and Allow share a horizontal action row');
        if (process.env.NAPPLET_SIGNING_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-capabilities.png` });
        await grant.click();
        assert.equal(JSON.parse(await page.title()).value, 'domains:[]', 'launch consent grants only required access');
        for(const kind of ['napp','nsite','website']) {
          await page.goto(`${address}/?scenario=application-consent&kind=${kind}&theme=${theme}`);
          const sheet=page.getByRole('dialog');
          const allow=sheet.getByRole('button',{name:'Allow',exact:true});
          await allow.click({trial:true});
          if(kind==='napp')await checkAppInfoSpacing();
          else assert.equal(await sheet.getByTestId('application-identity').count(),1);
          assert.equal(await sheet.getByText('Signing account',{exact:true}).count(),1);
          const allowBox=await allow.boundingBox(),cancelBox=await sheet.getByRole('button',{name:'Cancel',exact:true}).boundingBox();
          assert(Math.abs(allowBox.y-cancelBox.y)<1&&cancelBox.x<allowBox.x);
          if(kind==='website')assert.equal(await sheet.getByText('https://example.com',{exact:true}).count(),1);
          if(process.env.NAPPLET_SIGNING_SCREENSHOTS)await page.screenshot({path:`${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-${kind}-consent.png`});
          await allow.click();assert.equal(JSON.parse(await page.title()).value,'allow');
        }
        await page.goto(`${address}/?scenario=detail&theme=${theme}&needs-consent=1`);
        const allow = page.getByRole('button', { name: 'Open', exact: true });
        await allow.waitFor();
        assert.equal(await page.getByRole('dialog').count(), 0);
        assert.equal(await page.evaluate(() => window.reviewedRequired), undefined, 'viewing details does not grant consent');
        if (process.env.NAPPLET_SIGNING_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-detail-consent.png` });
        await allow.click();
        const reviewed = await page.evaluate(() => window.reviewedRequired);
        assert(reviewed.includes('shell') && reviewed.includes('storage'));
        assert(!reviewed.includes('upload'), 'details consent does not enable optional access');
        assert.equal(await page.getByRole('dialog').count(), 0, 'details consent does not open a second dialog');
      }
      for (const theme of ['light', 'dark']) {
        await page.goto(`${address}/?scenario=detail&surface=touch&theme=${theme}`);
        await page.getByRole('button', { name: 'Open', exact: true }).waitFor();
        await checkAppInfoSpacing();
        const publisher = page.getByText('Arjen', { exact: true });
        const publisherBox = await publisher.boundingBox();
        const appName = await page.getByText('Composer', { exact: true }).last().boundingBox();
        const publisherLabel = await page.getByText('Publisher', { exact: true }).boundingBox();
        assert(publisherLabel.y >= appName.y + appName.height, 'publisher has a separate labelled row below the application heading');
        const description = await page.getByText('Compose and publish posts with your Nostr account.', { exact: true }).boundingBox();
        assert(description.y > publisherBox.y + publisherBox.height, 'publisher appears before the application description');
        assert(Math.abs((publisherBox.y + publisherBox.height / 2) - (publisherLabel.y + publisherLabel.height / 2)) < 1,
          'publisher identity aligns with its label');
        await page.getByText('Publisher', { exact: true }).click();
        assert.equal(await page.evaluate(() => window.lastRoute), `/profile/${'b'.repeat(64)}`);
        const text = await page.locator('body').innerText();
        assert(!text.includes('Verified version') && !text.includes('c'.repeat(64)), 'app information omits protocol hashes');
        await page.getByText('Required access', { exact: true }).waitFor();
        assert(text.includes('Public account information'), 'required access is expanded on the information page');
        assert(!text.includes('Upload files'), 'optional access is omitted from app details');
        assert(!text.includes('Reset permissions') && !text.includes('Clear defaults'), 'permissions actions live on the management page');
        for (const label of ['Permissions', 'Check updates', 'Update', 'Restore version', 'Import data']) {
          assert.equal(await page.getByText(label, { exact: true }).count(), 0, 'app details omit permission and maintenance actions');
        }
        const open = page.getByRole('button', { name: 'Open', exact: true });
        const openBox = await open.boundingBox();
        assert(openBox.y > 700 && openBox.y + openBox.height <= 840, 'Open stays above the bottom safe area');
        if (process.env.NAPPLET_SIGNING_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-app-detail.png` });
        await page.getByText('Publisher', { exact: true }).hover();
        if (process.env.NAPPLET_SIGNING_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-publisher-hover.png` });
        await page.getByText('Required access', { exact: true }).evaluate((node) => {
          for (let parent = node.parentElement; parent; parent = parent.parentElement) {
            if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) {
              parent.scrollTop = parent.scrollHeight; return;
            }
          }
          throw new Error('Scrollable application information not found');
        });
        assert(Math.abs((await open.boundingBox()).y - openBox.y) < 1, 'scrolling permissions does not move Open');
        await page.goto(`${address}/?scenario=detail&surface=touch&theme=${theme}&uninstalled=1`);
        await page.getByRole('button', { name: 'Open', exact: true }).waitFor();
        assert.equal(await page.locator('body').innerText(), text, 'installed and first-time apps show the same details');
        await page.goto(`${address}/?scenario=permissions&surface=touch&theme=${theme}`);
        await page.getByText(/Kind 1/).waitFor();
        const heading = await page.getByText('Signing rules', { exact: true }).boundingBox();
        assert.equal(await page.getByRole('img', { name: /^Signing account:/ }).count(), 0, 'permission management omits the account avatar');
        for (const label of ['Recent permission decisions', 'Required access']) {
          const disclosure = await page.getByRole('button', { name: label, exact: true }).boundingBox();
          assert(Math.abs(disclosure.x - heading.x) < 1, 'disclosures align with section headings');
        }
        const metadata = page.getByText('Kind 1 · Always', { exact: true });
        assert(await metadata.evaluate((node) => node.clientHeight <= parseFloat(getComputedStyle(node).lineHeight) + 1), 'ordinary permission metadata occupies one line');
        const allow = page.getByText('Allow', { exact: true }), deny = page.getByText('Reject', { exact: true });
        const allowColor = await allow.evaluate((node) => getComputedStyle(node).color);
        const denyColor = await deny.evaluate((node) => getComputedStyle(node).color);
        assert.notEqual(allowColor, denyColor, 'allow and reject have distinct semantic colours');
        const reset = page.getByRole('button', { name: 'Reset permissions', exact: true });
        assert.equal(await page.getByText('Reset permissions', { exact: true }).evaluate((node) => getComputedStyle(node).color), denyColor, 'reset uses the shared danger text colour');
        const denyBox = await deny.boundingBox(), titleBox = await page.getByText('Publish a reaction', { exact: true }).boundingBox();
        const kindBox = await page.getByText('Kind 7 · Always', { exact: true }).boundingBox();
        assert(denyBox.x >= titleBox.x + titleBox.width && Math.abs(denyBox.y + denyBox.height / 2 - titleBox.y - titleBox.height / 2) < 2, 'explicit status follows the permission title');
        assert(Math.abs(kindBox.x - titleBox.x) < 1, 'metadata aligns with the permission title');
        assert.equal(await page.getByRole('button', { name: 'Revoke', exact: true }).count(), 0, 'rules have one editing target');
        if (process.env.NAPPLET_SIGNING_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-permissions-page.png` });
        await page.setViewportSize({ width: 280, height: 840 });
        const narrowTitle = await page.getByText('Publish a reaction', { exact: true }).boundingBox();
        const narrowStatus = await deny.boundingBox();
        assert(narrowTitle.x + narrowTitle.width <= narrowStatus.x, 'long titles yield space to status');
        assert(await deny.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), 'the complete decision remains readable on narrow screens');
        await page.setViewportSize({ width: 390, height: 840 });
        await page.evaluate(() => { window.confirmationResult = false; });
        await reset.click();
        await page.waitForFunction(() => window.lastConfirmation?.destructive === true);
        assert.notEqual(await page.title(), 'permissions-reset', 'cancelling the confirmation leaves permissions intact');
        await metadata.waitFor();
        await page.evaluate(() => { window.confirmationResult = true; });
        await page.getByText('Publish a post', { exact: true }).click();
        const editor = page.getByRole('dialog');
        await editor.getByRole('radio', { name: 'Ask every time', exact: true }).click();
        await editor.getByRole('button', { name: 'Save', exact: true }).click();
        await editor.waitFor({ state: 'hidden' });
        await page.getByText('Ask every time', { exact: true }).waitFor();
        await page.getByText('Kind 1', { exact: true }).waitFor();
        assert.equal(await page.getByText('Publish a post', { exact: true }).count(), 1, 'cleared rules stay visible for this visit');
        if (process.env.NAPPLET_SIGNING_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-permissions-asked.png` });
        await page.getByText('Publish a post', { exact: true }).click();
        await editor.getByRole('radio', { name: 'Automatically allow', exact: true }).click();
        await editor.getByText('Duration', { exact: true }).click();
        await page.getByText('10 min', { exact: true }).click();
        await editor.getByText('10 min', { exact: true }).waitFor();
        if (process.env.NAPPLET_SIGNING_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-rule-editor.png` });
        await editor.getByRole('button', { name: 'Save', exact: true }).click();
        await editor.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => window.savedRuleChange?.duration === 'timed');
        assert(await page.evaluate(() => Math.abs(window.savedRuleChange.expiresAt - Date.now() - 600000) < 5000));
        await page.getByText('Publish a post', { exact: true }).click();
        await editor.getByRole('radio', { name: 'Automatically reject', exact: true }).click();
        await editor.getByRole('button', { name: 'Save', exact: true }).click();
        await editor.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => window.savedRuleChange?.decision === 'deny');
        await page.getByText('Publish a post', { exact: true }).click();
        await editor.getByRole('radio', { name: 'Ask every time', exact: true }).click();
        await editor.getByRole('button', { name: 'Save', exact: true }).click();
        await editor.waitFor({ state: 'hidden' });
        await page.getByText('Ask every time', { exact: true }).waitFor();
        await page.goto(`${address}/?scenario=permissions&surface=touch&theme=${theme}`);
        await page.getByText('Publish a reaction', { exact: true }).waitFor();
        assert.equal(await page.getByText('Publish a post', { exact: true }).count(), 0, 'asking rows disappear on the next visit');
        await page.getByRole('switch').click();
        await page.getByRole('button', { name: 'Save and reload', exact: true }).click();
        await page.waitForFunction(() => window.savedDomains?.includes('upload'));
        await page.getByText('Reset permissions', { exact: true }).click();
        await page.getByText(/Kind 1/).waitFor({ state: 'hidden' });
        assert.equal(await page.getByText('Clear defaults', { exact: true }).count(), 0, 'default handlers are cleared automatically on removal');
      }
      await page.goto(`${address}/?scenario=detail&surface=touch&uninstalled=1&empty=1`);
      await page.getByRole('button', { name: 'Open', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Install', exact: true }).count(), 0, 'first-time apps also use Open');
      assert.equal(await page.getByText('Check updates', { exact: true }).count(), 0);
      await page.goto(`${address}/?scenario=detail&surface=touch&uninstalled=1&long=1`);
      await page.getByRole('button', { name: 'Open', exact: true }).waitFor();
      const longOpen = await page.getByRole('button', { name: 'Open', exact: true }).boundingBox();
      assert(longOpen.y > 700 && longOpen.y + longOpen.height <= 840, 'long descriptions cannot push Open offscreen');
      await page.goto(`${address}/?scenario=permissions&surface=touch&uninstalled=1`);
      await page.getByText('Requested access', { exact: true }).waitFor();
      assert.equal(await page.getByText('Reset permissions', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('switch').count(), 0, 'uninstalled access is informational');
      for (const surface of ['pointer', 'touch']) {
        await page.goto(`${address}/?scenario=explore-discovery&favorites-drag=1&surface=${surface}`);
        await page.getByText('Notes', { exact: true }).waitFor();
        const shortcuts = page.locator('[data-testid^="desktop-app-"]');
        const artwork = shortcuts.nth(0).locator('img');
        await artwork.waitFor();
        assert.equal(await artwork.evaluate(node => node.draggable), false, 'artwork cannot steal sorting into native image drag');
        const source = await artwork.boundingBox();
        const destination = await shortcuts.nth(1).boundingBox();
        await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(550);
        await page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height / 2, { steps: 12 });
        await page.mouse.up();
        await page.waitForFunction(() => document.title === 'move:Notes:1');
        assert.equal(await shortcuts.nth(0).getByText('Photo Gallery', { exact: true }).count(), 1,
          'My apps without recent previews still supports drag sorting');
      }
      for (const theme of ['light', 'dark']) {
        await page.goto(`${address}/?scenario=explore-discovery&list-actions=1&saved-apps=1&theme=${theme}`);
        await page.getByRole('tab', { name: 'Discover', exact: true }).click();
        await page.getByText('Photo Gallery', { exact: true }).waitFor();
        const first = await page.getByText('Notes', { exact: true }).boundingBox();
        const second = await page.getByText('Photo Gallery', { exact: true }).boundingBox();
        await page.mouse.click(first.x + 130, first.y + 5, { button: 'right' });
        await page.getByRole('button', { name: 'Remove app', exact: true }).waitFor();
        await page.mouse.click(20, second.y + 5, { button: 'right' });
        await page.getByRole('button', { name: 'Add app', exact: true }).click();
        await page.waitForFunction(() => document.title === 'move:Photo Gallery:1');
      }
      for (const theme of ['light', 'dark']) {
        await page.goto(`${address}/?scenario=explore-discovery&list-actions=1&saved-apps=1&theme=${theme}`);
        await page.getByRole('tab', { name: 'Discover', exact: true }).click();
        await page.getByText('Photo Gallery', { exact: true }).waitFor();
        const notes = page.getByText('Notes', { exact: true });
        await notes.waitFor();
        await notes.click({ button: 'right' });
        await page.getByRole('button', { name: 'Remove app', exact: true }).click();
        await page.waitForFunction(() => document.title === 'move:Notes:null');
        const bounds = await notes.boundingBox();
        await page.mouse.move(bounds.x + 10, bounds.y + 5);
        await page.mouse.down();
        await page.waitForTimeout(650);
        await page.mouse.up();
        await page.getByRole('button', { name: 'Add app', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Remove from history', exact: true }).count(), 0,
          'discovery menus do not remove history');
        await page.getByRole('button', { name: 'Add app', exact: true }).click();
        await page.waitForFunction(() => document.title === 'move:Notes:0');
        await page.getByRole('tab', { name: 'My apps', exact: true }).click();
        await page.getByText('Notes', { exact: true }).waitFor();
      }
      for(const theme of ['light','dark']) {
        await page.goto(`${address}/?scenario=explore-discovery&theme=${theme}`);
        await page.getByText('No apps added yet',{exact:true}).waitFor({timeout:5000}).catch(async error=>{throw new Error(`${error.message}\n${JSON.stringify(errors)}\n${await page.locator('body').innerText()}`);});
        await page.getByRole('tab',{name:'Discover',exact:true}).click();
        await page.getByText('Photo Gallery',{exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:'Add app',exact:true}).count(),0);
        assert.equal(await page.getByText('Alice',{exact:true}).count(),2,'each app shows its publisher');
        for(const format of ['napplet','napp','nsite'])assert.equal(await page.getByText(format,{exact:true}).count(),0,'format badges stay out of app rows');
        assert.equal(await page.getByTestId('application-format-border').count(),0,'application artwork has no format border');
        assert.equal(await page.getByText('A useful application for your Nostr account.',{exact:true}).count(),2,'each row includes its description');
        const appName=await page.getByText('Notes',{exact:true}).boundingBox();
        const appIcon=await page.getByTestId('application-icon').first().boundingBox();
        assert.equal(appIcon.width,40,'application artwork matches the title and description height');
        assert(Math.abs(appIcon.y-appName.y)<=1,'application artwork aligns with the title top');
        const publisher=await page.getByText('Alice',{exact:true}).first().boundingBox();
        assert(publisher.y>=appName.y+appName.height,'publisher appears below the application name');
        const publisherAvatar=await page.getByTestId('discovery-publisher').first().locator(':scope > div').first().boundingBox();
        assert(publisherAvatar.width===16 && publisherAvatar.height===16,'publisher uses a compact avatar');
        assert(publisher.x>=publisherAvatar.x+publisherAvatar.width,'publisher name follows the avatar');
        if(process.env.NAPPLET_SIGNING_SCREENSHOTS)await page.screenshot({path:`${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-discovery.png`});
        const search=page.getByPlaceholder('Search apps or enter an address',{exact:true});
        await search.fill('photo');
        await page.getByText('Notes',{exact:true}).waitFor({state:'hidden'});
        assert.equal(await page.getByText('Photo Gallery',{exact:true}).count(),1);
        await search.fill('Alice');
        await page.getByText('Notes',{exact:true}).waitFor();
        assert.equal(await page.getByText('Photo Gallery',{exact:true}).count(),1,'author names participate in local search');
        await search.fill(naddrEncode({kind:35130,pubkey:'b'.repeat(64),identifier:'Notes',relays:['wss://unused.example/']}));
        await page.getByText('Photo Gallery',{exact:true}).waitFor({state:'hidden'});
        assert.equal(await page.getByText('Notes',{exact:true}).count(),1,'a local naddr match ignores differing relay hints');
        await search.fill('https://example.com/page');
        await page.getByText('example.com',{exact:true}).waitFor();
        await search.fill('');
        await page.getByText('Notes',{exact:true}).waitFor();
        await page.getByRole('tab',{name:'My apps',exact:true}).click();
        await page.getByText('No apps added yet',{exact:true}).waitFor();
        assert.equal(await page.getByText('Recently visited',{exact:true}).count(),0,'browsing discovery never creates a visit');
        if(process.env.NAPPLET_SIGNING_SCREENSHOTS)await page.screenshot({path:`${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-favorites.png`});
        await page.getByRole('tab',{name:'Discover',exact:true}).click();
        await page.getByText('Photo Gallery',{exact:true}).click();
        assert.match(await page.title(),/^\/explore-details\?key=/);
      }
      for(const theme of ['light','dark']) {
        await page.goto(`${address}/?scenario=explore-discovery&theme=${theme}&long-catalog=1`);
        await page.getByRole('tab',{name:'Discover',exact:true}).click();
        await page.getByText('Photo Gallery',{exact:true}).waitFor();
        const tabsBefore=await page.getByRole('tablist').boundingBox();
        await page.getByText('Photo Gallery',{exact:true}).evaluate(node=>{
          let viewport=node.parentElement;
          while(viewport && !(viewport.scrollHeight>viewport.clientHeight && ['auto','scroll'].includes(getComputedStyle(viewport).overflowY)))viewport=viewport.parentElement;
          if(!viewport)throw new Error('Catalogue scroll viewport not found');
          viewport.scrollTop=180;
        });
        await page.waitForFunction(()=>{
          const tabs=document.querySelector('[role="tablist"]');
          let header=tabs.parentElement;
          while(header && !(header.querySelector('input[placeholder="Search apps or enter an address"]')&&[...header.children].some(child=>getComputedStyle(child).pointerEvents==='none'&&child.getBoundingClientRect().height<=1)))header=header.parentElement;
          return !!header;
        });
        const tabsAfter=await page.getByRole('tablist').boundingBox();
        assert.equal(tabsAfter.y,tabsBefore.y,'tabs stay inside the fixed title bar');
        const boundary=await page.getByRole('tablist').evaluate(tabs=>{
          let header=tabs.parentElement;
          while(header && !(header.querySelector('input[placeholder="Search apps or enter an address"]')&&[...header.children].some(child=>getComputedStyle(child).pointerEvents==='none'&&child.getBoundingClientRect().height<=1)))header=header.parentElement;
          const divider=[...header.children].find(child=>getComputedStyle(child).pointerEvents==='none'&&child.getBoundingClientRect().height<=1);
          const search=header.querySelector('input[placeholder="Search apps or enter an address"]');
          return {searchBottom:search.getBoundingClientRect().bottom,dividerTop:divider.getBoundingClientRect().top,headerBottom:header.getBoundingClientRect().bottom};
        });
        assert(boundary.dividerTop>=boundary.searchBottom,'header divider sits below the shared search field');
        assert(Math.abs(boundary.headerBottom-boundary.dividerTop)<=1,'divider uses the complete header boundary');
        if(process.env.NAPPLET_SIGNING_SCREENSHOTS)await page.screenshot({path:`${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-discovery-scrolled.png`});
      }
      for (const theme of ['light', 'dark']) {
        await page.goto(`${address}/?scenario=explore-detail&detail-actions=1&theme=${theme}`);
        const more = page.getByRole('button', { name: 'More', exact: true });
        await more.click();
        await page.getByRole('button', { name: 'Permissions', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Remove from history', exact: true }).count(), 0);
        await page.getByRole('dialog').getByRole('button', { name: 'Add app', exact: true }).click();
        await page.getByText('Added to My apps', { exact: true }).waitFor();
        await more.click();
        assert.equal(await page.getByRole('button', { name: 'Remove from history', exact: true }).count(), 0);
        await page.getByRole('dialog').getByRole('button', { name: 'Remove app', exact: true }).click();
        await page.getByText('Removed from My apps', { exact: true }).waitFor();
      }
      for(const theme of ['light','dark'])for(const kind of ['napp','nsite','website']) {
        await page.goto(`${address}/?scenario=explore-detail&kind=${kind}&theme=${theme}&needs-consent=1`);
        const open=page.getByRole('button',{name:'Open',exact:true});await open.click({trial:true});
        assert.equal(await page.getByTestId('napplet-info').count(),1);
        assert.equal(await page.getByRole('button',{name:'Share',exact:true}).count(),0);
        assert.equal(await page.getByText('Signing rules',{exact:true}).count(),0);
        assert.equal(await page.getByText('Reset permissions',{exact:true}).count(),0);
        const openBox=await open.boundingBox();assert(openBox.y>700&&openBox.y+openBox.height<=840,'every format keeps Open in the same bottom footer');
        if(kind==='napp')await checkAppInfoSpacing();
        if(process.env.NAPPLET_SIGNING_SCREENSHOTS)await page.screenshot({path:`${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-${kind}-details.png`});
        await open.click();
        assert.deepEqual(await page.evaluate(()=>window.reviewedRequired),kind==='napp'?['identity','relay','storage']:[]);
        assert.equal((await page.evaluate(()=>window.lastRoute)).pathname,'/explore-run');
        await page.goto(`${address}/?scenario=explore-permissions&kind=${kind}&theme=${theme}`);
        await page.getByRole('button',{name:'Reset permissions',exact:true}).waitFor();
        assert.equal(await page.getByText('Signing rules',{exact:true}).count(),1);
        if(process.env.NAPPLET_SIGNING_SCREENSHOTS)await page.screenshot({path:`${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-${kind}-permissions.png`});
        await page.goto(`${address}/?scenario=explore-menu&kind=${kind}&theme=${theme}`);
        await assertRuntimeHeader();
        await page.getByRole('button',{name:'App menu',exact:true}).click();
        const sheet=page.getByRole('dialog');
        await sheet.getByRole('button',{name:'Add app',exact:true}).click();
        await sheet.getByText('Added to My apps',{exact:true}).waitFor();
        await sheet.getByRole('button',{name:'Remove app',exact:true}).click();
        await sheet.getByText('Removed from My apps',{exact:true}).waitFor();
        await sheet.getByRole('button',{name:'Add app',exact:true}).waitFor();
        await sheet.getByRole('button',{name:'Permissions',exact:true}).click();
        await sheet.getByText('Signing rules',{exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>window.lastRoute),undefined);
        assert.equal(await page.evaluate(()=>window.nappletVisible),false);
        await sheet.getByRole('button',{name:'Close',exact:true}).click();
        await page.waitForFunction(()=>window.nappletVisible===true);
      }
      for(const theme of ['light','dark']) {
        await page.goto(`${address}/?scenario=explore-menu&kind=website&surface=touch&theme=${theme}`);
        await assertRuntimeHeader('touch');
        if(process.env.NAPPLET_SIGNING_SCREENSHOTS)await page.screenshot({path:`${process.env.NAPPLET_SIGNING_SCREENSHOTS}/${theme}-runtime-header-touch.png`});
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
      await page.clock.fastForward(60000);
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
