# Building and releasing PsstPsst

This guide covers the `Build Apps` workflow in
[`build.yml`](../.github/workflows/build.yml), Android distribution through
Zapstore and F-Droid, and local iOS builds. CI currently builds macOS arm64,
Windows x64/arm64, Linux x64/arm64, and a universal Android APK. It does not build
or upload iOS apps, submit to F-Droid, or publish Nostr events to Zapstore.

## First public release

Before making the repository public or publishing its first release:

1. Create the canonical `codytseng/psstpsst` repository. Confirm the repository
   links, `RELEASE_REPOSITORY` in the build workflow, and desktop update feed
   all point to it. Point the local Git remote at the new repository before
   pushing; do not publish a tag from the old repository.
2. Scan the complete Git history and release artifacts for credentials,
   private keys, signing files, personal data, and test-account secrets. Review
   findings and revoke exposed credentials before publishing. Ignoring a file
   does not remove it from earlier commits.
3. Enable GitHub private vulnerability reporting and verify that the reporting
   link in [SECURITY.md](../SECURITY.md) works. Review that policy and
   the [website privacy policy](https://psstpsst.chat/privacy/) against the
   release's actual behavior. Maintain the privacy policy on the website only.
4. Require the quality and third-party notices workflows for pull requests in
   the repository's branch rules. Verify they pass on the release commit and
   review native dependency notices as described below.
5. Test the signed artifacts on their target platforms, including fresh
   installation, upgrades, key transfer, history export/import, offline use,
   notifications, and Nearby interoperability. Record tested versions and
   limitations in the release notes.
6. Publish the reviewed release, then replace the README's first-release notice
   with the actual download and store links. Do not advertise a store listing
   or a completed security audit until it exists.

## Workflow behavior

| Trigger and credentials | Result |
| --- | --- |
| Manual run on a branch, no signing secrets for a platform | Unsigned macOS package or debug-signed Android APK for testing |
| Manual run with complete signing secrets | Signed Android APK; signed and notarized macOS packages |
| Any run with only some signing secrets for either platform | Fails before building, listing missing secret names |
| Run on a `v*` tag without complete macOS and Android credentials | Fails before building |
| Push a matching `v*` tag with complete credentials | Builds the configured Android and desktop targets and creates or updates a draft GitHub Release |

Manual runs only upload Actions artifacts, retained for 14 days. Tag publishing
runs only in `codytseng/psstpsst`, waits for all six builds, and requires all
installers and desktop update metadata. Publish the draft manually after testing.
Re-runs may replace draft assets but refuse to modify a published release.

The preflight checks credential presence; invalid passwords, certificates, or
Apple account permissions still fail at signing or notarization. A manual run
on a tag requires signatures too, but does not create a release.

To check changes to the signing helper, run
`node --test scripts/release-signing.test.mjs`. With `ANDROID_HOME` pointing to
an SDK containing platform 36 and Build Tools 36.0.0, the tests also create a
temporary APK and disposable keys to exercise real signature replacement and
verification. Without that SDK, the integration test is skipped.

## Add GitHub configuration

Open the repository's **Settings > Secrets and variables > Actions > Secrets >
New repository secret**. Use the exact names below. These are repository
secrets, not Actions variables. Do not commit private keys or passwords.

Alternatively, authenticate `gh` and use `gh secret set NAME --repo
codytseng/psstpsst` to enter a value interactively. For encoded certificate files,
redirect the file into `gh secret set` as shown below. The release job uses
GitHub's automatic `GITHUB_TOKEN`; no personal GitHub token or Expo token is
needed by this workflow.

### macOS: Developer ID signing and notarization

These packages are distributed directly through GitHub, outside the Mac App
Store. Use an active Apple Developer Program membership and a **Developer ID
Application** certificate with its private key. An iOS distribution certificate
or Developer ID Installer certificate is not the certificate for this app.

| Repository secret | Value |
| --- | --- |
| `MAC_CSC_LINK` | Base64 contents of the exported Developer ID Application `.p12`, including its private key |
| `MAC_CSC_KEY_PASSWORD` | Nonempty password chosen when exporting that `.p12` |
| `APPLE_ID` | Apple Account email authorized to notarize for the team |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password generated for that Apple Account; not its login password |
| `APPLE_TEAM_ID` | The developer team's 10-character Team ID |

1. Create or obtain a Developer ID Application certificate through Xcode's
   account/certificate management or the Apple Developer portal. Install it on
   the Mac that holds the corresponding private key.
2. In Keychain Access, open **My Certificates**, locate the Developer ID
   Application identity, and confirm it expands to show a private key. Export
   that identity as a password-protected `.p12`.
3. Generate an app-specific password in the Apple Account security settings.
   Find the Team ID in the Apple Developer account's membership details.
4. Encode the `.p12` outside the repository and upload it as a secret. For
   example, from the private directory containing the export:

   ```bash
   umask 077
   node -e 'process.stdout.write(require("node:fs").readFileSync("developer-id.p12").toString("base64"))' > developer-id.p12.base64
   gh secret set MAC_CSC_LINK --repo codytseng/psstpsst < developer-id.p12.base64
   ```

5. Add the other four secrets using the table above. Keep a secure backup of
   the certificate and private key; the Base64 file is also sensitive.

CI maps the `MAC_CSC_*` secrets to electron-builder's `CSC_LINK` and
`CSC_KEY_PASSWORD`. With all credentials present, electron-builder signs,
submits for notarization, and staples the ticket. Without any macOS credentials,
a manual branch run explicitly disables signing, hardened runtime, and
notarization for its test artifact. Tag runs never use that fallback.

For a local signed build, set `CSC_LINK` to the absolute `.p12` path and load
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`
into the environment through your private secret management. Then run:

```bash
npm ci
npm run electron:package -- --mac --arm64 --publish never
codesign --verify --deep --strict --verbose=2 release/mac-arm64/PsstPsst.app
spctl --assess --type execute --verbose=2 release/mac-arm64/PsstPsst.app
xcrun stapler validate release/mac-arm64/PsstPsst.app
```

The public installers are `release/PsstPsst-<version>-mac-arm64.dmg` and `.zip`.
Test the downloaded package on another Mac as well. See
[electron-builder's v26 notarization guide](https://www.electron.build/v26/docs/features/code-signing/notarization/).

### Android: developer-owned APK signing

Use one long-lived app signing key for GitHub and Zapstore releases. Reuse the
existing signing key if this application ID has already been distributed.
Changing the key normally prevents an in-place update of an installed app.
Back up the keystore, alias, and passwords independently of GitHub Secrets.

To create a new key, run this in a private directory outside the repository.
The command prompts for the password and certificate details:

```bash
umask 077
keytool -genkeypair -v -storetype PKCS12 \
  -keystore psstpsst-release.keystore -alias psstpsst \
  -keyalg RSA -keysize 4096 -validity 10000
node -e 'process.stdout.write(require("node:fs").readFileSync("psstpsst-release.keystore").toString("base64"))' > psstpsst-release.keystore.base64
gh secret set ANDROID_KEYSTORE_BASE64 --repo codytseng/psstpsst < psstpsst-release.keystore.base64
```

| Repository secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 contents of the complete `.keystore`, `.jks`, or `.p12` file |
| `ANDROID_KEYSTORE_PASSWORD` | Password protecting the keystore |
| `ANDROID_KEY_ALIAS` | Alias of the private key; `psstpsst` in the example |
| `ANDROID_KEY_PASSWORD` | Password protecting that key; use the store password for the PKCS12 example |

All four values must be nonempty. CI installs Android Build Tools 36.0.0,
generates the native project from the checked-in Expo configuration, and runs
Gradle's `:app:assembleRelease`. It then replaces the template's debug signature
using `apksigner`, verifies the resulting APK, and uploads
`PsstPsst-<version>-android.apk`. The decoded keystore exists only in a temporary
directory during signing and is removed afterward. Passwords are read from
environment variables, not passed as literal command arguments.

No production credentials are written into the generated Gradle project. This
keeps source builds independent of CI signing credentials. Running Gradle alone
still produces a debug-signed release-mode APK. For the same signing flow locally,
load the four `ANDROID_*` values into your environment and run:

```bash
npm ci
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
sdkmanager "build-tools;36.0.0"
npx expo prebuild --platform android --clean --no-install
(cd android && ./gradlew :app:assembleRelease --no-daemon --max-workers=2)
node scripts/release-signing.mjs check android
node scripts/release-signing.mjs sign-android \
  android/app/build/outputs/apk/release/app-release.apk \
  release/PsstPsst-android.apk
```

The SDK path above is the usual macOS location; use your SDK path on other
systems. The script also accepts `ANDROID_SDK_ROOT` or an explicit `APKSIGNER`
executable path. With no signing secrets it retains the debug signature for local
testing; export `GITHUB_REF=refs/tags/v<version>` to require formal credentials
when invoking the helper outside CI.

Record the certificate's public SHA-256 fingerprint and compare it with the
fingerprint printed by the signing step:

```bash
keytool -list -v -keystore /absolute/path/to/psstpsst-release.keystore -alias psstpsst
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs release/PsstPsst-android.apk
```

See Android's [signing guide](https://developer.android.com/studio/publish/app-signing)
and [apksigner reference](https://developer.android.com/tools/apksigner).

### Zapstore and F-Droid

For Zapstore, publish the signed APK as a public GitHub Release asset first.
Install the official `zsp` publisher, then use `zsp publish --wizard`, selecting
`https://github.com/codytseng/psstpsst` as the release source. Review the generated
`zapstore.yaml` before adding it to version control. The first publish links the
APK certificate to the developer's Nostr identity and requires access to the
keystore. Nostr event signing is separate from Android APK signing. For future
automation, Zapstore recommends a NIP-46 bunker through `SIGN_WITH`; the current
workflow neither reads this variable nor publishes to Zapstore. Follow the
[Zapstore publishing guide](https://zapstore.dev/docs/publish).

For the official F-Droid repository, submit source and a build recipe to
`fdroiddata`; uploading a GitHub APK alone does not list the app. F-Droid normally
builds and signs apps itself. To distribute this developer-signed APK, the recipe
must reproduce it and specify the upstream binary URL and allowed signing
certificate fingerprint (`Binaries`/`binary` and `AllowedAPKSigningKeys`). F-Droid
can then verify the APK without receiving the private key.

This project has not yet passed that reproducibility check. Pin and verify the
Expo template, Node/npm, JDK, Gradle/AGP, Android SDK/NDK, and native dependencies
in the build recipe; a lockfile and successful CI build alone are insufficient.
Mobile notifications use the project's local native module. CI rejects FCM and
the removed notification SDK in Android's release runtime dependency tree.
Android barcode scanning uses ZXing-C++ through the patched Expo Camera module.
CI rejects ML Kit dependencies and checks the APK for its libraries, models, and
class references, as well as the ZXing-C++ reader for each packaged ABI. See
[Android QR scanning](./ANDROID_QR_SCANNER.md) for maintenance and testing.
These checks do not replace a complete license and binary audit. Retaining a
single signature across GitHub, Zapstore, and F-Droid is the intended path;
using F-Droid's own signature instead prevents ordinary cross-channel updates.
See F-Droid's [inclusion policy](https://f-droid.org/docs/Inclusion_Policy/)
and [reproducible builds guide](https://f-droid.org/docs/Reproducible_Builds/).

## Electron builds and updates

Build the main process, preload, database and Noise workers, and production renderer
without creating an installer:

```bash
npm run electron:build
```

Create artifacts for the current host platform:

```bash
npm run electron:package -- --publish never
```

Electron Builder writes artifacts to `release/`:

- macOS: DMG and ZIP; packaging intentionally requires a valid signing identity
- Windows: x64/arm64 NSIS
- Linux: x64/arm64 AppImage and DEB

Linux x64 artifacts use the target's architecture spelling: `linux-x86_64.AppImage`
and `linux-amd64.deb`. ARM64 artifacts use `linux-arm64` for both targets. Keep
the release workflow's required asset names aligned with these output names.

Build Electron on each target operating system because the application includes
platform-native dependencies and a host-specific Nearby helper.

Packaged builds check the public `codytseng/psstpsst` GitHub Releases feed after
startup. A new version is never downloaded automatically, and a downloaded
version is never installed on quit: the user confirms each phase separately.
The updater supports the signed macOS DMG/ZIP, Windows NSIS, and Linux AppImage
targets.

The publish configuration creates the platform update metadata (`latest-mac.yml`,
Linux's architecture-aware files, and the separate
`latest-x64.yml`/`latest-arm64.yml` Windows channels). To build and upload one
platform directly to a draft GitHub release, load `GH_TOKEN` from your secret
manager into the environment, then run:

```bash
npm run electron:package -- --publish always
```

Keep the release as a draft until every platform artifact and metadata file is
present, then publish it. Update `desktop/package.json`'s version before building.
macOS updates require signing and notarization; Windows releases should also be
signed before public distribution. Final publication and full platform
verification are intentionally manual.

## iOS: compile, archive, and distribute

Use a Mac with Xcode 26.4 or newer compatible with Expo SDK 56, the iOS SDK and
simulator runtime, CocoaPods, and Node.js 22. Select the full Xcode installation:

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
xcodebuild -version
pod --version
npm ci
```

Complete Xcode's first-launch setup and license prompts before building. See the
[Expo SDK 56 requirements](https://docs.expo.dev/versions/v56.0.0/).

### Simulator and device development

Start Metro with `npm start`, then run `npm run ios` in another terminal and
select a simulator or attached device. The script compiles, installs, and opens
the app. A simulator does not need a distribution certificate. For a physical
device, sign in under **Xcode > Settings > Accounts**, enable Developer Mode on
the device, and select your team for app signing. Test Bluetooth and background
behavior on physical devices.

For a release-mode device build with bundled JavaScript:

```bash
npx expo run:ios --configuration Release --device
```

This installs a local build; it does not create a TestFlight submission.

### Signing configuration and archive

TestFlight and App Store distribution require Apple Developer Program membership
and an App Store Connect app record. The macOS Developer ID `.p12` is not an iOS
distribution identity. Xcode can manage iOS certificates and provisioning
profiles through automatic signing.

1. In `app.json`, set `expo.ios.appleTeamId` to your team's ID so the setting
   survives regeneration. Keep `expo.ios.bundleIdentifier` registered to that
   team. Increment `expo.ios.buildNumber` before each new uploaded build.
2. Generate the iOS project and open the workspace:

   ```bash
   npx expo prebuild --platform ios --clean
   xed ios
   ```

   Prebuild installs pods. If dependency installation was skipped, run
   `npx pod-install` before opening the workspace. `--clean` replaces the generated
   directory: save durable changes in app config or plugins first.
3. Select the **PsstPsst** scheme. For both the app and the
   **expo-sharing-extension** target, choose the same team under **Signing &
   Capabilities** and enable automatic signing. With current config, register:

   | Item | Identifier |
   | --- | --- |
   | Main application | `chat.psstpsst.app` |
   | Share extension | `chat.psstpsst.app.expo-sharing-extension` |
   | Shared App Group, enabled for both targets | `group.chat.psstpsst.app` |

   If you change these defaults, update the Expo app/plugin configuration and
   the corresponding Apple identifiers together. Confirm generated entitlements
   and provisioning profiles include the App Group.
4. Choose **Any iOS Device (arm64)** or the equivalent generic device destination,
   then **Product > Archive**. A simulator destination cannot create an App Store
   archive. Confirm the archive contains the app and share extension.
5. In Organizer, choose **Validate App**, then **Distribute App > App Store
   Connect** to upload. After processing, configure TestFlight testers or submit
   the version for App Review in App Store Connect. Complete the privacy and
   export-compliance questions based on the application's actual behavior.

For a command-line archive after signing is configured:

```bash
mkdir -p release
xcodebuild -workspace ios/PsstPsst.xcworkspace -scheme PsstPsst \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$PWD/release/PsstPsst.xcarchive" \
  -allowProvisioningUpdates archive
```

The `.xcarchive` is an archive, not an installable `.ipa`. Use Organizer's
distribution/export flow to export an IPA for the intended distribution method
or upload to App Store Connect. No iOS GitHub Secrets are consumed by the current
workflow. See Apple's [distribution guide](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases)
and Expo's [local release guide](https://docs.expo.dev/guides/local-app-production/).

## Version and release checklist

1. Set `desktop/package.json`'s `version` and `app.json`'s `expo.version` to the
   same release version. Update the workspace lockfile if the desktop package
   version changes. The tag must match exactly, for example `v1.2.3`.
2. Increase `app.json`'s `expo.android.versionCode` for each Android update and
   `expo.ios.buildNumber` for each iOS upload. Both are explicitly initialized to
   `1`; neither is derived from CI run numbers. Use the same Android version code
   across channels for the same release.
3. Configure all five macOS and all four Android secrets before the first tag
   run. Windows signing remains separately configured through `WIN_CSC_LINK`
   and `WIN_CSC_KEY_PASSWORD`.
4. Run `Build Apps` manually on the reviewed branch. Check signature fingerprints,
   macOS notarization, installation, and upgrades from the prior release.
5. Push the matching version tag when ready. Review the resulting draft Release
   and publish it only when its installers and update metadata are complete.
6. Publish the release to Zapstore and follow up on the F-Droid build recipe and
   reproducibility checks. Build and distribute iOS separately through Xcode.

## Third-party notices

Before packaging, run `npm run licenses:check` and `npm run licenses:test`.
Dependency changes must refresh the reviewed notices and generated offline catalog
as described in [open-source notices](OPEN_SOURCE_NOTICES.md), including the
platform-specific inventory review and fresh-install offline checks.
