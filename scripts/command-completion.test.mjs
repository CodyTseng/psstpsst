import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root = process.cwd();
// Exercise the shipping composer, keyboard handler, feedback geometry and button primitives.
// Replace data subscriptions, OS capabilities and unrelated attachment/emoji panels only.
const mocks = {
  '@/lib/platform': `export const IS_ELECTRON=true, DESKTOP_OS='darwin';`,
  'react-i18next': `export const useTranslation=()=>({t:key=>key,i18n:{language:'en'}});`,
  '@/i18n/direction': `export const getLanguageDirection=()=> 'ltr',useIsRTL=()=>false,useDirectionalIconStyle=()=>({});`,
  '@/hooks/use-commands': `export const useCommands=peer=>window.commands[peer]??[];`,
  '@/hooks/use-custom-emojis': `const empty={standalone:[],packs:[]};export const useCustomEmojis=()=>empty;`,
  '@/hooks/use-electron-composer-file-paste': `export const useElectronComposerFilePaste=()=>{};`,
  '@/stores/active-account.store': `export const useActiveAccount=fn=>fn({activePubkey:'account'});`,
  '@/stores/chat-prefs.store': `export const useChatPrefsStore=fn=>fn({enterToSend:window.enterToSend});`,
  '@/stores/drafts.store': `const state={drafts:{},setDraft:(key,text)=>state.drafts[key]=text,clearDraft:key=>delete state.drafts[key],flush:()=>{}};export const useDraftsStore=fn=>fn(state);useDraftsStore.getState=()=>state;`,
  '@/stores/toast.store': `export const showToast=()=>{};`,
  '@/lib/haptics': `export const impact=()=>{};`,
  '@/lib/perf/chat-open': `export const markChatComposerMounted=()=>{},markChatInputFocus=()=>{},markChatInputPress=()=>{},markChatKeyboardEvent=()=>{},markChatPanelCommit=()=>{},markChatPanelRequest=()=>{};`,
  '@/components/common/ChromeBackdrop': `export const ChromeBackdrop=()=>null;`,
  './SearchRowLayout': `export const SearchRowLayout=()=>null;`,
  '@/components/emoji/CustomEmojiImage': `export const CustomEmojiImage=()=>null;`,
  './AttachmentPanel': `export const AttachmentPanel=()=>null,attachmentPanelHeight=()=>0;`,
  './ComposerAttachmentMenu': `export const ComposerAttachmentMenu=()=>null;`,
  './ComposerEmojiPickerPanel': `export const ComposerEmojiPickerPanel=()=>null;`,
  './EmojiPickerSheet': `export const EmojiPickerSheet=()=>null;`,
  './UnicodeEmojiPickerPanel': `export const UnicodeEmojiPickerPanel=()=>null;`,
  './QuotedReply': `export const QuotedReply=()=>null;`,
  './VoiceRecorderBar': `export const VoiceRecorderBar=()=>null;`,
  './chat-composer-panel-context': `import {useState} from 'react';export const useChatComposerPanel=()=>{const [open,setOpen]=useState(false);return {open,setOpen};};`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});`,
  'react-native-keyboard-controller': `export const KeyboardController={isVisible:()=>false,setFocusTo:()=>{}},useKeyboardHandler=()=>{};`,
  'react-native-reanimated': `import {View} from 'react-native';import {useRef} from 'react';export default {View};const animation={duration:()=>animation,delay:()=>animation};export const FadeIn=animation,FadeOut=animation,ZoomIn=animation,ZoomOut=animation,Easing={out:fn=>fn,cubic:x=>x};export const useSharedValue=value=>useRef({value}).current,useAnimatedStyle=fn=>fn(),useAnimatedReaction=()=>{},useDerivedValue=fn=>({value:fn()}),cancelAnimation=()=>{},withTiming=value=>value,runOnJS=fn=>fn;`,
  'react-native-worklets': `export const scheduleOnUI=fn=>fn(),scheduleOnRN=(fn,...args)=>fn(...args);`,
  '@/theme': `
    import {createThemePalettes} from ${JSON.stringify(path.join(root,'src/theme/palette.ts'))};
    import {density} from ${JSON.stringify(path.join(root,'src/theme/layout.ts'))};
    const palettes=createThemePalettes('blue');export const useThemeColors=()=>palettes[window.scheme];
    export {spacing} from ${JSON.stringify(path.join(root,'src/theme/spacing.ts'))};
    export * from ${JSON.stringify(path.join(root,'src/theme/typography.ts'))};
    export const uiDensity=density.desktop,bottomBarHeight=density.desktop.bottomBarHeight;
    export const radius={xs:4,sm:8,md:12,lg:16,xl:20,'2xl':24,full:9999},emojiSize={composerSuggestionImage:40},shadow={float:{}};`,
};
const entry = `
  import React from 'react';import {createRoot} from 'react-dom/client';import {View} from 'react-native';
  import {ChatInput} from './src/components/chat/ChatInput';
  const app=createRoot(document.getElementById('root'));
  window.commands={alice:['echo','help','ping'].map(command=>({command,title:command+' title',description:'Editable '+command+' command',args:command==='echo'?[['arg','text','text','optional','Text']]:[],scopes:[],event:{id:command}})),bob:[]};
  window.sent=[];window.scheme='light';window.enterToSend=true;window.attach=true;
  window.draw=(peer='alice',scheme='light',enterToSend=true)=>{
    window.scheme=scheme;window.enterToSend=enterToSend;
    app.render(<View style={{position:'absolute',bottom:0,start:0,end:0}}><ChatInput key={peer} draftKey={peer} commandPeer={peer} commandContext={{pubkey:'account',kind:14,tags:[['p',peer]]}} onPickAttachment={window.attach?()=>{}:undefined} attachmentSources={['file']} onSend={text=>{if(window.failSend)throw new Error("test send failed");window.sent.push(text);}}/></View>);
  };window.draw();
`;

test('shipping composer supports keyboard, IME, late results, chat switches and touch selection', {timeout:60000}, async () => {
  const bundle = await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,format:'iife',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'composer-fixture',setup(builder){
    builder.onResolve({filter:/.*/},args=>{
      if (mocks[args.path]) return {path:args.path,namespace:'fixture'};
      if (args.path==='react-native') return {path:path.join(root,'node_modules/react-native-web/dist/index.js')};
      if (/^(lucide-react-native|@solar-icons)/.test(args.path)) return {path:args.path,namespace:'icon'};
      if(args.path.startsWith('@/')){const resolved=['.tsx','.ts','/index.ts'].map(ext=>path.join(root,'src',args.path.slice(2)+ext)).find(existsSync);if(resolved)return {path:resolved};}
    });
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:root}));
    builder.onLoad({filter:/.*/,namespace:'icon'},args=>({contents:`export default ()=>null;export const ${args.path.split('/').pop()}=()=>null;`,loader:'js'}));
  }}]});
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});
  try {
    const page=await browser.newPage({viewport:{width:480,height:800},hasTouch:true});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setContent('<style>body{margin:0}*{box-sizing:border-box}</style><div id="root"></div>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const input=page.getByRole('textbox');
    await expect(input).toBeVisible();
    await input.fill('/');
    const echo=page.getByRole('button',{name:'/echo. echo title. Editable echo command',exact:true});
    const help=page.getByRole('button',{name:'/help. help title. Editable help command',exact:true});
    await expect(echo).toBeVisible();
    await input.press('ArrowDown');await expect(input).toBeFocused();
    await input.press('Enter');await expect(input).toHaveValue('');
    assert.deepEqual(await page.evaluate(()=>window.sent),['/help']);
    await input.fill('/');await input.press('Shift+Enter');await expect(input).toHaveValue('/\n');
    await input.fill('/');await input.press('Tab');await expect(input).toHaveValue('/echo ');
    await input.fill('/');await input.press('Meta+Enter');await expect(input).toHaveValue('/');
    await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,isComposing:true,bubbles:true});
    await expect(input).toHaveValue('/');assert.deepEqual(await page.evaluate(()=>window.sent),['/help']);
    await input.press('Escape');await expect(echo).toHaveCount(0);
    await input.fill('//');await expect(echo).toHaveCount(0);
    await input.press('Backspace');await expect(echo).toBeVisible();
    async function expectInputAlignment() {
      await expect(async()=>{
      const field=await page.getByTestId('composer-text-field').boundingBox();
      const menu=await page.getByTestId('command-suggestions-surface').boundingBox();
      assert.ok(Math.abs(field.x-menu.x)<1);
      assert.ok(Math.abs(field.width-menu.width)<1);
      const list=await page.getByTestId('command-suggestions').boundingBox();
      const extension=await page.getByTestId('command-suggestions-extension').boundingBox();
      assert.ok(Math.abs(field.y-list.y-list.height)<1);
      assert.ok(Math.abs(extension.height-field.height/2)<1);
      assert.ok(Math.abs(menu.y+menu.height-(field.y+field.height/2))<=1);
      assert.equal(await page.getByTestId('command-suggestions-surface').evaluate(node=>getComputedStyle(node).opacity),'1');
      const first=await echo.boundingBox();
      assert.ok(Math.abs(first.y-menu.y)<=1);
      assert.equal(first.height,36);
      }).toPass({timeout:2000});
    }
    await expectInputAlignment();
    await input.fill('/e');await expectInputAlignment();
    await input.fill('/');await expectInputAlignment();
    await page.screenshot({path:'/tmp/psst-command-light.png'});
    await page.evaluate(()=>window.draw('alice','dark'));await expect(echo).toBeVisible();
    await page.screenshot({path:'/tmp/psst-command-dark.png'});
    await page.evaluate(()=>{window.attach=false;window.draw('alice','dark');});
    await expectInputAlignment();
    await page.setViewportSize({width:960,height:800});await expectInputAlignment();
    await page.setViewportSize({width:480,height:800});
    await page.evaluate(()=>{window.attach=true;window.draw('alice','dark');});
    await expectInputAlignment();
    await help.tap();await expect(input).toHaveValue('');assert.deepEqual(await page.evaluate(()=>window.sent),['/help','/help']);
    await input.press('Enter');assert.deepEqual(await page.evaluate(()=>window.sent),['/help','/help']);
    await input.fill('/');await page.evaluate(()=>window.draw('bob'));await expect(input).toHaveValue('');await expect(echo).toHaveCount(0);
    await input.fill('/');await input.press('Escape');
    await page.evaluate(()=>{window.commands.bob=window.commands.alice;window.draw('bob');});await expect(echo).toHaveCount(0);
    await input.fill('');await input.fill('/');await expect(echo).toBeVisible();
    // With Enter-to-send disabled, completion still inserts; ordinary Enter remains newline.
    await page.evaluate(()=>window.draw('bob','dark',false));await input.press('Enter');await expect(input).toHaveValue('/echo ');
    await input.press('Enter');await expect(input).toHaveValue('/echo \n');
    assert.deepEqual(await page.evaluate(()=>window.sent),['/help','/help']);
    await page.evaluate(()=>{
      window.commands.bob=Array.from({length:8},(_,index)=>({command:'command'+index,title:'Command '+index,
        description:'A long command description that should stay on one line and truncate within the suggestion panel. '.repeat(4),args:[],event:{id:'command'+index}}));
      window.draw('bob','dark',false);
    });
    await input.fill('/');
    const first=page.getByRole('button',{name:/^\/command0\./});
    const bounds=await first.boundingBox();
    assert.ok(bounds.width<=480);
    const description=first.getByText(/^A long command description/);
    const command=first.getByText('/command0',{exact:true});
    const descriptionBounds=await description.boundingBox();const commandBounds=await command.boundingBox();
    assert.ok(descriptionBounds.x>commandBounds.x+commandBounds.width);
    assert.ok(Math.abs(descriptionBounds.y-commandBounds.y)<8);
    assert.ok(descriptionBounds.x+descriptionBounds.width<=bounds.x+bounds.width);
    for(let index=0;index<6;index++)await input.press('ArrowDown');
    const selected=await page.getByRole('button',{name:/^\/command6\./}).boundingBox();
    const viewport=await page.getByTestId('command-suggestions').boundingBox();
    assert.ok(selected.y>=viewport.y && selected.y+selected.height<=viewport.y+viewport.height);
    await input.press('Enter');await expect(input).toHaveValue('');
    assert.deepEqual(await page.evaluate(()=>window.sent),['/help','/help','/command6']);
    await page.evaluate(()=>{window.failSend=true;});
    await input.fill('/command6');await input.press('Enter');
    await expect(input).toHaveValue('/command6');
    assert.deepEqual(await page.evaluate(()=>window.sent),['/help','/help','/command6']);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
