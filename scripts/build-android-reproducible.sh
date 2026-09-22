#!/usr/bin/env bash

set -euo pipefail

readonly IMAGE="registry.gitlab.com/fdroid/fdroidserver@sha256:f81172f142454bccb6e198739d40bf3a98a393f09805140c1aa8b49807d0e3b7"
readonly PROJECT_DIR="/home/vagrant/build/chat.psstpsst.app"
readonly NODE_VERSION="24.15.0"
readonly NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
readonly NODE_SHA256="472655581fb851559730c48763e0c9d3bc25975c59d518003fc0849d3e4ba0f6"
readonly TEMPLATE_SHA256="b5796fa7a2de78499e81ec2b2b7aa2ad25f3702d61daaed2ddb7c23757e98b49"

if [[ "${PSSTPSST_FDROID_CONTAINER:-}" != "1" ]]; then
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  output_dir="${1:-$repo_root/release/fdroid-build}"
  mkdir -p "$output_dir"
  output_dir="$(cd "$output_dir" && pwd)"

  docker run --rm --platform linux/amd64 \
    --mount "type=bind,src=$repo_root,dst=/workspace,readonly" \
    --mount "type=bind,src=$output_dir,dst=/output" \
    --env ANDROID_RELEASE_UNSIGNED="${ANDROID_RELEASE_UNSIGNED:-1}" \
    --env PSSTPSST_FDROID_CONTAINER=1 \
    "$IMAGE" \
    bash /workspace/scripts/build-android-reproducible.sh
  exit
fi

if [[ "${PSSTPSST_FDROID_USER:-}" != "1" ]]; then
  echo 'deb https://deb.debian.org/debian bookworm main' > /etc/apt/sources.list.d/psstpsst-bookworm.list
  echo 'deb https://security.debian.org/debian-security bookworm-security main' >> /etc/apt/sources.list.d/psstpsst-bookworm.list
  apt-get update
  apt-get install -y openjdk-17-jdk-headless ca-certificates curl xz-utils sudo

  curl --fail --location --retry 3 \
    "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}" \
    --output /tmp/psstpsst-node.tar.xz
  echo "${NODE_SHA256}  /tmp/psstpsst-node.tar.xz" | sha256sum -c -
  mkdir -p /opt/psstpsst-node
  tar -xJf /tmp/psstpsst-node.tar.xz --strip-components=1 -C /opt/psstpsst-node

  sdkmanager --sdk_root=/opt/android-sdk \
    'platforms;android-36' \
    'build-tools;36.0.0' \
    'cmake;3.22.1' \
    'ndk;27.1.12297006' \
    'ndk;27.0.12077973'

  mkdir -p "$PROJECT_DIR"
  cp -a /workspace/. "$PROJECT_DIR/"
  chown -R vagrant:vagrant /home/vagrant

  sudo --preserve-env --user vagrant env \
    HOME=/home/vagrant \
    PATH="/opt/psstpsst-node/bin:/usr/lib/jvm/java-17-openjdk-amd64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/android-sdk/tools:/opt/android-sdk/platform-tools" \
    PSSTPSST_FDROID_CONTAINER=1 \
    PSSTPSST_FDROID_USER=1 \
    ANDROID_RELEASE_UNSIGNED="${ANDROID_RELEASE_UNSIGNED:-1}" \
    bash "$PROJECT_DIR/scripts/build-android-reproducible.sh"

  if [[ "${ANDROID_RELEASE_UNSIGNED:-1}" == "1" ]]; then
    artifact="$PROJECT_DIR/android/app/build/outputs/apk/release/app-release-unsigned.apk"
  else
    artifact="$PROJECT_DIR/android/app/build/outputs/apk/release/app-release.apk"
  fi
  install -m 0644 "$artifact" /output/app-release.apk
  exit
fi

cd "$PROJECT_DIR"
export ANDROID_HOME=/opt/android-sdk
export ANDROID_SDK_ROOT=/opt/android-sdk
export CI=1
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
export EXPO_PUBLIC_APP_ENV=production
export GRADLE_USER_HOME=/home/vagrant/.gradle
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export LC_ALL=C.UTF-8
export NODE_ENV=production
export SOURCE_DATE_EPOCH="$(git show -s --format=%ct HEAD)"
export TZ=UTC

test "$(node --version)" = "v${NODE_VERSION}"
test "$(npm --version)" = '11.12.1'
npm ci --include=dev --ignore-scripts
npm run postinstall
find node_modules -type d -name local-maven-repo -prune -exec rm -rf {} +
echo "${TEMPLATE_SHA256}  node_modules/expo/template.tgz" | sha256sum -c -
npm run android:prebuild -- --template ./node_modules/expo/template.tgz

if [[ "${ANDROID_RELEASE_UNSIGNED:-1}" == "1" ]]; then
  sed -i '/signingConfig signingConfigs.debug/d' android/app/build.gradle
  rm android/app/debug.keystore
fi

find . -name gradle-wrapper.jar -type f -delete
(cd android && gradle :app:dependencies --configuration releaseRuntimeClasspath --console=plain -PreactNativeDevServerIp=127.0.0.1) > android-dependencies.txt
node scripts/check-android-dependencies.mjs android-dependencies.txt
(cd android && gradle :app:assembleRelease --no-daemon --max-workers=2 -PreactNativeDevServerIp=127.0.0.1)

if [[ "${ANDROID_RELEASE_UNSIGNED:-1}" == "1" ]]; then
  artifact="android/app/build/outputs/apk/release/app-release-unsigned.apk"
else
  artifact="android/app/build/outputs/apk/release/app-release.apk"
fi
python3 scripts/check-android-apk.py "$artifact"
