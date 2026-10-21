/* eslint-disable @typescript-eslint/no-require-imports -- Install isolated ports before loading application modules. */
import 'react-native-get-random-values';
import React, { useState, useEffect } from 'react';
import { AppRegistry, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContext } from 'expo-router/react-navigation';
import { initPlatformAdapters } from '../../src/platform/registry';
import type { PlatformAdapters } from '../../src/platform/ports';
import type { NappletInstallation } from '../../src/services/napplet/protocol';

// A visual fixture never opens the user's database, account, or network sessions.
initPlatformAdapters({
  database: { drizzle: () => ({}) },
  appState: { currentState: () => 'active', addChangeListener: () => () => {} },
  networkState: { getState: async () => ({ isConnected: false }), addStateListener: () => () => {} },
  localization: { preferredLanguageTag: () => 'en' },
} as unknown as PlatformAdapters);
const profile = require('../../src/hooks/use-display-name') as typeof import('../../src/hooks/use-display-name');
profile.useDisplayName = () => ({ name: 'Alice', profile: null });
const { NappletGrid } =
  require('../../src/components/napplet/NappletGrid') as typeof import('../../src/components/napplet/NappletGrid');
const { NappletRecentPage } = require('../../src/components/napplet/NappletRecentPage') as typeof import('../../src/components/napplet/NappletRecentPage');
const { AppText } =
  require('../../src/components/common/AppText') as typeof import('../../src/components/common/AppText');
const { useThemeColors } = require('../../src/theme') as typeof import('../../src/theme');
const { useThemeStore } =
  require('../../src/stores/theme.store') as typeof import('../../src/stores/theme.store');
const locale = require('../../src/i18n').default as typeof import('../../src/i18n').default;
const rtl = new URLSearchParams(location.search).has('rtl');
void locale.changeLanguage(rtl ? 'ar' : 'en');
// The isolated fixture has no Expo Router tree; supply only its loaded-navigation signal.
require('expo-router/build/global-state/store').storeRef.current.navigationRef = { current: {} };
useThemeStore.setState({
  preference: new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light',
});

const names = [
  'Weather',
  'Notes',
  'Chess',
  'Calculator',
  'Drawing',
  'Timer',
  'Bookmarks',
  'Calendar',
  'Puzzle',
  'Reader',
  'Colors',
  'Music',
];
const long = new URLSearchParams(location.search).has('long');
if (long) names.push(...Array.from({ length: 80 }, (_, index) => `App ${index + 1}`));
const history = new URLSearchParams(location.search).has('history');
const storageKey = history ? 'gallery-desktop-history' : long ? 'gallery-desktop-long' : 'gallery-desktop';
const apps = names.map((title, index) => ({
  key: title,
  title,
  hash: 'a'.repeat(64),
  required: [],
  optional: [],
  servers: [],
  intents: [],
  description: '',
  event: {},
  lastUsedAt: 100 - index,
  desktopPosition: index < 9 ? index : null,
  previousManifest: null,
})) as unknown as NappletInstallation[];
const { AppButton } = require('../../src/components/common/AppButton') as typeof import('../../src/components/common/AppButton');
function Gallery() {
  const [recentPage, setRecentPage] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [keys, setKeys] = useState<string[]>(() => {
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) : (long && !history ? apps : apps.slice(0, 9)).map((app) => app.key);
  });
  const [recent, setRecent] = useState(long ? apps : [apps[9], apps[0], apps[1], apps[5], apps[10], apps[11]]);
  const items = keys.map((key, desktopPosition) => ({ ...apps.find((app) => app.key === key)!, desktopPosition }));
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(keys)); }, [keys]);
  const currentRecent = recent.map((app) => ({ ...app, desktopPosition: keys.includes(app.key) ? keys.indexOf(app.key) : null }));
  function open(app: NappletInstallation) {
    document.title = `Opened ${app.title}`;
    setRecent((old) => [app, ...old.filter((item) => item.key !== app.key)]);
    setOpened(app.title);
  }
  function move(app: NappletInstallation, index: number | null) {
    const apply = () => {
      document.title = `move:${app.title}:${index}`;
      setKeys((old) => {
        const next = old.filter((key) => key !== app.key);
        if (index !== null) next.splice(Math.min(index, next.length), 0, app.key);
        return next;
      });
    };
    if (new URLSearchParams(location.search).has('slow-drop')) {
      return new Promise<void>((resolve) => setTimeout(() => { apply(); resolve(); }, 240));
    }
    apply();
  }
  const removeRecent = (app: NappletInstallation) => setRecent((old) => old.filter((item) => item.key !== app.key));
  const details = (app: NappletInstallation) => { document.title = `Details ${app.title}`; };
  const addRecent = (app: NappletInstallation) => { if (app.desktopPosition === null) return move(app, items.length); };
  const c = useThemeColors();
  return (
    <SafeAreaProvider>
      <NavigationContext.Provider
        value={{ isFocused: () => true, addListener: () => () => {} } as never}
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: c.background, direction: rtl ? 'rtl' : 'ltr' }}>
            {recentPage && !opened ? <NappletRecentPage recent={currentRecent} onBack={() => setRecentPage(false)}
              onAdd={addRecent} onRemove={removeRecent} onDetails={details} onPermissions={(app) => { document.title = `Permissions ${app.title}`; }} onShare={(app) => { document.title = `Share ${app.title}`; }} /> : <View style={{ flex: 1, paddingTop: 48, backgroundColor: c.background }}>
            <AppText variant="title" align="center">
              Explore
            </AppText>
            {opened ? <AppButton label="Close app" onPress={() => setOpened(null)} /> : <NappletGrid
              items={items}
              bottomInset={48}
              recent={currentRecent}
              onShowRecent={() => setRecentPage(true)} onRemoveRecent={removeRecent} onDetails={details} onPermissions={(app) => { document.title = `Permissions ${app.title}`; }} onShare={(app) => { document.title = `Share ${app.title}`; }} onOpen={open} onMove={move}
            />}
            </View>}
          </View>
        </GestureHandlerRootView>
      </NavigationContext.Provider>
    </SafeAreaProvider>
  );
}
AppRegistry.registerComponent('NappletGallery', () => Gallery);
AppRegistry.runApplication('NappletGallery', { rootTag: document.getElementById('root') });
