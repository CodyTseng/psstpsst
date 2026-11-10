import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root = process.cwd();

// Keep the shipping quote, file card, action frame and button. Replace only
// external services, translations and the device theme subscription.
const mocks = {
  '@/platform': `export const platform={confirmationDialog:{confirm:async()=>{window.confirms++;return true;},notify:async()=>{}}};`,
  '@/lib/platform': `export const IS_ELECTRON=false;export const IS_ANDROID=false;export const IS_IOS=true;`,
  '@/i18n/direction': `export const getLanguageDirection=()=> 'ltr';`,
  'react-i18next': `export const useTranslation=()=>({t:key=>key,i18n:{language:'en'}});`,
  '@/hooks/use-attachment-download-uri': `export const useAttachmentDownloadUri=()=>null;`,
  '@/stores/active-account.store': `export const useActiveAccount=selector=>selector({activePubkey:'test'});`,
  '@/stores/attachment-transfer.store': `export const useAttachmentTransfer=()=>null;`,
  '@/services/files/attachment-download-task': `export const pauseAttachmentDownload=()=>{};`,
  '@/services/files/file-attachment.service': `
    export const fetchAndDecryptAttachment=async()=>{window.requests++;throw Error('offline');};
    export const getCachedAttachmentUri=async()=>null;export const getSessionCachedUri=()=>null;
    export const copyForShare=async value=>value;export const attachmentErrorKind=()=> 'download';`,
  'expo-sharing': `export const isAvailableAsync=async()=>false;export const shareAsync=async()=>{};`,
  '@/components/common/ExclamationIcon': `export const ExclamationIcon=()=>null;`,
  './AttachmentTransferProgress': `export const AttachmentTransferProgress=()=>null;`,
  '@/theme': `
    import {createThemePalettes} from ${JSON.stringify(path.join(root, 'src/theme/palette.ts'))};
    const palettes=createThemePalettes('blue');export const useThemeColors=()=>palettes[window.scheme];
    export {spacing} from ${JSON.stringify(path.join(root, 'src/theme/spacing.ts'))};
    export * from ${JSON.stringify(path.join(root, 'src/theme/typography.ts'))};
    export const uiDensity={iconButtonSize:36};
    export const radius={xs:4,sm:8,md:12,lg:16,xl:20,'2xl':24,full:9999};`,
};

const entry = `
  import React from 'react';import {createRoot} from 'react-dom/client';import {View} from 'react-native';
  import {AttachmentFile} from './src/components/chat/AttachmentFile';
  import {QuotedReply} from './src/components/chat/QuotedReply';
  import {MessageLayoutViewport,useMessageRowWidth,messageBodyLayout} from './src/components/chat/message-row-layout';
  function Message({group,isSelf}) {
    const inset=32+(group&&!isSelf?42:0);const row=useMessageRowWidth(inset);
    const layout=row.width===undefined?undefined:messageBodyLayout(row.width);
    return <View testID="row" style={{paddingStart:inset-16,paddingEnd:16}}>
      <View testID="stack" style={{maxWidth:'100%',alignSelf:isSelf?'flex-end':'flex-start',minWidth:0,gap:4}}>
        <QuotedReply senderName="Cody" contentPreview={'A long quoted message. '.repeat(100)}
          style={{maxWidth:layout?.quoteMaxWidth??'85%',alignSelf:isSelf?'flex-end':'flex-start'}}/>
        <View testID="attachment" style={{alignSelf:isSelf?'flex-end':'flex-start'}}>
          <AttachmentFile meta={{url:'https://example.invalid/test.bin',name:'layout-test.bin',size:100,
            cipherSha256Hex:'a'.repeat(64),decryptionKeyHex:'b'.repeat(64),decryptionNonceHex:'c'.repeat(24)}}
            isSelf={isSelf} maxWidth={layout?.attachmentMaxWidth}/>
        </View>
      </View>
    </View>;
  }
  const app=createRoot(document.getElementById('root'));
  window.draw=(width,group,isSelf,scheme)=>{
    window.scheme=scheme;window.requests=0;window.confirms=0;
    app.render(<View style={{width}}><MessageLayoutViewport><Message key={[width,group,isSelf,scheme].join(':')} group={group} isSelf={isSelf}/></MessageLayoutViewport></View>);
  };
`;

test('quoted file recovery controls remain inside every ancestor and clickable on narrow group rows', { timeout: 60000 }, async () => {
  const bundle = await build({
    stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, format: 'iife', write: false,
    jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'isolated-layout-services', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (mocks[args.path]) return { path: args.path, namespace: 'fixture' };
        if (args.path === 'react-native') return { path: path.join(root, 'node_modules/react-native-web/dist/index.js') };
        if (/^(lucide-react-native|@solar-icons)/.test(args.path)) return { path: args.path, namespace: 'icon' };
        if (args.path.startsWith('@/')) {
          const resolved = ['.tsx', '.ts', '/index.ts'].map(ext => path.join(root, 'src', args.path.slice(2) + ext)).find(existsSync);
          if (resolved) return { path: resolved };
        }
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }));
      builder.onLoad({ filter: /.*/, namespace: 'icon' }, args => ({ contents: `export default ()=>null;export const ${args.path.split('/').pop()}=()=>null;`, loader: 'js' }));
    } }],
  });
  const chrome = process.env.NAPPLET_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  try {
    const page = await browser.newPage();
    await page.setContent('<style>body{margin:0}*{box-sizing:border-box}</style><div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    for (const scheme of ['light', 'dark']) for (const width of [320, 360, 375, 390, 393]) {
      for (const group of [false, true]) for (const isSelf of [false, true]) {
        await page.evaluate(args => window.draw(...args), [width, group, isSelf, scheme]);
        await page.getByText('layout-test.bin', { exact: true }).click();
        const retry = page.getByRole('button', { name: 'attach.download_failed', exact: true });
        await expect(retry).toBeVisible();
        const rowWidth = width - 32 - (group && !isSelf ? 42 : 0);
        const frameWidth = Math.min(240, rowWidth - 44) + 44;
        await expect.poll(async () => (await page.getByTestId('attachment').boundingBox()).width).toBeCloseTo(frameWidth, 1);
        const quote = await page.locator('[data-testid="stack"] > div:first-child').boundingBox();
        assert.ok(quote.width <= rowWidth * 0.85 + 1, `quote exceeds text cap: ${width},${group},${isSelf}`);
        const escaped = await retry.evaluate(button => {
          const target = button.parentElement.getBoundingClientRect();
          if (Math.abs(target.width - 44) > 1 || Math.abs(target.height - 44) > 1) return ['action target lost its size'];
          const outside = [];
          for (let parent = button.parentElement.parentElement; parent; parent = parent.parentElement) {
            const rect = parent.getBoundingClientRect();
            if (target.left < rect.left - 1 || target.right > rect.right + 1 || target.top < rect.top - 1 || target.bottom > rect.bottom + 1) outside.push(parent.tagName);
          }
          return outside;
        });
        assert.deepEqual(escaped, [], `action escapes native hit-test bounds: ${width},${group},${isSelf},${scheme}`);
        await retry.click();
        await expect.poll(() => page.evaluate(() => window.requests)).toBe(2);
        assert.equal(await page.evaluate(() => window.confirms), 1);
      }
    }
  } finally { await browser.close(); }
});
