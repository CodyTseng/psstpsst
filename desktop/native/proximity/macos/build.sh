#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
output_dir="$script_dir/../bin/darwin"
temporary_dir=$(mktemp -d)
trap 'rm -rf "$temporary_dir"' EXIT

cp "$script_dir/Info.plist" "$temporary_dir/Info.plist"
if [ "${EXPO_PUBLIC_APP_ENV:-}" = development ]; then
  plutil -replace CFBundleIdentifier -string chat.psstpsst.app.dev.proximity "$temporary_dir/Info.plist"
  plutil -replace CFBundleName -string 'PsstPsst Dev Proximity' "$temporary_dir/Info.plist"
fi

build_arch() {
  architecture=$1
  swiftc \
    "$script_dir/main.swift" \
    -O \
    -target "${architecture}-apple-macosx12.0" \
    -framework CoreBluetooth \
    -framework Foundation \
    -Xlinker -sectcreate \
    -Xlinker __TEXT \
    -Xlinker __info_plist \
    -Xlinker "$temporary_dir/Info.plist" \
    -o "$temporary_dir/psstpsst-proximity-$architecture"
}

build_arch arm64
build_arch x86_64
mkdir -p "$output_dir"
lipo -create \
  "$temporary_dir/psstpsst-proximity-arm64" \
  "$temporary_dir/psstpsst-proximity-x86_64" \
  -output "$output_dir/psstpsst-proximity"
chmod 755 "$output_dir/psstpsst-proximity"
