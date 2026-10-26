/* eslint-disable @typescript-eslint/no-require-imports -- Install isolated ports before loading application modules. */
import 'react-native-get-random-values';
import React from 'react';
import { AppRegistry } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initPlatformAdapters } from '../../src/platform/registry';
import type { PlatformAdapters } from '../../src/platform/ports';
import { NavigationContext, NavigationRouteContext, PreventRemoveContext } from 'expo-router/react-navigation';
import { LocalRouteParamsContext } from 'expo-router/build/Route';
import type { NappletRelease } from '../../src/services/napplet/protocol';
import type { SigningRule } from '../../src/services/signing/model';

// This fixture renders the shipped approval UI without user data or signer access.
initPlatformAdapters({
  windowChrome: { setTheme: async () => {}, setTitle: async (title: string) => { document.title = title; } },
  napplet: { windows: { isHost: new URLSearchParams(location.search).get('scenario') === 'window' }, capture: async () => null, setBounds: async (_id: string, _bounds: unknown, visible: boolean, interactive = true) => {
    (window as unknown as { nappletVisible: boolean }).nappletVisible = visible;
    (window as unknown as { nappletInputEnabled: boolean }).nappletInputEnabled = visible && interactive;
  } },
  clipboard: { writeText: async (text: string) => { (window as unknown as { copiedEvent: string }).copiedEvent = text; } },
  confirmationDialog: { confirm: async (options: unknown) => {
    const state = window as unknown as { lastConfirmation: unknown; confirmationResult?: boolean };
    state.lastConfirmation = options;
    return state.confirmationResult ?? true;
  }, notify: async () => {} },
  database: { drizzle: () => ({}) },
  localization: { preferredLanguageTag: () => 'en' },
  appState: { currentState: () => 'active', addChangeListener: () => () => {} },
  networkState: { getState: async () => ({ isConnected: false }), addStateListener: () => () => {} },
  deviceCrypto: { sha256Hex: async (bytes: Uint8Array) => {
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } },
} as unknown as PlatformAdapters);
const profile = require('../../src/hooks/use-display-name') as typeof import('../../src/hooks/use-display-name');
profile.useDisplayName = () => ({ name: 'Alice', profile: null });
const profileHooks = require('../../src/hooks/use-profile') as typeof import('../../src/hooks/use-profile');
profileHooks.useProfilesMap = pubkeys => Object.fromEntries(pubkeys.map(pubkey => [pubkey, { pubkey, name: 'Alice', displayName: null, fetchedAt: Math.floor(Date.now() / 1000) }])) as ReturnType<typeof profileHooks.useProfilesMap>;
const contactHooks = require('../../src/hooks/use-contacts') as typeof import('../../src/hooks/use-contacts');
contactHooks.useContactsMap = () => ({});
const { NappletOverlays } = require('../../src/components/napplet/NappletOverlays') as typeof import('../../src/components/napplet/NappletOverlays');
const { nappletStore, nappletService } = require('../../src/services/napplet/service') as typeof import('../../src/services/napplet/service');
const { useThemeStore } = require('../../src/stores/theme.store') as typeof import('../../src/stores/theme.store');
require('../../src/i18n');
const params = new URLSearchParams(location.search);
const browserPermissionRepository = require('../../src/services/explore/browser-permission-store') as typeof import('../../src/services/explore/browser-permission-store');
browserPermissionRepository.readBrowserPermissions = async () => [];

useThemeStore.setState({ preference: params.get('theme') === 'dark' ? 'dark' : 'light' });
const auth = params.get('scenario') === 'auth';
const raw = params.get('scenario') === 'raw';
const scroll = params.get('scenario') === 'scroll';
const answerApproval = nappletService.answer;
nappletService.answer = (id, value) => { document.title = JSON.stringify({ id, value }); };
nappletStore.setState({
  prompt: {
    title: 'Arcade', requestId: 'fixture', expiresAt: Date.now() + 60000, queued: 2, detail: '',
    accountPubkey: 'a'.repeat(64),
    app: { title: 'Arcade', hash: 'c'.repeat(64), event: { pubkey: 'b'.repeat(64) } } as NappletRelease,
    signing: {
      operation: auth ? 'relay-auth' : 'publish', kind: auth ? 22242 : raw ? 30079 : 30078,
      accountPubkey: 'a'.repeat(64), createdAt: 100, relays: ['wss://relay.example/'],
      scopeKey: auth ? undefined : 'game-progress',
      content: auth ? '' : JSON.stringify({ score: 1280, level: 4, lives: 3, ...(scroll ? { entries: Array.from({ length: 40 }, (_, index) => ({ index, value: `Entry ${index}` })) } : {}) }), tags: auth ? [] : [['d', 'game-progress']],
    },
  },
});
if (params.get('scenario') === 'wallet') {
  nappletService.answer = answerApproval;
  nappletStore.setState({ accountPubkey: 'a'.repeat(64), prompt: null, overlayActive: false });
  const life = new AbortController();
  const state: { result?: string | false; cancel: () => void } = { cancel: () => life.abort() };
  Object.assign(window, { walletFixture: state });
  const i18n = require('../../src/i18n/core').default as typeof import('../../src/i18n/core').default;
  void nappletService.requestApproval({
    title: i18n.t('wallet.confirm_payment'),
    detail: '', accountPubkey: 'a'.repeat(64),
    requester: { title: 'jumble.social', origin: 'https://jumble.social' },
    wallet: {
      operation: 'payment', amountMsat: 1250000, description: 'Coffee and a sandwich',
      wallets: [{ id: 'coinos', name: 'ln.coinos.io', customName: null, isDefault: true },
        { id: 'second', name: 'Second wallet', customName: null, isDefault: false }],
    },
  }, life.signal).then(result => { state.result = result; });
}
if (params.get('scenario') === 'queued-approvals') {
  nappletService.answer = answerApproval;
  nappletStore.setState({ accountPubkey: 'a'.repeat(64), prompt: null, overlayActive: false });
  if (params.has('underlay')) nappletStore.setState({ configuration: {
    schema: { type: 'object', properties: {} }, values: {}, requestId: 1,
  } });
  const repository = require('../../src/services/signing/repository') as typeof import('../../src/services/signing/repository');
  const { invalidateSigning } = require('../../src/services/signing/changes') as typeof import('../../src/services/signing/changes');
  let rules: SigningRule[] = [];
  repository.readSigningSnapshot = async () => ({ rules: [...rules], activity: [] });
  repository.saveSigningRule = async (scope, rule, guard) => {
    guard?.(); rules = [...rules.filter(saved => saved.key !== rule.key), rule];
    return invalidateSigning(scope, rule.key);
  };
  repository.recordSigningActivity = async () => {};
  const state = { presentations: [] as (string | null)[], results: [] as string[], complete: false };
  (window as unknown as { approvalQueue: typeof state }).approvalQueue = state;
  nappletStore.subscribe(value => {
    const id = value.prompt?.requestId ?? null;
    if (state.presentations.at(-1) !== id) state.presentations.push(id);
  });
  const { SigningPermissions } = require('../../src/services/signing/permissions') as typeof import('../../src/services/signing/permissions');
  const life = new AbortController(), scope = { accountPubkey: 'a'.repeat(64), sourceId: 'https://app.example' };
  const controller = () => new SigningPermissions(scope, (signing, signal) => nappletService.requestApproval({
    title: 'Arcade', detail: '', accountPubkey: scope.accountPubkey, signing,
    application: { title: 'Arcade', description: '', servers: [], required: [] },
  }, signal), life.signal, () => {});
  const first = controller(), second = controller();
  void Promise.allSettled([first.authorizeAccess('nip44-decrypt'), second.authorizeAccess('nip44-decrypt'),
    first.authorizeAccess(params.has('distinct') ? 'nip44-encrypt' : 'nip44-decrypt')]).then(results => {
    state.results = results.map(result => result.status); state.complete = true;
  });
}
if (params.get('scenario') === 'upload') {
  nappletStore.setState({ prompt: { ...nappletStore.getState().prompt!, queued: 0, signing: undefined,
    upload: { filename: 'report.pdf', mimeType: 'application/pdf', size: 2048, sha256: 'c'.repeat(64), servers: ['https://storage.example/'] },
  } });
}
if (params.get('scenario') === 'capabilities') {
  const release = { ...nappletStore.getState().prompt!.app!, key: '35129:publisher:arcade',
    description: 'A small game for your account.', required: ['relay', 'upload'], optional: ['storage'], servers: [], intents: [],
  } as NappletRelease;
  nappletStore.setState({ accountPubkey: 'a'.repeat(64), prompt: {
    ...nappletStore.getState().prompt!, app: release, queued: 0, signing: undefined,
    capabilities: { required: ['shell', ...release.required], optional: release.optional },
  } });
}
if (params.get('scenario') === 'timeout') {
  const { PromptQueue } = require('../../src/services/napplet/prompt-queue') as typeof import('../../src/services/napplet/prompt-queue');
  const queue = new PromptQueue((prompt) => nappletStore.setState({ prompt }));
  void queue.ask(nappletStore.getState().prompt!);
}
if (params.get('scenario') === 'application-consent') {
  const website=params.get('kind')==='website';
  nappletStore.setState({accountPubkey:'a'.repeat(64),prompt:{
    ...nappletStore.getState().prompt!,signing:undefined,app:undefined,queued:0,
    title:website?'example.com':'Notifications',
    application:{title:website?'example.com':'Notifications',description:website?'':'Your public notifications.',
      servers:[],required:params.get('kind')==='napp'?['relay']:[],publisher:website?undefined:'b'.repeat(64)},
    requester:website?{title:'example.com',origin:'https://example.com'}:undefined,
  }});
}
if (params.get('scenario') === 'application-choice') {
  nappletStore.setState({ prompt: {
    title: 'Notifications', requestId: 'fixture', expiresAt: Date.now() + 60000, queued: 0, detail: '',
    applicationSelection: { requester: 'Notifications', content: 'profile' },
    choices: ['Notifications', 'Suggested Follows', 'Profile Feed'].map((title, index) => ({
      key: `app:${index}`, title, application: { title, kind: 'napp' as const, servers: [], publisher: 'b'.repeat(64) },
    })),
  } });
}
const standalone = params.get('scenario') === 'window';
const menu = params.get('scenario') === 'menu' || standalone;
let RuntimeScreen: React.ComponentType | undefined;
let exploreFixtureKey: string | undefined;
if(params.get('scenario')==='explore-discovery') {
  (require('../../src/services/explore/repository') as typeof import('../../src/services/explore/repository')).readEntries = async () => [];
  const {exploreService,exploreStore}=require('../../src/services/explore/service') as typeof import('../../src/services/explore/service');
  const {discoveryStore}=require('../../src/services/explore/discovery') as typeof import('../../src/services/explore/discovery');
  const {naddrEncode}=require('nostr-tools/nip19') as typeof import('nostr-tools/nip19');
  const titles=['Notes','Photo Gallery'];
  const apps=Array.from({length:params.has('long-catalog')?80:2},(_,index)=>titles[index]??`Application ${index}`).map((title,index)=>{
    const kind=index%2===0?35130:35129;
    const key=naddrEncode({kind,pubkey:'b'.repeat(64),identifier:title});
    return {key,address:key,title,kind:index%2===0?'napp':'napplet',description:'A useful application for your Nostr account.',
      required:[],servers:[],desktopPosition:null,lastUsedAt:null,manifest:{pubkey:'b'.repeat(64),kind,id:'c'.repeat(64),sig:'d'.repeat(128),created_at:1,content:'',tags:[['d',title]]}} as import('../../src/services/explore/model').ExploreEntry;
  });
  nappletStore.setState({accountPubkey:'a'.repeat(64),prompt:null,loaded:true});
  exploreStore.setState({account:'a'.repeat(64),loaded:true,entries:params.has('favorites-drag')?apps.map((app,desktopPosition)=>({...app,desktopPosition})):params.has('saved-apps')?[{...apps[0],desktopPosition:0,lastUsedAt:params.has('list-actions')?20:null},{...apps[1],lastUsedAt:10}]:[]});
  discoveryStore.setState({entries:apps,visibleEntries:apps,loaded:true,loading:false,error:false});
  require('../../src/services/explore/discovery').discoverApplications=async()=>{};
  exploreService.activate=async()=>{};
  if (params.has('favorites-drag') || params.has('list-actions')) {
    const icons = require('../../src/services/explore/icons') as typeof import('../../src/services/explore/icons');
    icons.loadApplicationIcon = async () => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64"/></svg>');
  }
  if (params.has('favorites-drag') || params.has('list-actions')) require('expo-router/build/global-state/store').storeRef.current.navigationRef = { current: {} };
  if (params.has('favorites-drag') || params.has('list-actions')) exploreService.move = async (app, index) => {
    const previous = exploreStore.getState().entries;
    const ordered = previous.filter(entry => entry.desktopPosition !== null && entry.key !== app.key).sort((a,b) => a.desktopPosition! - b.desktopPosition!);
    if (index !== null) ordered.splice(index, 0, app);
    const positions = new Map(ordered.map((entry, position) => [entry.key, position]));
    const entries = previous.some(entry => entry.key === app.key) ? previous : [...previous, app];
    exploreStore.setState({ entries: entries.map(entry => ({ ...entry, desktopPosition: positions.get(entry.key) ?? null })) });
    document.title = `move:${app.title}:${index}`;
  };
  const active=require('../../src/stores/active-account.store') as typeof import('../../src/stores/active-account.store');
  active.useActiveAccount.setState({activePubkey:'a'.repeat(64)});
  const navigation=require('../../src/components/navigation/primary-pane-navigation') as typeof import('../../src/components/navigation/primary-pane-navigation');
  navigation.usePrimaryPaneNavigation=()=>({open:href=>{document.title=href;},wide:false,pendingPathname:null,selection:{conversationKey:null,profilePubkey:null,settingsItem:null,contactsItem:null}}) as ReturnType<typeof navigation.usePrimaryPaneNavigation>;
  RuntimeScreen=require('../../src/app/(app)/(tabs)/napplets').default;
}
if(['explore-detail','explore-permissions','explore-menu'].includes(params.get('scenario')??'')) {
  const {exploreService,exploreStore}=require('../../src/services/explore/service') as typeof import('../../src/services/explore/service');
  const {naddrEncode}=require('nostr-tools/nip19') as typeof import('nostr-tools/nip19');
  const kind=params.get('kind')==='website'?'website':params.get('kind')==='nsite'?'nsite':'napp';
  const key=kind==='website'?'https://example.com/':naddrEncode({kind:kind==='napp'?35130:35128,pubkey:'b'.repeat(64),identifier:'composer'});
  exploreFixtureKey=key;
  const entry:import('../../src/services/explore/model').ExploreEntry={key,address:key,title:'Composer',kind,
    description:kind==='website'?'':'Compose and publish posts with your Nostr account.',required:kind==='napp'?['identity','relay','storage']:[],
    servers:[],desktopPosition:null,lastUsedAt:1,
    manifest:kind==='website'?undefined:{pubkey:'b'.repeat(64)} as import('nostr-tools').Event};
  nappletStore.setState({accountPubkey:'a'.repeat(64),prompt:null,loaded:true});
  exploreStore.setState({account:'a'.repeat(64),loaded:true,entries:[entry],entry:params.get('scenario')==='explore-menu'?entry:null,
    runId:1,containerId:params.get('scenario')==='explore-menu'?'fixture':null,loading:false,error:null});
  exploreService.move = async (app, position) => {
    const saved = exploreStore.getState().entries.find(item => item.key === app.key) ?? app;
    exploreStore.setState({ entries: [{ ...saved, desktopPosition: position }] });
  };
  exploreService.forget = async app => {
    exploreStore.setState(state => ({ entries: state.entries.map(item => item.key === app.key ? { ...item, lastUsedAt: null } : item) }));
  };
  exploreService.access=async()=>!params.has('needs-consent');
  exploreService.prepare=(_entry,_account,reviewedRequired)=>{
    (window as unknown as {reviewedRequired:readonly string[]|undefined}).reviewedRequired=reviewedRequired;return 1;
  };
  exploreService.reload=()=>{document.title='reloaded';};
  exploreService.reset=async()=>{document.title='permissions-reset';};
  const signingRepository=require('../../src/services/signing/repository') as typeof import('../../src/services/signing/repository');
  signingRepository.readSigningSnapshot=async()=>({rules:[],activity:[]});
  const {router}=require('expo-router') as typeof import('expo-router');
  router.back=()=>{document.title='closed';};
  router.push=route=>{(window as unknown as {lastRoute:unknown}).lastRoute=route;};
  require('expo-router/build/global-state/store').storeRef.current.navigationRef={current:{}};
  RuntimeScreen=params.get('scenario')==='explore-menu'?require('../../src/app/(app)/explore-run').default:require('../../src/app/(app)/explore-details').default;
}
if (['detail', 'permissions'].includes(params.get('scenario') ?? '')) {
  const release: NappletRelease = { title: 'Composer', key: `35129:${'b'.repeat(64)}:composer`, hash: 'c'.repeat(64),
    description: params.get('empty') ? '' : 'Compose and publish posts with your Nostr account.'.repeat(params.get('long') ? 30 : 1),
    required: ['identity', 'outbox', 'relay', 'resource', 'theme', 'inc', 'intent', 'link', 'storage'],
    optional: ['upload'], servers: [], intents: [],
    event: { id: 'd'.repeat(64), pubkey: 'b'.repeat(64), kind: 35129, tags: [['d', 'composer']] } as NappletRelease['event'],
  };
  profile.useDisplayName = () => ({ name: 'Arjen', profile: null });
  nappletStore.setState({ accountPubkey: 'a'.repeat(64), loaded: true, prompt: null, market: [release],
    installed: params.get('uninstalled') ? [] : [{ ...release, desktopPosition: null, lastUsedAt: null, previousManifest: null }],
  });
  const explore = require('../../src/services/explore/service') as typeof import('../../src/services/explore/service');
  explore.exploreStore.setState({ account: 'a'.repeat(64), loaded: true, entries: [] });
  explore.exploreService.move = async (entry, position) => {
    explore.exploreStore.setState({ entries: [{ ...entry, desktopPosition: position }] });
  };
  const { nappletPermissionStore } = require('../../src/services/napplet/service') as typeof import('../../src/services/napplet/service');
  const { signingRuleKey, replaceSigningRule } = require('../../src/services/signing/model') as typeof import('../../src/services/signing/model');
  const storageKey = `fixture-signing-rules-${params.get('theme') ?? 'light'}`;
  let rules: import('../../src/services/signing/model').SigningRule[] = [{
    key: 'post', decision: 'allow', duration: 'always', createdAt: 100,
    scope: { operation: 'publish', kind: 1, relays: [] },
  }, {
    key: 'reaction', decision: 'deny', duration: 'always', createdAt: 100,
    scope: { operation: 'publish', kind: 7, relays: [] },
  }];
  rules = rules.map((rule) => ({ ...rule, key: signingRuleKey(rule.scope) }));
  const persisted = sessionStorage.getItem(storageKey);
  if (persisted) rules = JSON.parse(persisted);
  nappletService.updateSigningRule = async (_release, source, change) => {
    rules = replaceSigningRule(rules, source, change);
    sessionStorage.setItem(storageKey, JSON.stringify(rules));
    (window as unknown as { savedRuleChange: unknown }).savedRuleChange = change;
    nappletPermissionStore.setState((state) => ({ revision: state.revision + 1 }));
  };
  nappletService.signingPermissions = async () => ({ rules, activity: [
    { scope: { operation: 'publish', kind: 1 }, decision: 'allowed', at: 100000 },
  ] });
  nappletService.revokeSigningRule = async (_release, key) => {
    rules = rules.filter((rule) => rule.key !== key); nappletPermissionStore.setState((state) => ({ revision: state.revision + 1 }));
  };
  nappletService.domainPermissions = async () => params.has('needs-consent') ? [] : ['shell', ...release.required];
  nappletService.prepareOpen = (_release, _account, reviewedRequired) => {
    (window as unknown as { reviewedRequired: readonly string[] | undefined }).reviewedRequired = reviewedRequired;
    return 1;
  };
  nappletService.setDomainPermissions = async (_release, domains) => {
    (window as unknown as { savedDomains: string[] }).savedDomains = domains;
  };
  nappletService.revoke = async () => {
    rules = []; sessionStorage.setItem(storageKey, '[]');
    nappletPermissionStore.setState((state) => ({ revision: state.revision + 1 }));
    document.title = 'permissions-reset';
  };
  nappletService.resolve = async () => { document.title = 'updates-checked'; return release; };
  const { router } = require('expo-router') as typeof import('expo-router');
  router.canGoBack = () => true;
  router.push = (route) => { (window as unknown as { lastRoute: unknown }).lastRoute = route; };
  require('expo-router/build/global-state/store').storeRef.current.navigationRef = { current: {} };
  RuntimeScreen = params.get('scenario') === 'detail'
    ? require('../../src/app/(app)/napplet/[id]').default
    : require('../../src/app/(app)/napplet-permissions/[id]').default;
}
if (menu) {
  const release: NappletRelease = { ...nappletStore.getState().prompt!.app!, key: '35129:publisher:arcade',
    description: 'A small game for your account.', required: ['storage'], optional: ['identity'], servers: [], intents: [],
    event: { id: 'd'.repeat(64), pubkey: 'b'.repeat(64), kind: 35129, tags: [['d', 'arcade']] } as NappletRelease['event'],
  };
  nappletStore.setState({ accountPubkey: 'a'.repeat(64), prompt: null,
    running: { release, containerId: 'fixture' }, panel: null, overlayActive: false });
  const explore = require('../../src/services/explore/service') as typeof import('../../src/services/explore/service');
  explore.exploreStore.setState({ account: 'a'.repeat(64), loaded: true, entries: [] });
  explore.exploreService.move = async (entry, position) => {
    explore.exploreStore.setState({ entries: [{ ...entry, desktopPosition: position }] });
  };
  const { nappletPermissionStore } = require('../../src/services/napplet/service') as typeof import('../../src/services/napplet/service');
  let rules: import('../../src/services/signing/model').SigningRule[] = [{
    key: 'post', decision: 'allow', duration: 'always', createdAt: 100,
    scope: { operation: 'publish', kind: 1, relays: ['wss://relay.example/'] },
  }];
  nappletService.signingPermissions = async () => ({ rules, activity: [] });
  nappletService.revokeSigningRule = async (_release, key) => {
    rules = rules.filter((rule) => rule.key !== key);
    nappletPermissionStore.setState((state) => ({ revision: state.revision + 1 }));
  };
  nappletService.domainPermissions = async () => ['shell', 'storage'];
  nappletService.setDomainPermissions = async (_release, domains) => {
    (window as unknown as { savedDomains: string[] }).savedDomains = domains;
  };
  nappletService.reload = async () => { document.title = 'reloaded'; };
  const { router } = require('expo-router') as typeof import('expo-router');
  router.back = () => { document.title = 'closed'; };
  router.push = (route) => { (window as unknown as { lastRoute: unknown }).lastRoute = route; };
  require('expo-router/build/global-state/store').storeRef.current.navigationRef = { current: {} };
  const forward = require('../../src/components/share/ForwardTargetScreen') as typeof import('../../src/components/share/ForwardTargetScreen');
  const { AppButton } = require('../../src/components/common/AppButton') as typeof import('../../src/components/common/AppButton');
  forward.ForwardTargetScreen = function EmbeddedShareFixture({ onClose }: { onClose?: () => void } = {}) {
    return <AppButton label="Finish sharing" onPress={onClose} />;
  };
  RuntimeScreen = standalone ? function WindowRuntime() {
    const { ApplicationRuntimePage } = require('../../src/components/napplet/ApplicationRuntimePage');
    return <ApplicationRuntimePage windowed title="Arcade" menuEnabled onClose={() => {}} onMore={() => nappletService.openPanel('about')} onRetry={() => {}} />;
  } : require('../../src/app/(app)/napplet-run').default;
  const { useForwardDraftStore } = require('../../src/stores/forward-draft.store') as typeof import('../../src/stores/forward-draft.store');
  Object.assign(window, { forwardDraft: () => useForwardDraftStore.getState().draft });
}
const WindowFrame = standalone ? require('../../src/components/common/DesktopWindowFrame').DesktopWindowFrame : React.Fragment;
function Fixture() {
  return <SafeAreaProvider><NavigationContext.Provider value={{ isFocused: () => true, addListener: () => () => {} } as never}>
    <NavigationRouteContext.Provider value={{ key: 'fixture', name: 'fixture' }}>
    <PreventRemoveContext.Provider value={{ preventedRoutes: {}, setPreventRemove: () => {} }}>
    <WindowFrame><GestureHandlerRootView style={{ flex: 1 }}>
      <LocalRouteParamsContext.Provider value={{ id: 'd'.repeat(64),...(exploreFixtureKey?{key:exploreFixtureKey,runId:'1',permissions:params.get('scenario')==='explore-permissions'?'1':undefined}:{}) }}>
        {RuntimeScreen ? <RuntimeScreen /> : null}
        {params.has('detail-actions') ? React.createElement(require('../../src/components/common/Toast').Toast) : null}
      </LocalRouteParamsContext.Provider><NappletOverlays />
    </GestureHandlerRootView></WindowFrame>
    </PreventRemoveContext.Provider>
    </NavigationRouteContext.Provider>
  </NavigationContext.Provider></SafeAreaProvider>;
}
AppRegistry.registerComponent('NappletSigningFixture', () => Fixture);
AppRegistry.runApplication('NappletSigningFixture', { rootTag: document.getElementById('root') });
