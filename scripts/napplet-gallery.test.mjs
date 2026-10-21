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
  'mini-app desktop supports desktop dragging, independent recent menus, history pages and both themes',
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
            '<style>html,body,#root{height:100%;margin:0}#root{display:flex}*{box-sizing:border-box}</style><div id="root"></div><script>if(!new URLSearchParams(location.search).has("touch"))window.psstpsstDesktop={system:{platform:"darwin"}}</script><script src="/gallery.js"></script>',
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
      await page.goto(`${address}/?slow-drop=1`);
      const desktop = page.getByTestId('napplet-desktop');
      const tile = (source, name) => page.getByTestId(`${source}-app-${name}`).getByRole('button', { name, exact: true });
      const order = () => desktop.locator('[data-testid^="desktop-app-"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid').slice('desktop-app-'.length)));
      await tile('desktop', 'Weather').waitFor({ timeout: 10000 }).catch(async (error) => {
        throw new Error(`${error.message}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`);
      });
      const aligned = async () => {
        await page.waitForFunction(() => {
          const recent = document.querySelector('[data-testid^="recent-app-"]')?.getBoundingClientRect();
          const desktop = document.querySelector('[data-testid^="desktop-app-"]')?.getBoundingClientRect();
          return recent && desktop && recent.width > 0 && Math.abs(recent.x - desktop.x) < 1 && Math.abs(recent.width - desktop.width) < 1;
        });
      };
      await aligned();
      const preview = page.getByTestId('napplet-recent');
      assert.equal(await preview.locator('[data-testid^="recent-app-"]').count(), 4, 'the recent preview is one row');
      assert.equal(await page.getByText('More', { exact: true }).count(), 0, 'recent history uses a trailing chevron instead of More text');
      assert(await preview.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), 'recent apps do not overflow horizontally');
      const edgeIcons = await preview.getByTestId('napplet-icon').all();
      const firstIcon = await edgeIcons[0].boundingBox();
      const lastIcon = await edgeIcons.at(-1).boundingBox();
      assert.equal(firstIcon.width, 68);
      assert(Math.abs(firstIcon.x - 16) < 1 && Math.abs(420 - lastIcon.x - lastIcon.width - 16) < 1,
        'outer icon artwork aligns with the 16px page gutter');
      for (const [width, columns, iconSize] of [[320, 4, 60], [375, 4, 60], [420, 4, 68], [480, 5, 68], [768, 8, 68], [840, 9, 68]]) {
        await page.setViewportSize({ width, height: 840 });
        await page.waitForFunction(({ columns, iconSize }) => {
          const tiles = [...document.querySelectorAll('[data-testid^="desktop-app-"]')];
          const first = tiles[0]?.getBoundingClientRect();
          const firstRow = tiles.filter((node) => Math.abs(node.getBoundingClientRect().y - first.y) < 1);
          return firstRow.length === columns && tiles[0].querySelector('[data-testid="napplet-icon"]').getBoundingClientRect().width === iconSize;
        }, { columns, iconSize });
        await aligned();
        await page.waitForFunction(({ width, columns }) => {
          const icons = document.querySelectorAll('[data-testid^="desktop-app-"] [data-testid="napplet-icon"]');
          const last = icons[columns - 1]?.getBoundingClientRect();
          return last && Math.abs(width - last.right - 16) < 1;
        }, { width, columns });
        const icons = await desktop.locator('[data-testid^="desktop-app-"] [data-testid="napplet-icon"]').all();
        const first = await icons[0].boundingBox();
        const last = await icons[columns - 1].boundingBox();
        assert(Math.abs(first.x - 16) < 1 && Math.abs(width - last.x - last.width - 16) < 1,
          `artwork retains the content gutter at ${width}px`);
        assert.equal(await preview.locator('[data-testid^="recent-app-"]').count(), Math.min(columns, 6));
        if (process.env.NAPPLET_GALLERY_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_GALLERY_SCREENSHOTS}/responsive-${width}.png` });
      }
      await page.setViewportSize({ width: 420, height: 840 });
      await aligned();
      const initial = await order();
      assert.equal(await page.getByText('Discovery', { exact: true }).count(), 0);
      await tile('recent', 'Weather').click();
      await page.getByRole('button', { name: 'Close app', exact: true }).click();
      await tile('desktop', 'Weather').waitFor();
      assert.deepEqual(await order(), initial, 'opening an app never changes its desktop position');
      const checkMenuAnchor = async (source, name, above, centered) => {
        const icon = await page.getByTestId(`${source}-app-${name}`).getByTestId('napplet-icon').boundingBox();
        const details = page.getByRole('button', { name: 'View details', exact: true });
        await details.waitFor();
        const menu = await details.locator('..').boundingBox();
        assert(menu.x >= 0 && menu.x + menu.width <= 420, 'menu stays within the viewport');
        if (above) assert(menu.y + menu.height <= icon.y - 7, 'menu prefers the space above the icon');
        else assert(menu.y >= icon.y + icon.height + 7, 'menu falls below when there is insufficient room above');
        if (centered) assert(Math.abs(menu.x + menu.width / 2 - icon.x - icon.width / 2) < 1, 'menu centers on the icon');
        assert.equal(await page.getByTestId(`${source}-app-${name}`).getByText(name, { exact: true }).evaluate((node) => getComputedStyle(node).opacity), above ? '1' : '0',
          'only a menu below the icon hides its caption');
        assert.equal(await page.getByRole('button', { name: 'Move earlier', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Move later', exact: true }).count(), 0);
      };
      for (const source of ['desktop', 'recent']) {
        for (const label of ['Permissions', 'Share', 'Open in new window']) {
          await tile(source, 'Weather').click({ button: 'right' });
          if (label === 'Open in new window') {
            const text = page.getByText(label, { exact: true });
            assert(await text.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'localized app menu actions remain fully visible');
          }
          await page.getByRole('button', { name: label, exact: true }).click();
          await page.waitForFunction((title) => document.title === title, `${label === 'Open in new window' ? 'New window' : label} Weather`);
          assert.equal(await page.getByRole('button', { name: 'View details', exact: true }).count(), 0,
            'menu actions dismiss the menu before opening their destination');
        }
      }
      for (const name of ['Weather', 'Calculator']) {
        await tile('desktop', name).click({ button: 'right' });
        await checkMenuAnchor('desktop', name, true, false);
        await page.keyboard.press('Escape');
        await page.getByTestId('inline-context-menu').waitFor({ state: 'hidden' });
        assert.equal(await page.getByTestId(`desktop-app-${name}`).getByText(name, { exact: true }).evaluate((node) => getComputedStyle(node).opacity), '1');
      }
      await tile('desktop', 'Notes').click({ button: 'right' });
      await checkMenuAnchor('desktop', 'Notes', true, true);
      if (process.env.NAPPLET_GALLERY_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_GALLERY_SCREENSHOTS}/desktop-menu-above.png` });
      assert.equal(await page.getByText('Pin', { exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Unfavorite', exact: true }).click();
      await page.waitForFunction(() => document.title === 'move:Notes:null');
      assert.equal(await tile('desktop', 'Notes').count(), 0);
      await tile('recent', 'Notes').waitFor();
      await tile('recent', 'Notes').click({ button: 'right' });
      await page.getByRole('button', { name: 'Favorite', exact: true }).click();
      await tile('desktop', 'Notes').waitFor();
      assert.equal((await order()).at(-1), 'Notes');
      const drag = async (source, name, destination, expected) => {
        await tile(source, name).scrollIntoViewIfNeeded();
        await destination.scrollIntoViewIfNeeded();
        const before = await order();
        const originalSlots = await desktop.locator('[data-testid^="desktop-app-"], [data-testid="desktop-drop-slot"]').evaluateAll((nodes) => nodes.map((node) => {
          const { x, y } = node.getBoundingClientRect();
          return { x, y };
        }));
        const bounds = await tile(source, name).boundingBox();
        const drop = await destination.boundingBox();
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.down();
        if (new URL(page.url()).searchParams.has('touch')) {
          await page.waitForTimeout(550);
          await page.getByTestId('inline-context-menu').waitFor();
          assert.deepEqual(await order(), before, 'holding shows a menu without reordering');
          if (process.env.NAPPLET_GALLERY_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_GALLERY_SCREENSHOTS}/hold-${name}.png` });
        }
        await page.mouse.move(bounds.x + bounds.width / 2 + 12, bounds.y + bounds.height / 2 + 12, { steps: 3 });
        await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2, { steps: 10 });
        await page.getByTestId('inline-context-menu').waitFor({ state: 'hidden' });
        if (expected && before.length < 20) {
          const destinationIndex = Number(expected.split(':').at(-1));
          const previewOrder = before.filter((key) => key !== name);
          previewOrder.splice(Math.min(destinationIndex, previewOrder.length), 0, name);
          await page.waitForFunction(({ previewOrder, originalSlots, name }) => previewOrder.every((key, index) => {
            if (key === name) return true;
            const node = document.querySelector(`[data-testid="desktop-app-${key}"]`);
            const rect = node?.getBoundingClientRect();
            const slot = originalSlots[index];
            return rect && slot && Math.abs(rect.x - slot.x) < 2 && Math.abs(rect.y - slot.y) < 2;
          }), { previewOrder, originalSlots, name });
          assert.deepEqual(await order(), before, 'preview does not persist a new order before release');
        }
        if (process.env.NAPPLET_GALLERY_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_GALLERY_SCREENSHOTS}/drag-${name}.png` });
        if (expected && before.length < 20) await page.evaluate((name) => {
          const positions = [...document.querySelectorAll('[data-testid^="desktop-app-"]')]
            .filter((node) => node.dataset.testid !== `desktop-app-${name}`)
            .map((node) => ({ id: node.dataset.testid, x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y }));
          window.dropFrames = [];
          window.watchDrop = true;
          const sample = () => {
            if (!window.watchDrop) return;
            window.dropFrames.push(positions.every(({ id, x, y }) => {
              const node = document.querySelector(`[data-testid="${id}"]`);
              const rect = node?.getBoundingClientRect();
              return rect && Math.abs(rect.x - x) < 2 && Math.abs(rect.y - y) < 2;
            }));
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }, name);
        await page.mouse.up();
        if (expected) await page.waitForFunction((value) => document.title === value, expected, { timeout: 10000 }).catch(async (error) => {
          if (process.env.NAPPLET_GALLERY_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_GALLERY_SCREENSHOTS}/failed.png` });
          throw new Error(`${error.message}\nExpected: ${expected}; title: ${await page.title()}\n${errors.join('\n')}`);
        });
        if (expected && before.length < 20) {
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const frames = await page.evaluate(() => { window.watchDrop = false; return window.dropFrames; });
          assert(frames.length > 0 && frames.every(Boolean), 'release keeps every displaced icon at its preview slot until the new layout commits');
          if (new URL(page.url()).searchParams.has('slow-drop')) assert(frames.length >= 3, 'the handoff covers delayed list updates');
        }
      };
      await drag('desktop', 'Chess', tile('desktop', 'Weather'), 'move:Chess:0');
      assert.equal((await order())[0], 'Chess');
      const openRecentMenu = async (name) => {
        const item = tile('recent', name);
        const rect = await item.boundingBox();
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(650);
        await page.mouse.up();
        await page.getByRole('button', { name: 'View details', exact: true }).waitFor();
      };
      await openRecentMenu('Reader');
      await checkMenuAnchor('recent', 'Reader', false, true);
      if (process.env.NAPPLET_GALLERY_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_GALLERY_SCREENSHOTS}/recent-menu-below.png` });
      assert.deepEqual(await order(), ['Chess', ...initial.filter((key) => key !== 'Chess' && key !== 'Notes'), 'Notes']);
      assert.equal(await tile('desktop', 'Chess').evaluate((node) => getComputedStyle(node.parentElement.parentElement).opacity), '1');
      await page.getByRole('button', { name: 'View details', exact: true }).click();
      await page.waitForFunction(() => document.title === 'Details Reader');
      await openRecentMenu('Reader');
      await page.getByRole('button', { name: 'Favorite', exact: true }).click();
      await tile('desktop', 'Reader').waitFor();
      assert.equal((await order()).at(-1), 'Reader', 'the recent menu adds a shortcut at the end');
      await drag('desktop', 'Reader', tile('desktop', 'Weather'), 'move:Reader:1');
      await drag('desktop', 'Reader', tile('desktop', 'Chess'), 'move:Reader:0');
      assert.equal((await order()).filter((key) => key === 'Reader').length, 1);
      const saved = await order();
      await page.reload();
      await tile('desktop', 'Reader').waitFor();
      assert.deepEqual(await order(), saved, 'desktop order persists across reopening');
      await page.setViewportSize({ width: 900, height: 840 });
      await tile('desktop', 'Reader').waitFor();
      assert.deepEqual(await order(), saved, 'resizing preserves order');
      await aligned();
      await page.setViewportSize({ width: 420, height: 840 });
      for (const theme of ['light', 'dark']) {
        await page.goto(`${address}/?theme=${theme}`);
        await tile('desktop', 'Reader').waitFor();
        const background = await page.getByText('Explore', { exact: true })
          .evaluate((element) => getComputedStyle(element.parentElement).backgroundColor);
        assert.notEqual(background, 'rgba(0, 0, 0, 0)');
        const artworkButton = tile('desktop', 'Reader');
        const restingChildren = await artworkButton.locator(':scope > *').count();
        await artworkButton.hover();
        await page.waitForFunction(() => {
          const icon = document.querySelector('[data-testid="desktop-app-Reader"] [data-testid="napplet-icon"]');
          return icon && Number(getComputedStyle(icon.parentElement).opacity) === 0.7;
        });
        assert.equal(await artworkButton.locator(':scope > *').count(), restingChildren,
          'hover does not add a background overlay');
        assert.equal(await artworkButton.evaluate((node) => getComputedStyle(node).opacity), '1',
          'hover keeps the label fully opaque');
        await page.mouse.move(0, 0);
        if (process.env.NAPPLET_GALLERY_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_GALLERY_SCREENSHOTS}/${theme}-desktop.png` });
        await page.getByTestId('napplet-recent-header').click({ position: { x: 200, y: 16 } });
        const recentPage = page.getByTestId('napplet-recent-page');
        assert.equal(await page.getByRole('dialog').count(), 0, 'More opens a page rather than a modal');
        await recentPage.getByTestId('all-recent-app-Reader').waitFor();
        if (theme === 'light') {
          await page.setViewportSize({ width: 900, height: 840 });
          await page.waitForFunction(() => {
            const page = document.querySelector('[data-testid="napplet-recent-page"]');
            const first = page?.querySelector('[data-testid="napplet-icon"]')?.getBoundingClientRect();
            return page?.getBoundingClientRect().width === 900 && first?.width === 40 && Math.abs(first.x - 16) < 1;
          });
          assert.equal(await page.getByText('Recently visited', { exact: true }).count(), 1);
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          if (process.env.NAPPLET_GALLERY_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_GALLERY_SCREENSHOTS}/wide-recent-page.png` });
          await page.setViewportSize({ width: 420, height: 840 });
        }
        await page.getByRole('button', { name: 'Back', exact: true }).click({ trial: true });
        await page.mouse.move(0, 0);
        if (process.env.NAPPLET_GALLERY_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_GALLERY_SCREENSHOTS}/${theme}-recent-page.png` });
        const usedFavorite = recentPage.getByTestId('all-recent-app-Weather');
        const readerRow = recentPage.getByTestId('all-recent-app-Reader');
        const readerPoint = await readerRow.boundingBox();
        const weatherPoint = await usedFavorite.boundingBox();
        await page.mouse.click(readerPoint.x + 250, readerPoint.y + 20, { button: 'right' });
        await page.getByRole('button', { name: 'View details', exact: true }).waitFor();
        await page.mouse.click(20, weatherPoint.y + 20, { button: 'right' });
        await page.getByRole('button', { name: 'Unfavorite', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Remove', exact: true }).click();
        await usedFavorite.waitFor({ state: 'hidden' });
        await readerRow.waitFor();
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('[data-testid="napplet-recent-page"]'));

      }
      await page.goto(`${address}/?theme=dark&chrome-edge=1&history=1`);
      await tile('recent', 'Reader').waitFor();
      await tile('recent', 'Reader').click({ button: 'right' });
      await checkMenuAnchor('recent', 'Reader', false, false);
      const safeMenu = await page.getByRole('button', { name: 'View details', exact: true }).locator('..').boundingBox();
      assert(safeMenu.y >= 36, 'app menus stay below macOS native window controls');
      if (process.env.NAPPLET_GALLERY_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_GALLERY_SCREENSHOTS}/titlebar-safe-menu.png` });
      await page.keyboard.press('Escape');
      await page.goto(`${address}/?theme=dark&rtl=1&touch=1`);
      await tile('desktop', 'Reader').waitFor();
      await page.getByTestId('napplet-recent-header').click({ position: { x: 200, y: 16 } });
      const rtlPage = page.getByTestId('napplet-recent-page');
      const latestRecent = rtlPage.getByTestId('all-recent-app-Reader');
      await latestRecent.waitFor();
      assert((await latestRecent.getByTestId('napplet-icon').boundingBox()).x > 210, 'history artwork starts at the logical right edge in RTL');
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="napplet-recent-page"]'));
      await drag('desktop', 'Weather', tile('desktop', 'Reader'), 'move:Weather:0');
      assert.equal((await order())[0], 'Weather', 'RTL and touch long-press mode use the same logical slot order');
      const beforeCancel = await order();
      const recentReader = await page.getByTestId('recent-app-Reader').boundingBox();
      const desktopReader = await page.getByTestId('desktop-app-Reader').boundingBox();
      const desktopWeather = await tile('desktop', 'Weather').boundingBox();
      await page.mouse.move(desktopWeather.x + desktopWeather.width / 2, desktopWeather.y + desktopWeather.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(550);
      assert.equal(await page.getByTestId('recent-app-Weather').evaluate((node) => getComputedStyle(node).opacity), '1',
        'holding a desktop app leaves its recent counterpart unchanged');
      await page.mouse.move(210, 60, { steps: 10 });
      await page.mouse.up();
      assert.deepEqual(await order(), beforeCancel);
      const rect = await tile('recent', 'Reader').boundingBox();
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(650);
      await page.mouse.up();
      await page.getByRole('button', { name: 'عرض التفاصيل', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'إزالة', exact: true }).count(), 1,
        'every recent app can be removed from history');
      assert.equal(await page.getByRole('button', { name: 'إزالة من المفضلة', exact: true }).count(), 1);

      assert.equal(await page.getByTestId('desktop-app-Reader').evaluate((node) => getComputedStyle(node).opacity), '1',
        'holding a recent app leaves the desktop counterpart unchanged');
      assert.deepEqual(await page.getByTestId('desktop-app-Reader').boundingBox(), desktopReader);
      assert.deepEqual(await page.getByTestId('recent-app-Reader').boundingBox(), recentReader);
      await page.getByRole('button', { name: 'عرض التفاصيل', exact: true }).click();
      await page.getByTestId('napplet-recent-header').click({ position: { x: 200, y: 16 } });
      const music = page.getByTestId('all-recent-app-Music').getByText('Music', { exact: true });
      const musicBounds = await music.boundingBox();
      await page.mouse.move(musicBounds.x + musicBounds.width / 2, musicBounds.y + musicBounds.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(650);
      await page.mouse.up();
      const removeHistory = page.getByRole('button', { name: 'إزالة', exact: true });
      await removeHistory.waitFor();
      const removeColor = await removeHistory.getByText('إزالة', { exact: true }).evaluate((node) => getComputedStyle(node).color);
      const detailColor = await page.getByRole('button', { name: 'عرض التفاصيل', exact: true }).getByText('عرض التفاصيل', { exact: true }).evaluate((node) => getComputedStyle(node).color);
      assert.notEqual(removeColor, detailColor, 'recent removal uses the danger tone');
      if (process.env.NAPPLET_GALLERY_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_GALLERY_SCREENSHOTS}/recent-remove-menu.png` });
      await removeHistory.click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="all-recent-app-Music"]'));
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await tile('desktop', 'Reader').waitFor();
      assert.deepEqual(await order(), beforeCancel, 'removing history never changes desktop membership or order');
      const cancelSource = await tile('desktop', 'Weather').boundingBox();
      const cancelDestination = await tile('desktop', 'Reader').boundingBox();
      const readerBefore = await page.getByTestId('desktop-app-Reader').boundingBox();
      await page.mouse.move(cancelSource.x + cancelSource.width / 2, cancelSource.y + cancelSource.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(550);
      await page.mouse.move(cancelDestination.x + cancelDestination.width / 2, cancelDestination.y + cancelDestination.height / 2, { steps: 10 });
      await page.waitForFunction((before) => {
        const rect = document.querySelector('[data-testid="desktop-app-Reader"]').getBoundingClientRect();
        return Math.abs(rect.x - before.x) > 5 || Math.abs(rect.y - before.y) > 5;
      }, readerBefore);
      await page.mouse.move(210, 60, { steps: 10 });
      await page.mouse.up();
      await page.waitForFunction((before) => {
        const rect = document.querySelector('[data-testid="desktop-app-Reader"]').getBoundingClientRect();
        return Math.abs(rect.x - before.x) < 1 && Math.abs(rect.y - before.y) < 1;
      }, readerBefore);
      assert.deepEqual(await order(), beforeCancel, 'cancelling after a live preview restores the original positions');
      if (process.env.NAPPLET_GALLERY_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_GALLERY_SCREENSHOTS}/rtl-desktop.png` });
      await page.goto(`${address}/?long=1&history=1`);
      await tile('desktop', 'Weather').waitFor();
      assert.equal(await tile('recent', 'App 80').count(), 0, 'the preview stays bounded');
      const showAll = page.getByTestId('napplet-recent-header');
      await showAll.click();
      const history = page.getByTestId('napplet-recent-page');
      await history.getByTestId('all-recent-app-Weather').waitFor();
      const scrollHistory = () => history.locator('div').evaluateAll((nodes) => {
        const scroll = nodes.find((node) => ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight);
        if (!scroll) throw new Error('Recent history is not scrollable');
        scroll.scrollTop = scroll.scrollHeight;
      });
      await scrollHistory();
      const olderApp = history.getByTestId('all-recent-app-App 80').getByText('App 80', { exact: true });
      await olderApp.waitFor();
      await olderApp.scrollIntoViewIfNeeded();
      await olderApp.click({ trial: true });
      if (process.env.NAPPLET_GALLERY_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_GALLERY_SCREENSHOTS}/all-recent.png` });
      await olderApp.click({ button: 'right' });
      await page.getByRole('button', { name: 'Favorite', exact: true }).click();
      await page.waitForFunction(() => document.title === 'move:App 80:9');
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="napplet-recent-page"]'));
      await tile('desktop', 'App 80').waitFor();
      await showAll.click();
      await history.getByTestId('all-recent-app-Weather').waitFor();
      await scrollHistory();
      await olderApp.waitFor();
      await olderApp.click();
      await page.waitForFunction(() => document.title === 'Details App 80');
      assert.equal(await page.getByRole('button', { name: 'Close app', exact: true }).count(), 0, 'history opens details without launching the app');
      await history.waitFor();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await tile('desktop', 'App 80').waitFor();
      await page.goto(`${address}/?long=1`);
      await tile('desktop', 'Weather').waitFor();
      const recentBefore = await preview.boundingBox();
      const appBefore = await tile('desktop', 'Weather').boundingBox();
      const pageArea = await desktop.boundingBox();
      await page.mouse.move(pageArea.x + pageArea.width / 2, pageArea.y + pageArea.height / 2);
      await page.mouse.wheel(0, 280);
      await page.waitForFunction(() => document.querySelector('[data-testid="napplet-recent"]').getBoundingClientRect().bottom < 0);
      const recentAfter = await preview.boundingBox();
      const appAfter = await tile('desktop', 'Weather').boundingBox();
      assert(Math.abs((recentAfter.y - recentBefore.y) - (appAfter.y - appBefore.y)) < 1,
        'recent apps and the desktop scroll together');
      if (process.env.NAPPLET_GALLERY_SCREENSHOTS) await page.screenshot({ path: `${process.env.NAPPLET_GALLERY_SCREENSHOTS}/whole-page-scrolled.png` });
      await desktop.locator('div').evaluateAll((nodes) => {
        const scroll = nodes.find((node) => ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight);
        scroll.scrollTop = 0;
      });
      await tile('desktop', 'Weather').scrollIntoViewIfNeeded();
      const start = await tile('desktop', 'Weather').boundingBox();
      const area = await desktop.boundingBox();
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(550);
      await page.mouse.move(area.x + area.width / 2, area.y + area.height - 60, { steps: 12 });
      await page.waitForTimeout(900);
      const scrolled = await desktop.locator('div').evaluateAll((nodes) => nodes.some((node) => node.scrollTop > 100));
      assert(scrolled, 'holding a drag at the bottom scrolls the virtualized desktop');
      await page.mouse.up();
      await page.waitForFunction(() => document.title.startsWith('move:Weather:'));
      assert.notEqual((await order())[0], 'Weather', 'edge scrolling commits a position beyond the initial rows');
      assert.deepEqual(errors, []);
      assert.deepEqual(animationWarnings, [], 'dragging must not read shared values during render');
    } finally {
      await browser?.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  },
);
