/* eslint-disable @typescript-eslint/no-require-imports -- Install isolated ports before loading application modules. */
import 'react-native-get-random-values';
import React from 'react';
import { AppRegistry } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initPlatformAdapters } from '../../src/platform/registry';
import type { PlatformAdapters } from '../../src/platform/ports';
import { NavigationContext } from 'expo-router/react-navigation';
import type { NappletRelease } from '../../src/services/napplet/protocol';

// This fixture renders the shipped approval UI without user data or signer access.
initPlatformAdapters({
  napplet: { setBounds: async (_id: string, _bounds: unknown, visible: boolean) => {
    (window as unknown as { nappletVisible: boolean }).nappletVisible = visible;
  } },
  clipboard: { writeText: async (text: string) => { (window as unknown as { copiedEvent: string }).copiedEvent = text; } },
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
    <GestureHandlerRootView style={{ flex: 1 }}>
      {RuntimeScreen ? <RuntimeScreen /> : null}<NappletOverlays />
    </GestureHandlerRootView>
  </NavigationContext.Provider></SafeAreaProvider>;
}
AppRegistry.registerComponent('NappletSigningFixture', () => Fixture);
AppRegistry.runApplication('NappletSigningFixture', { rootTag: document.getElementById('root') });
