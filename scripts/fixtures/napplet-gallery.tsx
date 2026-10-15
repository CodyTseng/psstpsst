/* eslint-disable @typescript-eslint/no-require-imports -- Install isolated ports before loading application modules. */
import 'react-native-get-random-values';
import React, { useState } from 'react';
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
  localization: { preferredLanguageTag: () => 'en' },
} as unknown as PlatformAdapters);
const { NappletGrid } =
  require('../../src/components/napplet/NappletGrid') as typeof import('../../src/components/napplet/NappletGrid');
const { AppText } =
  require('../../src/components/common/AppText') as typeof import('../../src/components/common/AppText');
const { useThemeColors } = require('../../src/theme') as typeof import('../../src/theme');
const { useThemeStore } =
  require('../../src/stores/theme.store') as typeof import('../../src/stores/theme.store');
require('../../src/i18n');
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
  pinnedAt: index === 0 ? 1 : null,
  previousManifest: null,
})) as unknown as NappletInstallation[];
const { AppButton } = require('../../src/components/common/AppButton') as typeof import('../../src/components/common/AppButton');
function Gallery() {
  const [opened, setOpened] = useState<string | null>(null);
  const [items, setItems] = useState(apps);
  const c = useThemeColors();
  return (
    <SafeAreaProvider>
      <NavigationContext.Provider
        value={{ isFocused: () => true, addListener: () => () => {} } as never}
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: c.background, paddingTop: 48 }}>
            <AppText variant="title" align="center">
              Mini apps
            </AppText>
            {opened ? <AppButton label="Close app" onPress={() => setOpened(null)} /> : <NappletGrid
              items={items}
              bottomInset={48}
              onOpen={(app) => {
                document.title = `Opened ${app.title}`;
                setOpened(app.title);
              }}
              onAction={(app, action) => {
                document.title = `${action}:${app.title}`;
                setItems((old) =>
                  (action === 'remove'
                    ? old.filter((item) => item.key !== app.key)
                    : old.map((item) =>
                        item.key === app.key
                          ? { ...item, pinnedAt: action === 'pin' ? Date.now() : null }
                          : item,
                      )
                  ).sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)),
                );
              }}
            />}
          </View>
        </GestureHandlerRootView>
      </NavigationContext.Provider>
    </SafeAreaProvider>
  );
}
AppRegistry.registerComponent('NappletGallery', () => Gallery);
AppRegistry.runApplication('NappletGallery', { rootTag: document.getElementById('root') });
