# F-Droid submission preparation

`metadata/chat.psstpsst.app.yml` is a disabled submission draft for the official
F-Droid repository. It is not a self-hosted repository configuration or proof
that the application meets F-Droid's inclusion requirements. Copy the completed
file into a fork of https://gitlab.com/fdroid/fdroiddata for validation and review.

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
4. Provision and pin Node.js 22/npm, JDK 17, the Expo prebuild template,
   Gradle/AGP, SDK/build tools, NDK, and CMake in the F-Droid environment against
   the upstream build. The draft checks Node's major version but does not yet
   provision this toolchain. CI currently selects Node 22 and JDK 17 without
   exact patch pins, so a successful GitHub build is not a reproducibility test.
5. Audit npm packages, native libraries, Expo AARs, build-time binaries, licenses,
   and network-service dependencies. Review any applicable AntiFeatures with
   the packagers. Resolve scanner findings specifically; do not blanket-ignore
   `node_modules` or disable scanning. Existing FCM/ML Kit checks are only a
   subset of this review.
6. Remove `disable` in the validation copy, then run `fdroid readmeta`,
   `fdroid lint chat.psstpsst.app`, `fdroid rewritemeta chat.psstpsst.app`, and
   `fdroid build --server chat.psstpsst.app:4` in the configured fdroiddata
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
helper. Toolchain setup, dependency scanning, and APK reproducibility have not
yet been validated on a F-Droid build server.

References: [submission guide](https://f-droid.org/docs/Submitting_to_F-Droid_Quick_Start_Guide/),
[metadata reference](https://f-droid.org/docs/Build_Metadata_Reference/),
[inclusion policy](https://f-droid.org/docs/Inclusion_Policy/), and
[reproducible builds](https://f-droid.org/docs/Reproducible_Builds/).
