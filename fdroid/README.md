# F-Droid submission preparation

`metadata/chat.psstpsst.app.yml` is a disabled submission draft for the official
F-Droid repository. It is not a self-hosted repository configuration or proof
that the application meets F-Droid's inclusion requirements. Copy the completed
file into a fork of https://gitlab.com/fdroid/fdroiddata for validation and review.

## Previous release inputs

The signing key and reproducibility investigation are based on the public
`v0.2.2` release (version code `4`), commit
`06bcb7204216e100aae7a5bd704a6057150d0041`. Its `AllowedAPKSigningKeys` matches
the certificate reported by `apksigner verify --print-certs` on the published
`PsstPsst-0.2.2-android.apk`.

The [upstream Android build log](https://github.com/codytseng/psstpsst/actions/runs/35362574131/job/105657242487)
records Node.js `22.23.2`, npm `10.9.8`, Temurin `17.0.20+1`, Android API `36`,
Build Tools `36.0.0`, NDK `27.1.12297006`, and CMake `3.22.1`.
The recipe uses Node.js `24.15.0` and its bundled npm `11.12.1` to match the
maintainer's local development environment. These differ from the published
release's Node/npm versions, so APK reproducibility must be verified with this
change. It provisions the checksum-verified Linux x64 Node distribution and
requests the Android SDK packages. It explicitly uses the
checksum-verified `expo/template.tgz` from the release lockfile's Expo
`57.0.22` package; that template selects Gradle `9.3.1`.

The JDK is Debian OpenJDK 17 from Bookworm and its security repository because
the Trixie build image provides JDK 21. This is not an exact reproduction of the
upstream Temurin installation. Its patch version is not pinned. Dependency
scanning and APK reproducibility must pass before enabling this build. No broad
scanner exclusions are configured.

## Local validation status (2026-09-21)

Validation used the official Linux amd64 `buildserver-trixie` image at digest
`sha256:f81172f142454bccb6e198739d40bf3a98a393f09805140c1aa8b49807d0e3b7`
and fdroidserver commit `a35fdfddd9c66823987a410566a6101186e39c84`, running
the CI-style `--on-server --test --refresh-scanner --no-tarball` build in an
isolated container. Tool provisioning, npm installation, source patches, the
template checksum, and Android prebuild passed. The installed Debian JDK was
`17.0.20.1+1-1~deb12u1`.

The initial source scan stopped with 235 findings. The recipe now builds every
Expo Android module from source, removes bundled local Maven prebuilts, deletes
scanner findings under dependencies, and uses narrow scanner exceptions for the
permitted Linux Hermes compiler and legitimate local Maven declarations. The
second source scan passed without disabling scanning or ignoring all of
`node_modules`.

The complete release build also passed. It built 2,263 Gradle tasks in about
88 minutes under x86_64 emulation, produced an unsigned four-ABI APK, passed the
project's Android dependency and APK checks, and then ran F-Droid's automatic
comparison against the published `v0.2.2` APK.

That reproducibility comparison failed. Both APK payloads contain the same 2,221
paths, but 58 entries differ: two baseline-profile files, `classes3.dex` through
`classes5.dex`, 52 native libraries, and `resources.arsc`. The JavaScript bundle
and all other payload entries match. The published APK used Expo prebuilts while
the compliant recipe compiles those modules from source, so `v0.2.2` cannot use
the current `Binaries` path.

## v0.2.3 validation status (2026-09-22)

The published `v0.2.3` tag resolves to commit
`2f4621ec9bff1e02c19ebfda58add32ab9169ab4` (version code `5`). The
published Android APK has the signing certificate listed in
`AllowedAPKSigningKeys`.

In the same F-Droid buildserver container, `fdroid readmeta`, `fdroid lint`,
the source scan, the Android dependency check, and the four-ABI release build
passed. Gradle completed 2,263 tasks in 1 hour 4 minutes, and the project's APK
scanner check passed. F-Droid's download of the GitHub reference APK timed out
after receiving about 101 MB. The complete published APK was downloaded with
`gh`, copied into the container, and compared with the rebuilt unsigned APK
using the same `fdroidserver.common.verify_apks` function.

That comparison failed. Apart from the three signing entries in the published
APK, both APKs contain the same 2,332 paths. Only three payload entries differ:
`assets/dexopt/baseline.prof`, `classes3.dex`, and `resources.arsc`. The
JavaScript bundle and native libraries match. `aapt2 dump resources` shows one
logical resource difference: `react_native_dev_server_ip` is `172.17.0.2` in
the published APK and `192.168.215.2` in the rebuild. React Native's Gradle
plugin uses the build host's IP unless `reactNativeDevServerIp` is set.
Disassembly of `classes3.dex` shows a different registration order for Glide's
Expo Image modules and a different generated `GlideIndexer` class name. The
baseline profile also differs; its exact relationship to the DEX difference
has not been verified.

The recipe remains disabled because `v0.2.3` predates the fixes. To keep
developer-signed reproducible builds, publish and verify a new version.
Alternatively, remove `Binaries` and `AllowedAPKSigningKeys` and let F-Droid
sign its source build under a separate signing lineage.

The unreleased build recipe now passes `reactNativeDevServerIp=127.0.0.1` in both
build paths and uses the reproducible Glide KSP `5.0.9` processor through
`patches/expo-image+57.0.5.patch`. The Expo Image runtime remains on Glide
`5.0.5`. The container build passed, and cleaning and rebuilding Expo Image
produced the same unsigned APK SHA-256. A new release is still required for
F-Droid's comparison with a published APK.

## Before enabling the recipe

1. Publish a release containing both deterministic build fixes. Do not replace
   a published release asset to make a later rebuild match. Record the new
   tag's full commit hash in the build entry.
2. Verify the new APK's certificate with `apksigner verify --print-certs` and
   compare its SHA-256 fingerprint with `AllowedAPKSigningKeys`. Never provide
   the keystore to F-Droid.
3. Test the recipe's toolchain provisioning in the F-Droid build VM. Releases
   after `v0.2.2` use the pinned buildserver image through
   `scripts/build-android-reproducible.sh`; refresh the image digest, tool
   versions, archive checksums, and template checksum together when updating
   that environment.
4. Review the narrow scanner exceptions and dependency licenses with the
   packagers. Existing FCM/ML Kit checks remain only a subset of this review.
5. Remove `disable` in the validation copy, then run `fdroid readmeta`,
   `fdroid lint chat.psstpsst.app`, `fdroid rewritemeta chat.psstpsst.app`, and
   `fdroid build --server chat.psstpsst.app:<versionCode>` in the configured fdroiddata
   checkout. Compare the rebuilt APK with the published APK using F-Droid's
   reproducible-build verification.
6. Enable automatic updates only after the first verified build, using
   `AutoUpdateMode: Version`. Test `fdroid checkupdates chat.psstpsst.app`;
   version name and code are read from `app.json` at release tags because the
   Android project is generated rather than committed.

For the initial fdroiddata merge request, include only the latest verified
build; do not submit a disabled build entry. The Android Fastlane folder
already contains English title, descriptions, icon, screenshots, and changelog.
Its screenshots currently show an iPhone frame; review Android captures before
submission. The universal APK contains four ABIs and is about 147 MB, so review
ABI splits if the F-Droid maintainers request a smaller download. The issue
tracker provides public maintainer contact; add a public author email only if
the maintainer chooses to publish one. Review optional third-party relay and
media endpoints with packagers when assessing AntiFeatures.

The recipe generates Android before scanning so dependencies are visible to
F-Droid, removes the generated debug signing references, and requests an
unsigned release APK. `Binaries` selects the upstream developer-signed artifact
only after verification. The recipe never runs the private release-signing
helper. The `sudo` setup runs only on the dedicated F-Droid build server; a
local build requires manually provisioning the same tools. The local container
run above does not constitute an approved official F-Droid build.

References: [submission guide](https://f-droid.org/docs/Submitting_to_F-Droid_Quick_Start_Guide/),
[metadata reference](https://f-droid.org/docs/Build_Metadata_Reference/),
[inclusion policy](https://f-droid.org/docs/Inclusion_Policy/), and
[reproducible builds](https://f-droid.org/docs/Reproducible_Builds/). The
[new app merge request checklist](https://gitlab.com/fdroid/fdroiddata/-/blob/master/.gitlab/merge_request_templates/App%20inclusion.md)
also describes the submission requirements.
