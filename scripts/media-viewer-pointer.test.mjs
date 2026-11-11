import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { transformAsync } from '@babel/core';
import { chromium } from '@playwright/test';

// Exercise actual Chromium controls and web gesture listeners: hit testing alone
// misses pointer capture that steals drags from the native seek thumb.
test('media chrome leaves video controls and desktop paging clickable', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'psst-media-pointer-'));
  let browser;
  try {
    const outfile = path.join(directory, 'viewer.js');
    await build({
      stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
        import './node_modules/expo-modules-core/src/polyfill';
        import React from 'react';
        import { VideoView } from 'expo-video';
        import { useMediaVideoPlayer } from './src/components/media/use-media-video-player';
        import { createRoot } from 'react-dom/client';
        import { GestureHandlerRootView } from 'react-native-gesture-handler';
        import { MediaPageFrame } from './src/components/media/MediaPageFrame.web';
        import { MediaDismissSurface } from './src/components/media/MediaDismissSurface';
        import { AnimatedMediaChromeView } from './src/components/media/MediaChromeView';
        import { FlatList, StyleSheet } from 'react-native';
        import { MediaChromeProvider, MediaTopChrome } from './src/components/media/MediaChrome';
        import { MediaViewerTopBar } from './src/components/media/MediaViewerTopBar';
        import { MediaPagerNavigation } from './src/components/media/MediaPagerNavigation';
        const record = (action) => window.actions.push(action);
        window.actions = [];
        function FixtureVideo() {
          const player = useMediaVideoPlayer(window.mediaFixtureSource, () => record('video-error'));
          return <VideoView player={player} nativeControls fullscreenOptions={{ enable: true }} style={{ position: 'absolute', width: '100%', height: '100%' }} />;
        }
        createRoot(document.getElementById('root')).render(
          <GestureHandlerRootView style={{ height: '100%', width: '100%' }}>
            <MediaChromeProvider>
              <FlatList horizontal pagingEnabled data={['video']} keyExtractor={item => item} renderItem={() => (
                <MediaPageFrame width={900} height={600}>
                  <MediaDismissSurface active backdrop={{ value: 1 }} onRequestClose={() => record('dismiss')}>
                    <FixtureVideo />
                  </MediaDismissSurface>
                </MediaPageFrame>
              )} />
              <AnimatedMediaChromeView style={StyleSheet.absoluteFill}>
                <MediaPagerNavigation hasPrevious hasNext disabled={false} onPage={record} />
                <MediaTopChrome>
                  <MediaViewerTopBar onClose={() => record('close')} onSave={() => record('save')} />
                </MediaTopChrome>
              </AnimatedMediaChromeView>
            </MediaChromeProvider>
          </GestureHandlerRootView>
        );
      ` },
      bundle: true, outfile, format: 'iife', jsx: 'automatic',
      banner: { js: "globalThis.process = { env: { NODE_ENV: 'production' } };" },
      define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
      alias: { 'react-native': 'react-native-web', 'react-native-gesture-handler': './node_modules/react-native-gesture-handler/src/index.ts' },
      resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.js', '.js', '.json'],
      plugins: [{ name: 'media-platform-fixture', setup(builder) {
        builder.onResolve({ filter: /^(react-native-reanimated|react-native-worklets|expo-video)$/ }, args => ({ path: path.resolve('node_modules', args.path, 'src/index.ts') }));
        builder.onResolve({ filter: /^(react-native-safe-area-context|react-i18next|@\/theme$|@\/lib\/platform$|@\/i18n\/direction$|@\/components\/common\/ZoomableImage$|lucide-react-native\/|@solar-icons\/)/ }, args => ({ path: args.path, namespace: 'fixture' }));
        builder.onLoad({ filter: /react-native-reanimated\/src\/Easing\.ts$/ }, async ({ path: filename }) => {
          const source = await readFile(filename, 'utf8');
          const transformed = await transformAsync(source, {
            filename, babelrc: false, configFile: false,
            presets: ['@babel/preset-typescript'], plugins: ['react-native-worklets/plugin'],
          });
          return { contents: transformed.code, loader: 'js', resolveDir: path.dirname(filename) };
        });
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => {
          let contents;
          if (name === '@/theme') contents = `export const useThemeColors = () => ({ onOverlay: 'white', overlayControl: '#333', overlayControlActive: '#555' }); export const spacing = { sm: 8, md: 12, lg: 16 }; export const uiDensity = { headerActionSize: 40, headerActionIconSize: 20 }; export const radius = {};`;
          else if (name === '@/lib/platform') contents = 'export const IS_ELECTRON = true;';
          else if (name === '@/i18n/direction') contents = 'export const useIsRTL = () => false;';
          else if (name === '@/components/common/ZoomableImage') contents = 'export const IMAGE_MAX_SCALE = 4;';
          else if (name === 'react-native-safe-area-context') contents = 'export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });';
          else if (name === 'react-i18next') contents = 'export const useTranslation = () => ({ t: key => key });';
          else contents = 'export default () => null; export const DownloadMinimalistic = () => null;';
          return { contents, loader: 'js', resolveDir: process.cwd() };
        });
      } }],
    });
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
    for (const colorScheme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 900, height: 600 }, colorScheme });
      const errors = [];
      page.on('pageerror', error => { errors.push(error.message); });
      page.on('console', message => {
        if (message.text().includes('Selected easing is not currently supported') || message.text().includes('props.pointerEvents is deprecated')) errors.push(message.text());
      });
      await page.setContent('<style>html,body,#root { margin:0; width:100%; height:100% } #root { position:relative }</style><div id="root"></div>');
      await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 160; canvas.height = 90;
        const stream = canvas.captureStream(10);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        const chunks = [];
        recorder.ondataavailable = event => chunks.push(event.data);
        const stopped = new Promise(resolve => { recorder.onstop = resolve; });
        recorder.start();
        const context = canvas.getContext('2d');
        const timer = setInterval(() => {
          context.fillStyle = Date.now() % 2 ? 'red' : 'blue';
          context.fillRect(0, 0, 160, 90);
        }, 50);
        await new Promise(resolve => setTimeout(resolve, 1500));
        recorder.stop();
        await stopped;
        clearInterval(timer);
        stream.getTracks().forEach(track => track.stop());
        window.mediaFixtureSource = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
      });
      await page.addScriptTag({ content: await readFile(outfile, 'utf8') });
      await page.getByRole('button', { name: 'media.next', exact: true }).waitFor({ timeout: 3000 }).catch(error => { throw new Error(errors.join('\n') || error.message); });
      await page.waitForFunction(() => { const video = document.querySelector('video'); return video && !video.paused; }, null, { timeout: 3000 });
      await page.mouse.click(24, 552);
      assert.equal(await page.locator('video').evaluate(video => video.paused), true);
      await page.evaluate(async () => {
        const video = document.querySelector('video');
        // MediaRecorder WebM files omit duration metadata. Let Chromium discover
        // the end, then rewind so its native seek rail has a finite range.
        video.currentTime = 1e10;
        await new Promise(resolve => { video.onseeked = resolve; });
        video.currentTime = 0;
        await new Promise(resolve => { video.onseeked = resolve; });
      });
      await page.mouse.click(24, 552);
      await page.waitForFunction(() => !document.querySelector('video').paused, null, { timeout: 2000 });
      await page.mouse.click(24, 552);
      assert.equal(await page.locator('video').evaluate(video => video.paused), true);
      // Chromium reports the video host for its native play, seek, volume,
      // fullscreen and overflow controls, which live inside its closed shadow root.
      const targets = await page.evaluate(() => [
        [20, 580], [450, 590], [730, 580], [820, 580], [870, 580], [450, 300],
      ].map(([x, y]) => document.elementFromPoint(x, y)?.tagName));
      assert.deepEqual(targets, Array(6).fill('VIDEO'), colorScheme);
      await page.mouse.move(20, 578);
      await page.mouse.down();
      await page.mouse.move(650, 578, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(() => document.querySelector('video').currentTime > 0.6, null, { timeout: 2000 });
      for (const name of ['media.previous', 'media.next', 'common.close', 'attach.save']) {
        await page.getByRole('button', { name, exact: true }).click({ timeout: 2000 });
      }
      assert.deepEqual(await page.evaluate(() => window.actions), [-1, 1, 'close', 'save']);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
