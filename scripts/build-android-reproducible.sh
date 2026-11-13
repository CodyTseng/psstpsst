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
  keep_snapshot=0
  cleanup_snapshot() {
    if [[ "$keep_snapshot" != "1" ]]; then
      rm -rf "$snapshot_dir"
    fi
  }
  trap cleanup_snapshot EXIT
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

  if [[ -n "${ANDROID_DOWNLOAD_CACHE:-}" ]]; then
    mkdir -p "$ANDROID_DOWNLOAD_CACHE"
    download_cache="$(cd "$ANDROID_DOWNLOAD_CACHE" && pwd)"
    docker_mounts+=(--mount "type=bind,src=$download_cache,dst=/download-cache")
  fi

  docker_args=(run --platform linux/amd64)
  if [[ "${ANDROID_KEEP_FAILED_CONTAINER:-0}" != "1" ]]; then
    docker_args+=(--rm)
  fi
  docker_status=0
  docker "${docker_args[@]}" --cidfile "$snapshot_dir/container.id" \
    "${docker_mounts[@]}" \
    --env ANDROID_RELEASE_UNSIGNED="${ANDROID_RELEASE_UNSIGNED:-1}" \
    --env ANDROID_BUILD_APK="${ANDROID_BUILD_APK:-1}" \
    --env ANDROID_BUILD_BUNDLE="${ANDROID_BUILD_BUNDLE:-0}" \
    --env ANDROID_GRADLE_JVMARGS="${ANDROID_GRADLE_JVMARGS:-}" \
    --env ANDROID_GRADLE_WORKERS="${ANDROID_GRADLE_WORKERS:-}" \
    --env PSSTPSST_FDROID_CONTAINER=1 \
    --env SOURCE_DATE_EPOCH="$source_date_epoch" \
    "$IMAGE" \
    bash /build-android.sh || docker_status=$?
  if [[ -s "$snapshot_dir/container.id" ]]; then
    install -m 0644 "$snapshot_dir/container.id" "$output_dir/container.id"
    if [[ "${ANDROID_KEEP_FAILED_CONTAINER:-0}" == "1" ]]; then
      container_id="$(cat "$snapshot_dir/container.id")"
      if [[ "$docker_status" == "0" ]]; then
        docker rm "$container_id" > /dev/null
      else
        keep_snapshot=1
        printf '%s\n' "$snapshot_dir" > "$output_dir/source-snapshot.path"
        echo "Failed Android build container retained: $container_id" >&2
        echo "Source snapshot retained: $snapshot_dir" >&2
      fi
    fi
  fi
  exit "$docker_status"
fi

if [[ "${PSSTPSST_FDROID_USER:-}" != "1" ]]; then
  # Export diagnostics and downloaded inputs even when the build fails.
  finish_container() {
    build_status=$?
    set +e
    if [[ -d /download-cache && -f "$PROJECT_DIR/scripts/android-download-cache.sh" ]]; then
      bash "$PROJECT_DIR/scripts/android-download-cache.sh" save /download-cache /home/vagrant /root/.cache/sdkmanager || echo 'Warning: could not save all Android downloads.' >&2
    fi
    if (( build_status != 0 )); then
      mkdir -p /output/diagnostics
      { free -m; df -h; cat /sys/fs/cgroup/memory.events 2>/dev/null; } > /output/diagnostics/resources.txt
      cp -a "$PROJECT_DIR/android/build/reports" /output/diagnostics/ 2>/dev/null
      cp "$PROJECT_DIR/android-dependencies.txt" /output/diagnostics/ 2>/dev/null
      find /home/vagrant/.gradle/daemon -name 'daemon-*.out.log' -exec cp '{}' /output/diagnostics/ \; 2>/dev/null
    fi
    exit "$build_status"
  }
  trap finish_container EXIT
  mkdir -p "$PROJECT_DIR"
  tar -xf /source.tar -C "$PROJECT_DIR"
  if [[ -d /download-cache ]]; then
    bash "$PROJECT_DIR/scripts/android-download-cache.sh" restore /download-cache /home/vagrant /root/.cache/sdkmanager
  fi

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

  chown -R vagrant:vagrant "$PROJECT_DIR"
  if [[ -d /npm-download-cache ]]; then
    mkdir -p /home/vagrant/.npm/_cacache
    cp -a /npm-download-cache/. /home/vagrant/.npm/_cacache/
  fi
  if [[ -d /gradle-downloads ]]; then
    mkdir -p /home/vagrant/.cache/gradlew-fdroid /home/vagrant/.gradle/caches/modules-2/files-2.1
    if [[ -d /gradle-downloads/wrapper ]]; then
      cp -a /gradle-downloads/wrapper/. /home/vagrant/.cache/gradlew-fdroid/
    fi
    if [[ -d /gradle-downloads/maven-files ]]; then
      cp -a /gradle-downloads/maven-files/. /home/vagrant/.gradle/caches/modules-2/files-2.1/
    fi
  fi

  if [[ -d /home/vagrant/.npm ]]; then chown -R vagrant:vagrant /home/vagrant/.npm; fi
  if [[ -d /home/vagrant/.gradle ]]; then chown -R vagrant:vagrant /home/vagrant/.gradle; fi
  if [[ -d /home/vagrant/.cache/gradlew-fdroid ]]; then chown -R vagrant:vagrant /home/vagrant/.cache/gradlew-fdroid; fi
  free -m
  df -h

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
      if [[ "$abi" == universal ]]; then
        name=app-release.apk
      else
        name="app-${abi}-release.apk"
      fi
      install -m 0644 "$PROJECT_DIR/release/android-artifacts/$name" "/output/$name"
    done
  fi
  if [[ "${ANDROID_BUILD_BUNDLE:-0}" == "1" ]]; then
    install -m 0644 "$PROJECT_DIR/release/android-artifacts/app-release.aab" /output/app-release.aab
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
npm ci --include=dev --ignore-scripts --prefer-offline --no-audit
npm run postinstall
find node_modules -type d -name local-maven-repo -prune -exec rm -rf {} +
npm run android:prebuild
sed -n '/^org.gradle.jvmargs=/p; /^org.gradle.workers.max=/p' android/gradle.properties

find . -name gradle-wrapper.jar -type f -delete
(cd android && gradle --no-daemon --stacktrace :app:dependencies --configuration releaseRuntimeClasspath --console=plain) 2>&1 | tee android-dependencies.txt
node scripts/check-android-dependencies.mjs android-dependencies.txt
bash scripts/build-android-artifacts.sh
