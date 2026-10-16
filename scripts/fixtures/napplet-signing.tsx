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

// This fixture renders the shipped approval UI without user data or signer access.
initPlatformAdapters({
  napplet: { capture: async () => null, setBounds: async (_id: string, _bounds: unknown, visible: boolean, interactive = true) => {
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
const { NappletOverlays } = require('../../src/components/napplet/NappletOverlays') as typeof import('../../src/components/napplet/NappletOverlays');
const { nappletStore, nappletService } = require('../../src/services/napplet/service') as typeof import('../../src/services/napplet/service');
const { useThemeStore } = require('../../src/stores/theme.store') as typeof import('../../src/stores/theme.store');
require('../../src/i18n');
const params = new URLSearchParams(location.search);
useThemeStore.setState({ preference: params.get('theme') === 'dark' ? 'dark' : 'light' });
const auth = params.get('scenario') === 'auth';
const raw = params.get('scenario') === 'raw';
const scroll = params.get('scenario') === 'scroll';
nappletService.answer = (id, value) => { document.title = JSON.stringify({ id, value }); };
nappletStore.setState({
  prompt: {
    title: 'Arcade', requestId: 'fixture', expiresAt: Date.now() + 25000, queued: 2, detail: '',
    accountPubkey: 'a'.repeat(64),
    app: { title: 'Arcade', hash: 'c'.repeat(64), event: { pubkey: 'b'.repeat(64) } } as NappletRelease,
    signing: {
      operation: auth ? 'relay-auth' : 'publish', kind: auth ? 22242 : raw ? 30079 : 30078,
      accountPubkey: 'a'.repeat(64), createdAt: 100, relays: ['wss://relay.example/'],
      identifier: auth ? undefined : 'game-progress',
      content: auth ? '' : JSON.stringify({ score: 1280, level: 4, lives: 3, ...(scroll ? { entries: Array.from({ length: 40 }, (_, index) => ({ index, value: `Entry ${index}` })) } : {}) }), tags: auth ? [] : [['d', 'game-progress']],
    },
  },
});
if (params.get('scenario') === 'timeout') {
  const { PromptQueue } = require('../../src/services/napplet/prompt-queue') as typeof import('../../src/services/napplet/prompt-queue');
  const queue = new PromptQueue((prompt) => nappletStore.setState({ prompt }));
  void queue.ask(nappletStore.getState().prompt!);
}
const menu = params.get('scenario') === 'menu';
let RuntimeScreen: React.ComponentType | undefined;
if (['detail', 'permissions'].includes(params.get('scenario') ?? '')) {
  const release: NappletRelease = { title: 'Composer', key: '35129:publisher:composer', hash: 'c'.repeat(64),
    description: params.get('empty') ? '' : 'Compose and publish posts with your Nostr account.'.repeat(params.get('long') ? 30 : 1),
    required: ['identity', 'outbox', 'relay', 'resource', 'theme', 'inc', 'intent', 'link', 'storage'],
    optional: ['upload'], servers: [], intents: [],
    event: { id: 'd'.repeat(64), pubkey: 'b'.repeat(64), kind: 35129, tags: [['d', 'composer']] } as NappletRelease['event'],
  };
  profile.useDisplayName = () => ({ name: 'Arjen', profile: null });
  nappletStore.setState({ accountPubkey: 'a'.repeat(64), loaded: true, prompt: null, market: [release],
    installed: params.get('uninstalled') ? [] : [{ ...release, pinnedAt: null, lastUsedAt: null, previousManifest: null }],
  });
  const { nappletPermissionStore } = require('../../src/services/napplet/service') as typeof import('../../src/services/napplet/service');
  const { signingRuleKey, replaceSigningRule } = require('../../src/services/napplet/signing-permissions') as typeof import('../../src/services/napplet/signing-permissions');
  const storageKey = `fixture-signing-rules-${params.get('theme') ?? 'light'}`;
  let rules: import('../../src/services/napplet/signing-permissions').SigningRule[] = [{
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
  nappletService.domainPermissions = async () => ['shell', ...release.required];
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
  const release: NappletRelease = { ...nappletStore.getState().prompt!.app!,
    description: 'A small game for your account.', required: ['storage'], optional: ['identity'], servers: [], intents: [],
    event: { id: 'd'.repeat(64), pubkey: 'b'.repeat(64), kind: 35129, tags: [['d', 'arcade']] } as NappletRelease['event'],
  };
  nappletStore.setState({ accountPubkey: 'a'.repeat(64), prompt: null,
    running: { release, containerId: 'fixture' }, panel: null, overlayActive: false });
  const { nappletPermissionStore } = require('../../src/services/napplet/service') as typeof import('../../src/services/napplet/service');
  let rules: import('../../src/services/napplet/signing-permissions').SigningRule[] = [{
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
  RuntimeScreen = require('../../src/app/(app)/napplet-run').default;
  const { useForwardDraftStore } = require('../../src/stores/forward-draft.store') as typeof import('../../src/stores/forward-draft.store');
  Object.assign(window, { forwardDraft: () => useForwardDraftStore.getState().draft });
}
function Fixture() {
  return <SafeAreaProvider><NavigationContext.Provider value={{ isFocused: () => true, addListener: () => () => {} } as never}>
    <NavigationRouteContext.Provider value={{ key: 'fixture', name: 'fixture' }}>
    <PreventRemoveContext.Provider value={{ preventedRoutes: {}, setPreventRemove: () => {} }}>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <LocalRouteParamsContext.Provider value={{ id: 'd'.repeat(64) }}>
        {RuntimeScreen ? <RuntimeScreen /> : null}
      </LocalRouteParamsContext.Provider><NappletOverlays />
    </GestureHandlerRootView>
    </PreventRemoveContext.Provider>
    </NavigationRouteContext.Provider>
  </NavigationContext.Provider></SafeAreaProvider>;
}
AppRegistry.registerComponent('NappletSigningFixture', () => Fixture);
AppRegistry.runApplication('NappletSigningFixture', { rootTag: document.getElementById('root') });
