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

The recipe remains disabled. To retain the developer signature, publish a new
upstream version built with the same source-module recipe and verify that APK.
Alternatively, remove `Binaries` and `AllowedAPKSigningKeys` and let F-Droid sign
its source build; that produces a separate signing lineage.

## Before enabling the recipe

1. Commit the Android Fastlane metadata and shared store screenshots before
   tagging the release. Store copy lives in `fastlane/metadata/android/en-US/`;
   the first release reuses the maintainer-supplied iPhone promotional artwork.
2. Publish the signed GitHub APK and replace the draft's `commit` with the full
   commit hash of that release tag. Do not change published release assets to
   make a later rebuild match.
3. Verify the APK's certificate using `apksigner verify --print-certs`, compare
   it with the independently recorded release certificate, and add its SHA-256
   fingerprint to `AllowedAPKSigningKeys`. Never provide the keystore to F-Droid.
4. Test the recipe's toolchain provisioning in the F-Droid build VM. Compare
   the actual Node/npm, JDK, and Gradle/AGP versions with the upstream build, and resolve
   any resulting APK differences. Releases after `v0.2.2` use the pinned F-Droid
   buildserver image through `scripts/build-android-reproducible.sh`; refresh the
   image digest, tool versions, archive checksums, and template checksum together
   when intentionally updating that environment.
5. Review the narrow scanner exceptions and dependency licenses with the
   packagers. Existing FCM/ML Kit checks remain only a subset of this review.
6. Remove `disable` in the validation copy, then run `fdroid readmeta`,
   `fdroid lint chat.psstpsst.app`, `fdroid rewritemeta chat.psstpsst.app`, and
   `fdroid build --server chat.psstpsst.app:5` in the configured fdroiddata
   checkout. Compare the rebuilt APK with the published APK using F-Droid's
   reproducible-build verification. Investigate native build paths, generated
   files, and tool versions if they differ.
7. Enable automatic updates only after the first verified build, using
   `AutoUpdateMode: Version`. Test `fdroid checkupdates chat.psstpsst.app`;
   version name and code are read from `app.json` at release tags because the
   Android project is generated rather than committed.

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
[reproducible builds](https://f-droid.org/docs/Reproducible_Builds/).
