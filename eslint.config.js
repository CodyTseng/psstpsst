// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");
const typescriptEslint = require('@typescript-eslint/eslint-plugin');

// ---- Architectural layering boundaries (see docs/ARCHITECTURE.md §2) ----
// Flat config keeps only the LAST matching definition of a rule — options are
// replaced, not merged — so import bans cannot be stacked across blocks. Each
// block below declares the full union of `no-restricted-imports` patterns that
// apply to its files, composed from these shared groups:
const EXPO_BAN = {
  group: ['expo-*'],
  message: 'Core layers use platform ports (@/platform) instead of expo APIs.',
};
const RN_BAN = {
  group: ['react-native', 'react-native-*'],
  message: 'Core layers use platform ports (@/platform) instead of react-native APIs.',
};
// The Expo SQLite binding is confined to src/platform/expo/database.ts.
const DRIZZLE_BAN = {
  group: ['drizzle-orm/expo-sqlite', 'drizzle-orm/expo-sqlite/*', 'expo-sqlite'],
  message:
    'The expo-sqlite binding is confined to seam files — use @/db/use-live-query and @/db/client.',
};
const PLATFORM_APP_BAN = {
  group: [
    '@/services/*', '@/db/*', '@/stores/*', '@/i18n/*',
    '@/components/*', '@/app/*', '@/hooks/*',
  ],
  message: 'The platform layer must not depend on app layers.',
};
const UI_BAN = {
  group: ['@/stores/*', '@/components/*', '@/app/*', '@/hooks/*'],
  message:
    'Services must not depend on UI layers (stores/components/app/hooks).',
};
const DB_HANDLE_BAN = {
  group: ['@/db/client'],
  message: 'UI reads data via src/hooks — never the raw db handle.',
};
const ADAPTER_BAN = {
  group: ['@/platform/expo/*'],
  message: 'Use ports via @/platform — never adapters directly.',
};

const restrict = (...patterns) => ['error', { patterns }];

// Database transactions are asynchronous; await every statement inside an
// async callback.
const TRANSACTION_SYNTAX_RULES = [
  {
    selector:
      "CallExpression[callee.property.name='transaction'] > ArrowFunctionExpression[async=false]",
    message:
      "Database transactions are asynchronous; await every statement inside an async callback.",
  },
  {
    selector:
      "CallExpression[callee.property.name='transaction'] > FunctionExpression[async=false]",
    message:
      "Database transactions are asynchronous; await every statement inside an async callback.",
  },
];
// React Native Web's Alert is a no-op, so on the desktop shell an Alert-based
// confirmation never fires its buttons and a notice is never shown. All modal
// dialogs go through the confirmationDialog port; the single sanctioned Alert
// consumer is src/platform/expo/confirmation-dialog.ts (exempted below).
const ALERT_SYNTAX_BAN = {
  selector:
    "ImportDeclaration[source.value='react-native'] > ImportSpecifier[imported.name='Alert']",
  message:
    "Use platform.confirmationDialog (@/platform) instead of Alert — RN Web's Alert is a no-op on desktop.",
};

module.exports = defineConfig([
  expoConfig,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: { '@typescript-eslint': typescriptEslint },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // React Compiler readiness rules (eslint-plugin-react-hooks v7) flag a large
      // body of pre-existing, intentionally imperative code: refs held for command
      // handlers, Reanimated `.value` writes inside worklets, effect-driven
      // async/measure/lifecycle state. These are advisory for us — the Compiler
      // safely *bails out* of a component it can't optimize (the code still runs
      // correctly, it just isn't auto-memoized), so we keep them visible as
      // warnings instead of build-breaking errors, and pay them down case by case.
      // `react-hooks/rules-of-hooks` stays an error (inherited from expoConfig) —
      // that one is a real correctness bug, not a missed optimization.
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/use-memo": "warn",
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          // Event handlers and effects cannot return promises. `void` is allowed
          // only as an explicit marker; fire-and-forget helpers must handle their
          // own failures, and other call sites should attach a rejection handler.
          ignoreVoid: true,
        },
      ],
      "no-restricted-syntax": ["error", ...TRANSACTION_SYNTAX_RULES, ALERT_SYNTAX_BAN],
    },
  },
  {
    // Baseline for everything under src/: the drizzle seam ban applies to every
    // file not covered by a more specific block below.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: { 'no-restricted-imports': restrict(DRIZZLE_BAN) },
  },
  {
    // Ports are pure interface definitions: no platform or app-layer imports.
    files: ['src/platform/ports/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(
        {
          group: ['expo-*', 'react-native', 'react-native-*'],
          message: 'Ports are pure interfaces — implementations live in src/platform/expo/.',
        },
        {
          group: [
            '@/services/*', '@/db/*', '@/stores/*', '@/lib/*',
            '@/i18n/*', '@/components/*', '@/app/*', '@/hooks/*',
          ],
          message: 'Ports must not depend on app layers.',
        },
        DRIZZLE_BAN,
      ),
    },
  },
  {
    // The platform layer (registry + index) must not depend on app layers.
    files: ['src/platform/**/*.ts'],
    ignores: ['src/platform/ports/**', 'src/platform/expo/**'],
    rules: { 'no-restricted-imports': restrict(PLATFORM_APP_BAN, DRIZZLE_BAN) },
  },
  {
    // Adapters are the only code allowed to touch expo-*/react-native (plus
    // pure @/lib helpers and the drizzle seam in database.ts); the app-layer
    // ban still applies.
    files: ['src/platform/expo/**/*.ts'],
    rules: { 'no-restricted-imports': restrict(PLATFORM_APP_BAN) },
  },
  {
    // Services reach OS capabilities through ports only, and never depend on UI
    // layers — session state ownership lives in the service layer (e.g.
    // services/dm/delivery-status.ts), UI binds to it.
    files: ['src/services/**/*.ts'],
    ignores: ['**/__tests__/**'],
    rules: { 'no-restricted-imports': restrict(EXPO_BAN, RN_BAN, DRIZZLE_BAN, UI_BAN) },
  },
  {
    // The remaining core layers reach OS capabilities through ports only.
    files: ['src/db/**/*.ts', 'src/stores/**/*.ts', 'src/i18n/**/*.ts', 'src/lib/**/*.ts'],
    ignores: ['**/__tests__/**'],
    rules: { 'no-restricted-imports': restrict(EXPO_BAN, RN_BAN, DRIZZLE_BAN) },
  },
  {
    // UI layers read data via hooks/stores (never the raw db handle) and use
    // ports via @/platform (never adapters directly).
    files: [
      'src/app/**/*.ts', 'src/app/**/*.tsx',
      'src/components/**/*.ts', 'src/components/**/*.tsx',
    ],
    ignores: ['**/__tests__/**'],
    rules: { 'no-restricted-imports': restrict(DRIZZLE_BAN, DB_HANDLE_BAN, ADAPTER_BAN) },
  },
  {
    files: ['src/hooks/**/*.ts', 'src/hooks/**/*.tsx'],
    ignores: ['**/__tests__/**'],
    rules: { 'no-restricted-imports': restrict(DRIZZLE_BAN, ADAPTER_BAN) },
  },
  {
    // Sanctioned single-point wrappers: each of these files owns its platform
    // import on purpose (thin pass-throughs, in the spirit of lib/haptics.ts).
    files: [
      'src/lib/haptics.ts',
      'src/lib/clipboard.ts',
      'src/lib/navigation.ts',
      'src/lib/platform.ts',
      'src/lib/attachments/failure.ts',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // The Expo dialog adapter is the one sanctioned Alert consumer (it owns
    // the mobile implementation of the confirmationDialog port). Keep the
    // transaction syntax rules; lift only the Alert import ban.
    files: ['src/platform/expo/confirmation-dialog.ts'],
    rules: { 'no-restricted-syntax': ['error', ...TRANSACTION_SYNTAX_RULES] },
  },
  {
    // These public @libp2p/noise subpath exports resolve through package.json
    // for TypeScript, Jest, and the application bundlers. eslint-plugin-import's
    // legacy resolver does not understand this ESM export map.
    files: ['src/services/proximity/test-support/noise-test-port.ts'],
    rules: { 'import/no-unresolved': 'off' },
  },
  {
    ignores: ["dist/*"],
  }
]);
