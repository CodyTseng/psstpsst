# Contributing to PsstPsst

Bug reports, documentation, translations, tests, and focused fixes are welcome.
Search existing issues before starting work. Discuss major features with the
maintainer first so the proposal fits the project's priorities.

## Reporting problems

Use the repository's issue templates and include the app version or commit,
platform, reproduction steps, and expected behavior. Remove private messages,
keys, wallet connection strings, and identifying data from logs and screenshots.
For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public
issue with technical details.

## Development setup

- Node.js 22 and npm (matching CI)
- For iOS: macOS, Xcode 26.4 or newer, CocoaPods, and an Apple development
  team for device signing
- For Android: Android Studio, the Android SDK and NDK, and JDK 17 (matching CI)
- For Electron Nearby support: Xcode command-line tools on macOS, or stable
  Rust on Windows and Linux. Windows also needs the MSVC build tools; Linux
  needs a C/C++ toolchain and pkg-config. The helper builds its vendored D-Bus
  library; Nearby at runtime requires BlueZ and a compatible Bluetooth adapter.

Use the [Expo SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/)
when changing native configuration or Expo APIs. SDK 57 targets React Native
0.86. Native development requires a development build because PsstPsst includes
local native modules; Expo Go is not sufficient for the complete application.

### Install

Fork and clone the repository, then work from its root directory.

On Windows, use Git Bash and add `--script-shell=bash` to npm run commands, for
example `npm --script-shell=bash run electron:dev`. The npm scripts use
POSIX environment assignments; the desktop native helper still builds through
Windows PowerShell.

Install dependencies:

```bash
npm ci
```

The generated `ios/` and `android/` directories are intentionally ignored by
Git. Expo creates them on the first native build. Regenerate them after changing
`app.json`, config plugins, or native dependencies. Choose the command for the
platform you are working on (iOS requires macOS):

```bash
EXPO_PUBLIC_APP_ENV=development npx expo prebuild --platform ios --clean
# Or, for Android:
EXPO_PUBLIC_APP_ENV=development npx expo prebuild --platform android --clean
```

`--clean` replaces the selected native project directory. Save any native edits
in app config, config plugins, or local modules before regenerating it.
Do not place lasting native configuration directly in those generated
directories; use `app.json`, a config plugin, or a local Expo module instead.

## Running the app

These commands run development builds with Metro and Fast Refresh. For standalone
apps with bundled JavaScript, see [Build from source](README.md#build-from-source).
After a production mobile build, regenerate the native project with the
`EXPO_PUBLIC_APP_ENV=development` prebuild command above before running `*:dev`.

### iOS

Start Metro in one terminal:

```bash
npm start
```

Then compile, install, and open the iOS development build from another terminal:

```bash
npm run ios:dev
```

The script prompts for a simulator or connected device. Use a physical device
for Bluetooth, notification, background-task, camera, and biometric testing.
Native changes require rebuilding with `npm run ios:dev`; JavaScript and styling
changes use Fast Refresh through the running Metro server.

### Android

Start Metro in one terminal:

```bash
npm start
```

Then compile, install, and open the Android development build from another
terminal:

```bash
npm run android:dev
```

The script prompts for an emulator or connected device. Use a physical device
for Bluetooth, notification, background-task, camera, and biometric testing.
Native changes require rebuilding with `npm run android:dev`; JavaScript and styling
changes use Fast Refresh through the running Metro server.

### Electron

Build the host-specific Nearby helper and Electron main process, start the
Electron renderer through Metro, and launch the application with:

```bash
npm run electron:dev
```

Renderer changes use Fast Refresh. Changes to the Electron main process,
preload, database worker, or native Nearby helper require restarting the
command. Only one PsstPsst Electron instance should be running during
development.

Rebuild native desktop dependencies after changing Electron or native package versions:

```bash
npm run electron:rebuild
```

### Performance logging

Development builds ship opt-in performance instrumentation (`[perf]` spans,
`[perf:stats]` aggregates, and a `[perf:lag]` event-loop stall warning). It is
gated by `src/lib/perf/profiler.ts`, which reads
`globalThis.__PSSTPSST_PERF_LOGS__ === true` once at module load, so the flag
must be set before the app's imports evaluate: add
`globalThis.__PSSTPSST_PERF_LOGS__ = true;` to a one-line module imported first
from `index.ts` (a plain statement in `index.ts` runs too late — `import`
declarations are hoisted), or temporarily hardcode the gate in `profiler.ts`.
Then reload the app so every module re-evaluates; a native rebuild is not
required.

The development scripts set `EXPO_PUBLIC_APP_ENV=development`; absent or unknown
values select production behavior. Public Expo variables are bundled into the
application and must never contain secrets. No private `.env` file or release
signing credentials are required for ordinary development.

## Project conventions

- Keep documentation and code comments in English. User-facing copy belongs in
  `src/i18n/`; follow the existing locale structure.
- Read [AGENTS.md](AGENTS.md) and [the architecture guide](docs/ARCHITECTURE.md)
  before changing system boundaries. UI reads through hooks/stores and starts
  work through services; new OS capabilities start with a platform port.
- Read [the design system](docs/DESIGN.md), especially its hard rules, before any
  UI change. Explain any exception in the PR or commit message. Update durable
  design or architecture rules in the same change when the convention changes.
- Bound history queries and keep work incremental. Explain the cost of changes
  affecting large histories or the UI thread; use realistic data for performance
  checks.
- Add or update tests for meaningful behavior changes. UI-only changes should
  include screenshots; native and Bluetooth changes need device verification.
- Use Conventional Commits, with an optional scope: `fix: restore message
  delivery`, `docs: clarify setup`, or `feat(chat): add reply navigation`.

## Quality checks

Run the same checks used by the quality and third-party notices workflows:

```bash
npm run lint
npx tsc --noEmit
npm test -- --ci
npm run test:dependencies
npm run licenses:check
npm run licenses:test
```

The quality workflow runs on pull requests and pushes to `master`, without release
secrets. License verification runs separately and does not install dependencies.
To iterate on a specific test, use `npm test -- --runTestsByPath path/to/test.ts`.

Run relevant native and release-tool tests when changing those paths. See
[Android QR scanning](docs/ANDROID_QR_SCANNER.md) and
[releasing](docs/RELEASING.md). Simulators and unit tests cannot validate Bluetooth
interoperability, OS background scheduling, or release signing.

Dependency changes must update `package-lock.json` and the reviewed
[third-party notices](docs/OPEN_SOURCE_NOTICES.md). Use `npx expo install` for
Expo-compatible dependencies, and review patches under `patches/` when upgrading.
See [dependency security](docs/DEPENDENCY_SECURITY.md) for the local security
patches, remaining audit findings, and the conditions for removing each patch.

## Sending a pull request

Keep the change focused. Explain the user-visible problem, resulting behavior,
and verification results. Include related issues, screenshots where relevant,
and any compatibility, migration, or performance considerations. Explicitly
state checks that you could not run. Use the existing PR template; remove unused
sections.

For distribution builds, signing, release artifacts, and desktop updates, use
[the release guide](docs/RELEASING.md).
