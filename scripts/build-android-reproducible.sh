#!/usr/bin/env bash

set -euo pipefail

readonly IMAGE="registry.gitlab.com/fdroid/fdroidserver:buildserver-trixie@sha256:1ea8bef1820bff06c2974e31b4fc4c79c364cd24231b86e71fa4b926797e0dac"
readonly PROJECT_DIR="/home/vagrant/build/chat.psstpsst.app"

if [[ "${1:-}" == "--check-image" ]]; then
  docker manifest inspect "$IMAGE" > /dev/null
  exit
fi

if [[ "${ANDROID_BUILD_BUNDLE:-0}" == "1" && "${ANDROID_RELEASE_UNSIGNED:-1}" != "1" ]]; then
  echo 'AAB builds require ANDROID_RELEASE_UNSIGNED=1.' >&2
  exit 1
fi
if [[ "${ANDROID_BUILD_APK:-1}" != "1" && "${ANDROID_BUILD_BUNDLE:-0}" != "1" ]]; then
  echo 'Select an APK or AAB build.' >&2
  exit 1
fi

if [[ "${PSSTPSST_FDROID_CONTAINER:-}" != "1" ]]; then
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  output_dir="${1:-$repo_root/release/fdroid-build}"
  mkdir -p "$output_dir"
  output_dir="$(cd "$output_dir" && pwd)"
  snapshot_dir="$(mktemp -d "${TMPDIR:-/tmp}/psstpsst-android-source.XXXXXX")"
  trap 'rm -rf "$snapshot_dir"' EXIT
  node "$repo_root/scripts/create-android-source-archive.mjs" "$repo_root" "$snapshot_dir/source.tar"
  tar -xOf "$snapshot_dir/source.tar" ./scripts/build-android-reproducible.sh > "$snapshot_dir/build-android.sh"
  source_date_epoch="${SOURCE_DATE_EPOCH:-$(git -C "$repo_root" show -s --format=%ct HEAD)}"
  docker_mounts=(
    --mount "type=bind,src=$snapshot_dir/source.tar,dst=/source.tar,readonly"
    --mount "type=bind,src=$snapshot_dir/build-android.sh,dst=/build-android.sh,readonly"
    --mount "type=bind,src=$output_dir,dst=/output"
  )
  if [[ -n "${ANDROID_SDK_ARCHIVES:-}" ]]; then
    sdk_archives="$(cd "$ANDROID_SDK_ARCHIVES" && pwd)"
    docker_mounts+=(--mount "type=bind,src=$sdk_archives,dst=/sdk-archives,readonly")
  fi
  if [[ -n "${ANDROID_NPM_CACHE:-}" ]]; then
    npm_cache="$(cd "$ANDROID_NPM_CACHE" && pwd)"
    test -d "$npm_cache/_cacache"
    docker_mounts+=(--mount "type=bind,src=$npm_cache/_cacache,dst=/npm-download-cache,readonly")
  fi
  if [[ -n "${ANDROID_GRADLE_DOWNLOADS:-}" ]]; then
    gradle_downloads="$(cd "$ANDROID_GRADLE_DOWNLOADS" && pwd)"
    docker_mounts+=(--mount "type=bind,src=$gradle_downloads,dst=/gradle-downloads,readonly")
  fi

  docker run --rm --platform linux/amd64 \
    "${docker_mounts[@]}" \
    --env ANDROID_RELEASE_UNSIGNED="${ANDROID_RELEASE_UNSIGNED:-1}" \
    --env ANDROID_BUILD_APK="${ANDROID_BUILD_APK:-1}" \
    --env ANDROID_BUILD_BUNDLE="${ANDROID_BUILD_BUNDLE:-0}" \
    --env PSSTPSST_FDROID_CONTAINER=1 \
    --env SOURCE_DATE_EPOCH="$source_date_epoch" \
    "$IMAGE" \
    bash /build-android.sh
  exit
fi

if [[ "${PSSTPSST_FDROID_USER:-}" != "1" ]]; then
  echo 'deb https://deb.debian.org/debian forky main' > /etc/apt/sources.list.d/psstpsst-forky.list
  apt-get update
  apt-get install -y -t forky nodejs npm sudo

  # Optional, trusted upstream ZIPs avoid downloading large archives on unreliable connections.
  # Each container receives its own copies and installs the SDK from scratch.
  if [[ -d /sdk-archives ]]; then
    mkdir -p /root/.cache/sdkmanager
    find /sdk-archives -maxdepth 1 -type f -name '*.zip' -exec cp '{}' /root/.cache/sdkmanager/ \;
  fi
  sdkmanager --sdk_root=/opt/android-sdk \
    'platforms;android-36' \
    'build-tools;35.0.0' \
    'build-tools;36.0.0' \
    'cmake;3.22.1' \
    'ndk;27.1.12297006'

  mkdir -p "$PROJECT_DIR"
  tar -xf /source.tar -C "$PROJECT_DIR"
  chown -R vagrant:vagrant "$PROJECT_DIR"
  if [[ -d /npm-download-cache ]]; then
    mkdir -p /home/vagrant/.npm/_cacache
    cp -a /npm-download-cache/. /home/vagrant/.npm/_cacache/
    chown -R vagrant:vagrant /home/vagrant/.npm
  fi
  if [[ -d /gradle-downloads ]]; then
    mkdir -p /home/vagrant/.cache/gradlew-fdroid /home/vagrant/.gradle/caches/modules-2/files-2.1
    if [[ -d /gradle-downloads/wrapper ]]; then
      cp -a /gradle-downloads/wrapper/. /home/vagrant/.cache/gradlew-fdroid/
    fi
    if [[ -d /gradle-downloads/maven-files ]]; then
      cp -a /gradle-downloads/maven-files/. /home/vagrant/.gradle/caches/modules-2/files-2.1/
    fi
    chown -R vagrant:vagrant /home/vagrant/.cache/gradlew-fdroid /home/vagrant/.gradle
  fi

  sudo --preserve-env --user vagrant env \
    HOME=/home/vagrant \
    PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/android-sdk/tools:/opt/android-sdk/platform-tools" \
    PSSTPSST_FDROID_CONTAINER=1 \
    PSSTPSST_FDROID_USER=1 \
    ANDROID_RELEASE_UNSIGNED="${ANDROID_RELEASE_UNSIGNED:-1}" \
    ANDROID_BUILD_APK="${ANDROID_BUILD_APK:-1}" \
    ANDROID_BUILD_BUNDLE="${ANDROID_BUILD_BUNDLE:-0}" \
    bash "$PROJECT_DIR/scripts/build-android-reproducible.sh"

  if [[ "${ANDROID_BUILD_APK:-1}" == "1" ]]; then
    for abi in universal armeabi-v7a arm64-v8a x86 x86_64; do
      if [[ "${ANDROID_RELEASE_UNSIGNED:-1}" == "1" ]]; then
        artifact="$PROJECT_DIR/android/app/build/outputs/apk/release/app-${abi}-release-unsigned.apk"
      else
        artifact="$PROJECT_DIR/android/app/build/outputs/apk/release/app-${abi}-release.apk"
      fi
      if [[ "$abi" == universal ]]; then
        install -m 0644 "$artifact" /output/app-release.apk
      else
        install -m 0644 "$artifact" "/output/app-${abi}-release.apk"
      fi
    done
  fi
  if [[ "${ANDROID_BUILD_BUNDLE:-0}" == "1" ]]; then
    install -m 0644 "$PROJECT_DIR/android/app/build/outputs/bundle/release/app-release.aab" /output/app-release.aab
  fi
  exit
fi

cd "$PROJECT_DIR"
export ANDROID_HOME=/opt/android-sdk
export ANDROID_SDK_ROOT=/opt/android-sdk
export CI=1
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
export EXPO_PUBLIC_APP_ENV=production
export GRADLE_USER_HOME=/home/vagrant/.gradle
export LC_ALL=C.UTF-8
export NODE_ENV=production
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:?Pass the source commit timestamp from the host.}"
export TZ=UTC

# Record the actual environment instead of pinning distribution patch releases.
java -version
node --version
npm --version
if [[ -d /npm-download-cache ]]; then
  npm ci --include=dev --ignore-scripts --offline --no-audit
else
  npm ci --include=dev --ignore-scripts
fi
npm run postinstall
find node_modules -type d -name local-maven-repo -prune -exec rm -rf {} +
npm run android:prebuild

find . -name gradle-wrapper.jar -type f -delete
(cd android && gradle :app:dependencies --configuration releaseRuntimeClasspath --console=plain) > android-dependencies.txt
node scripts/check-android-dependencies.mjs android-dependencies.txt
release_tasks=()
if [[ "${ANDROID_BUILD_APK:-1}" == "1" ]]; then
  release_tasks+=(:app:assembleRelease)
fi
if [[ "${ANDROID_BUILD_BUNDLE:-0}" == "1" ]]; then
  release_tasks+=(:app:bundleRelease)
fi
signing_args=()
if [[ "${ANDROID_RELEASE_UNSIGNED:-1}" != "1" ]]; then
  signing_args+=(-PpsstpsstDebugSigning=true)
fi
(cd android && gradle "${release_tasks[@]}" "${signing_args[@]}" -PpsstpsstAbiSplits=true --no-daemon --max-workers=2)

if [[ "${ANDROID_BUILD_APK:-1}" == "1" ]]; then
  for abi in universal armeabi-v7a arm64-v8a x86 x86_64; do
    if [[ "${ANDROID_RELEASE_UNSIGNED:-1}" == "1" ]]; then
      artifact="android/app/build/outputs/apk/release/app-${abi}-release-unsigned.apk"
    else
      artifact="android/app/build/outputs/apk/release/app-${abi}-release.apk"
    fi
    if [[ "$abi" == universal ]]; then
      python3 scripts/check-android-apk.py "$artifact"
    else
      python3 scripts/check-android-apk.py "$artifact" "$abi"
    fi
  done
fi
if [[ "${ANDROID_BUILD_BUNDLE:-0}" == "1" ]]; then
  python3 scripts/check-android-apk.py android/app/build/outputs/bundle/release/app-release.aab
fi
