# F-Droid source builds

`metadata/chat.psstpsst.app.yml` is the submission draft for the official
F-Droid repository. Its four ABI entries remain disabled until a new upstream
release containing these changes passes F-Droid's independent verification.
The previous MR passed reproducibility for **26.9.1**, using an older build
configuration; that result does not certify this new Java 21/R8/ABI build.

Local validation on 2026-11-04 passed the Java 21 arm64 unsigned Release build,
R8/resource shrinking, APK content checks, and all four ABI version-code checks.
All 60 Android Java compile tasks select JDK 21 and bytecode target 17. A Java 17
launcher also correctly selects the Java 21 daemon through the project criteria.
Full Linux container validation is currently in progress; the complete build and
independent APK byte comparison have not yet passed.

## Shared build configuration

Upstream CI and F-Droid use the official buildserver's Java 21 and Debian
Forky's Node.js/npm packages. There is no downloaded Node distribution, old
Bookworm repository, machine-specific `JAVA_HOME`, or exact Debian JDK patch
version requirement. The upstream container image remains pinned by digest;
actual Java, Node, and npm versions are recorded in its build log.

The lockfile and reviewed `patch-package` patches select the framework inputs:

- The React Native Gradle plugin and Expo KSP use a Java 21 compiler. The
  application and Android libraries retain Java/Kotlin bytecode target 17.
- Gradle's generated `gradle-daemon-jvm.properties` selects Java 21 for the
  build runtime, independently of a developer's shell or IDE JDK selection.
- Expo Android modules build from source through `package.json` autolinking.
  Remove unused `local-maven-repo` directories before F-Droid scanning.
- `npm run android:prebuild` uses the template in the installed, lockfile-pinned
  Expo package. Config plugins own R8, resource shrinking, Gradle memory,
  the production-only deterministic dev-server IP, unsigned release signing,
  and ABI version codes. Development builds retain Metro host discovery.
- All Android libraries, including Expo SQLite, use the same NDK as the Expo app.

F-Droid retains explicit, narrow scanner exceptions for Hermes and legitimate
Maven declarations. `scandelete` removes dependency scanner findings and the
unused generated debug keystore. It then invokes Gradle directly in the generated
`android/` directory. Upstream-only dependency/APK checks stay in release CI.

## ABI outputs and verification

`app.json` stores the base release counter. Installed version codes are
`10 * counter + suffix`, with suffixes `armeabi-v7a=1`, `arm64-v8a=2`, `x86=3`,
`x86_64=4`; the universal APK and AAB use suffix 0. `VercodeOperation` tracks the
four ABI codes. Each entry selects its ABI through `reactNativeArchitectures`
and compares against its public `PsstPsst-android-<architecture>.apk` binary:
`armeabi-v7a → arm32`, `arm64-v8a → arm64`, `x86 → x86`, `x86_64 → x64`.

For credentialed APK releases, upstream CI builds twice in separate clean
containers from source archives that exclude ignored dependencies, generated
native projects, previous outputs, and Git metadata. Working-tree source edits
are included for local verification, and the host supplies the commit timestamp.
CI compares all five unsigned APKs before signing. A mismatch fails
the release build. The later signature-copy audit checks signing compatibility;
F-Droid's own build and signature verification remain the final independent test.
The long-lived signing key is never supplied to F-Droid.

For unreliable SDK download connections, set `ANDROID_SDK_ARCHIVES` to a local
directory of verified official SDK/NDK ZIPs. The script mounts it read-only and
copies the archives into each container's disposable sdkmanager cache. Installed
SDK directories and project build outputs are never shared between builds.
`ANDROID_NPM_CACHE` similarly accepts an npm cache prepared for Linux x64 from
the lockfile. Only `_cacache` is mounted and copied into the fresh container;
npm then installs offline and validates package integrity. User npm configuration,
credentials, installed dependencies, and compiled outputs are not copied.
`ANDROID_GRADLE_DOWNLOADS` accepts a `wrapper/` directory containing downloaded
Gradle distributions and a `maven-files/` directory containing only upstream
`modules-2/files-2.1` artifacts. Gradle project caches, transformed artifacts, and
project build outputs are not shared.

## Updating the submission

1. Build a new upstream release; do not replace assets on an existing release.
2. Set each metadata entry to the new version, ABI version code, and full source
   commit hash. Check that all four upstream APKs have `AllowedAPKSigningKeys`.
3. Copy the draft into a fdroiddata checkout. Remove `disable` in the validation
   copy and run `fdroid readmeta`, `fdroid lint`, `fdroid rewritemeta`, and
   `fdroid build --server chat.psstpsst.app:<ABI version code>` for every ABI.
4. Submit only the verified entries. Enable `AutoUpdateMode: Version` after
   `fdroid checkupdates` correctly generates all four ABI entries.

## References

- [CastLab metadata](https://gitlab.com/fdroid/fdroiddata/-/blob/master/metadata/app.fedilab.castlab.yml)
  demonstrates adapting React Native toolchains to Java 21.
- [evcc metadata](https://gitlab.com/fdroid/fdroiddata/-/blob/master/metadata/io.evcc.android.yml)
  demonstrates generating an Expo Android project and invoking Gradle directly.
- [PsstPsst's verified previous build](https://gitlab.com/codytseng98/fdroiddata/-/jobs/16771663400)
- [F-Droid ABI split guide](https://f-droid.org/en/docs/Submitting_to_F-Droid_Quick_Start_Guide/#setup-abi-split)
- [F-Droid reproducible builds](https://f-droid.org/en/docs/Reproducible_Builds/)
