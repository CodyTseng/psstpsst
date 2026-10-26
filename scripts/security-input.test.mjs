import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { _electron as electron } from '@playwright/test';

test('trusted credential input rejects host submissions, supports system themes and cancels late work', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'psst-trusted-input-'));
  const screenshots = process.env.SECURITY_SCREENSHOTS;
  let application;
  try {
    const fixture = path.join(directory, 'fixture.ts');
    await writeFile(fixture, `
      import { app, BrowserWindow } from 'electron';
      import { SecurityInputController } from ${JSON.stringify(path.resolve('desktop/security-input.ts'))};
      app.setPath('userData', ${JSON.stringify(path.join(directory, 'user-data'))});
      // Keep this isolated test application off the user's desktop.
      BrowserWindow.prototype.show = function() {};
      app.whenReady().then(async () => {
        const owner = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, preload: ${JSON.stringify(path.join(directory, 'attacker.cjs'))} } });
        await owner.loadURL('data:text/html,<html><body>Host application</body></html>');
        const controller = new SecurityInputController();
        const state: any = { calls: 0, result: null, block: false, installed: false };
        state.start = (setup: boolean) => {
          state.result = null;
          void controller.prompt(owner, { title: setup ? 'Create password' : 'Unlock PsstPsst', message: 'Trusted credential input',
            input: 'Password', confirmation: setup ? 'Confirm password' : undefined, confirm: setup ? 'Create' : 'Unlock', cancel: 'Cancel', error: 'Try again' },
          async (value, confirmation, active) => {
            state.calls++;
            if (state.block) await new Promise(resolve => { state.release = resolve; });
            if (!active()) return false;
            state.installed = value === 'test-correct-password' && (!setup || value === confirmation);
            return state.installed;
          }).then(result => { state.result = result; });
        };
        (globalThis as any).securityFixture = state;
      });
    `);
    await writeFile(path.join(directory, 'attacker.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('attackSecurityInput',()=>ipcRenderer.invoke('psstpsst:trusted-input','submit',{value:'attacker',confirmation:'attacker'}));`);
    await build({ entryPoints: { fixture, 'security-input-preload': 'desktop/security-input-preload.ts' }, bundle: true, platform: 'node', format: 'cjs', outdir: directory, external: ['electron'] });
    application = await electron.launch({ args: [path.join(directory, 'fixture.js')], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } });
    const host = await application.firstWindow();
    await host.waitForLoadState('domcontentloaded');
    await application.evaluate(() => new Promise(resolve => {
      const interval = setInterval(() => { if (globalThis.securityFixture) { clearInterval(interval); resolve(true); } }, 10);
    }));
    const start = async setup => {
      const opening = application.waitForEvent('window');
      await application.evaluate((_electron, setup) => globalThis.securityFixture.start(setup), setup);
      const page = await opening;
      await page.getByLabel('Password', { exact: true }).waitFor(); return page;
    };
    let page = await start(true);
    assert.equal(await host.evaluate(async () => { try { await window.attackSecurityInput(); return false; } catch { return true; } }), true);
    assert.equal(await application.evaluate(() => globalThis.securityFixture.calls), 0);
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await page.evaluate(() => window.opener === null), true);
    if (screenshots) {
      await mkdir(screenshots, { recursive: true });
      for (const theme of ['light', 'dark']) {
        await application.evaluate(({ nativeTheme }, theme) => { nativeTheme.themeSource = theme; }, theme);
        await page.emulateMedia({ colorScheme: theme });
        await page.waitForFunction(theme => window.matchMedia(`(prefers-color-scheme: ${theme})`).matches, theme);
        await page.screenshot({ path: path.join(screenshots, `${theme}.png`) });
      }
    }
    await page.getByLabel('Password', { exact: true }).fill('test-correct-password');
    await page.getByLabel('Confirm password', { exact: true }).fill('mismatch');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    assert.equal(await application.evaluate(() => globalThis.securityFixture.calls), 0);
    await page.getByLabel('Confirm password', { exact: true }).fill('test-correct-password');
    const closed = page.waitForEvent('close');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await closed;
    assert.equal(await application.evaluate(() => globalThis.securityFixture.result), true);
    await application.evaluate(() => { globalThis.securityFixture.block = true; globalThis.securityFixture.installed = false; });
    page = await start(false);
    await page.getByLabel('Password', { exact: true }).fill('test-correct-password');
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await application.evaluate(() => new Promise(resolve => {
      const interval = setInterval(() => { if (globalThis.securityFixture.release) { clearInterval(interval); resolve(true); } }, 10);
    }));
    await page.close();
    await application.evaluate(() => globalThis.securityFixture.release());
    assert.equal(await application.evaluate(() => globalThis.securityFixture.result), false);
    assert.equal(await application.evaluate(() => globalThis.securityFixture.installed), false);
  } finally { await application?.close(); await rm(directory, { recursive: true, force: true }); }
});
