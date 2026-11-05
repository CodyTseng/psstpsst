#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ "${ANDROID_BUILD_BUNDLE:-0}" == "1" && "${ANDROID_RELEASE_UNSIGNED:-1}" != "1" ]]; then
  echo 'AAB builds require ANDROID_RELEASE_UNSIGNED=1.' >&2
  exit 1
fi
if [[ "${ANDROID_BUILD_APK:-1}" != "1" && "${ANDROID_BUILD_BUNDLE:-0}" != "1" ]]; then
  echo 'Select an APK or AAB build.' >&2
  exit 1
fi

output_dir="${1:-release/android-artifacts}"
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"

if [[ "${ANDROID_BUILD_APK:-1}" == "1" ]]; then
  debug_signing=false
  if [[ "${ANDROID_RELEASE_UNSIGNED:-1}" != "1" ]]; then
    debug_signing=true
  fi
  (cd android && gradle --no-daemon :app:assembleRelease "-PpsstpsstDebugSigning=$debug_signing" -PpsstpsstAbiSplits=true)
  for abi in universal armeabi-v7a arm64-v8a x86 x86_64; do
    if [[ "${ANDROID_RELEASE_UNSIGNED:-1}" == "1" ]]; then
      artifact="android/app/build/outputs/apk/release/app-${abi}-release-unsigned.apk"
    else
      artifact="android/app/build/outputs/apk/release/app-${abi}-release.apk"
    fi
    if [[ "$abi" == universal ]]; then
      python3 scripts/check-android-apk.py "$artifact"
      name=app-release.apk
    else
      python3 scripts/check-android-apk.py "$artifact" "$abi"
      name="app-${abi}-release.apk"
    fi
    # Preserve verified APKs before changing the variant's resource outputs for the bundle.
    install -m 0644 "$artifact" "$output_dir/$name"
  done
fi

if [[ "${ANDROID_BUILD_BUNDLE:-0}" == "1" ]]; then
  # AGP's R8 resource shrinker cannot build an AAB from multiple ABI resource outputs.
  (cd android && gradle --no-daemon :app:bundleRelease -PpsstpsstDebugSigning=false -PpsstpsstAbiSplits=false)
  artifact=android/app/build/outputs/bundle/release/app-release.aab
  python3 scripts/check-android-apk.py "$artifact"
  install -m 0644 "$artifact" "$output_dir/app-release.aab"
fi
