#!/usr/bin/env bash

set -euo pipefail

# Share only downloaded inputs; every container installs and compiles its own copies.
mode="${1:?Usage: android-download-cache.sh restore|save cache user-home sdk-cache}"
cache="${2:?Missing download cache directory}"
user_home="${3:?Missing build user home}"
sdk_cache="${4:?Missing sdkmanager cache directory}"

copy_directory() {
  if [[ -d "$1" ]]; then
    mkdir -p "$2"
    cp -a "$1/." "$2/"
  fi
}

copy_sdk_archives() {
  if [[ -d "$1" ]]; then
    mkdir -p "$2"
    find "$1" -maxdepth 1 -type f -name '*.zip' -exec cp -p '{}' "$2/" \;
  fi
}

case "$mode" in
  restore)
    copy_directory "$cache/npm/_cacache" "$user_home/.npm/_cacache"
    copy_directory "$cache/gradle/wrapper" "$user_home/.cache/gradlew-fdroid"
    copy_directory "$cache/gradle/maven-files" "$user_home/.gradle/caches/modules-2/files-2.1"
    copy_sdk_archives "$cache/sdk" "$sdk_cache"
    ;;
  save)
    copy_directory "$user_home/.npm/_cacache" "$cache/npm/_cacache"
    copy_directory "$user_home/.cache/gradlew-fdroid" "$cache/gradle/wrapper"
    copy_directory "$user_home/.gradle/caches/modules-2/files-2.1" "$cache/gradle/maven-files"
    copy_sdk_archives "$sdk_cache" "$cache/sdk"
    ;;
  *)
    echo "Unknown download cache operation: $mode" >&2
    exit 1
    ;;
esac
