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
        await dialog.getByText('A small game for your account.', { exact: true }).waitFor({ timeout: 5000 }).catch(async (error) => {
          throw new Error(`${error.message}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`);
        });
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
        for (const label of ['Share', 'Permissions', 'Reload']) {
          const button = dialog.getByRole('button', { name: label, exact: true });
          const box = await button.boundingBox();
          const caption = await dialog.getByText(label, { exact: true }).boundingBox();
          assert(Math.abs(box.width - box.height) < 1, 'menu icons use square controls');
          assert(box.x > previousX, 'actions retain their defined order');
          assert(caption.y >= box.y + box.height, 'action captions sit below the icon control');
          assert(box.width >= 64, 'menu controls retain their enlarged touch target');
          assert(await dialog.getByText(label, { exact: true }).evaluate((node) =>
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
        await dialog.getByRole('button', { name: 'Permissions', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => window.lastRoute?.pathname === '/napplet-permissions/[id]');
        assert.deepEqual(await page.evaluate(() => window.lastRoute), { pathname: '/napplet-permissions/[id]', params: { id: 'd'.repeat(64) } });
        assert.equal(await page.getByText('Signing rules', { exact: true }).count(), 0, 'permissions do not open inside the app sheet');
        await page.evaluate(() => { delete window.lastRoute; });
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
        await page.goto(`${address}/?scenario=detail&surface=touch&theme=${theme}`);
        await page.getByRole('button', { name: 'Open', exact: true }).waitFor();
        const publisher = page.getByRole('button', { name: 'Publisher: Arjen', exact: true });
        const publisherBox = await publisher.boundingBox();
        const appName = await page.getByText('Composer', { exact: true }).last().boundingBox();
        assert(Math.abs(publisherBox.x - appName.x) < 1, 'publisher avatar aligns with the application name');
        await publisher.click();
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
