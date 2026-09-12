# Third-party notices

PsstPsst is licensed under MIT. Third-party code retains its
respective license and copyright notices. See the license files and source
headers accompanying each dependency, including vendored code.

## Notice files

The following files preserve upstream wording, including copyright holders,
license terms, disclaimers, and additional notices. The About screen links to a searchable catalog that displays these original
notices offline and provides project source links.

| Components | Original notices |
| --- | --- |
| JavaScript dependencies, including React, React Native, noble, Drizzle, Lucide, and better-sqlite3 | [npm notices](./licenses/third-party/common/npm-notices.txt), [package versions and sources](./licenses/third-party/common/npm-inventory.json) |
| Solar Icons and its React Native wrapper | [icon attribution](./licenses/third-party/common/solar-icons-attribution.txt), [wrapper MIT license](./licenses/third-party/common/solar-wrapper-MIT.txt) |
| Noise-C and embedded cryptographic implementations | [original licenses and source notices](./licenses/third-party/common/noise-c.txt) |
| libsecp256k1 | [original licenses and source notices](./licenses/third-party/common/secp256k1.txt) |
| React Native, Hermes, and reviewed mobile native libraries | [native notices](./licenses/third-party/common/mobile-native.txt) |
| Electron | [MIT license](./licenses/third-party/desktop/electron-MIT.txt) |
| sharp | [Apache-2.0 license](./licenses/third-party/desktop/sharp-Apache-2.0.txt) |
| sharp's precompiled libvips and dependencies | [macOS/Linux notices](./licenses/third-party/desktop/sharp-libvips-posix.txt), [Windows notices](./licenses/third-party/desktop/sharp-libvips-windows.txt), [librsvg Rust dependency notices](./licenses/third-party/desktop/librsvg-rust.txt) |

The npm inventory covers the locked non-development dependency closure across
all platforms, including transitive and optional packages, some build utilities,
and the shipped Electron runtime. Identical texts are stored once and referenced
by SHA-256. It is a conservative notice collection, not a list of exactly which
packages are present in each binary. Platform-specific native distributions may
contain additional notices. See [coverage and maintenance](docs/OPEN_SOURCE_NOTICES.md)
for the precise scope, known native inventory gaps, and update commands.

## Solar Icons

Solar Icons Set by [480 Design](https://www.figma.com/community/file/1166831539721848736)
is used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
PsstPsst adjusts the icons' display size and color. The React Native wrapper is
Copyright (c) 2024 Hakim Saoudi and uses MIT. Its license does not replace the
icon artwork's attribution terms. The About screen credits the original artist.

## Native cryptography

Noise-C is Copyright (C) 2016 Southern Storm Software, Pty Ltd., under MIT.
Its embedded cryptographic implementations have their own notices, reproduced
in the collection above. Original files remain under
`modules/expo-noise/vendor/noise-c/`.

libsecp256k1 is used under MIT. Its upstream `COPYING` and source headers remain
under `modules/expo-crypto-accelerator/android/src/main/cpp/secp256k1/`, and their
notices are reproduced above so they can accompany compiled distributions.

## Desktop libraries

Desktop packages carry Electron's original `LICENSE` and
`LICENSES.chromium.html` from the installed Electron distribution under
`ThirdPartyNotices/electron/` in the application's resources directory. The
Chromium file includes notices for Chromium and its bundled components; it is
copied for the target platform rather than replaced by a hand-written summary.

sharp uses Apache-2.0. Its precompiled libvips distribution and constituent
libraries retain LGPLv3 and other licenses, as specified in their own notices.
The POSIX and Windows collections describe different native builds. Preserving
these texts does not by itself fulfill any applicable source-availability or
library-replacement requirements.

## Maintaining and distributing these notices

Keep original wording when updating the snapshots. The npm inventory records
package versions, npm integrity values, upstream locations, and text hashes;
[snapshots.json](./licenses/third-party/snapshots.json) records the other reviewed
files. Refresh affected notices from the matching upstream version when changing
dependencies or vendored code. Preserve additional `NOTICE`, `COPYING`, patent,
and source-header statements where supplied, including for modified dependencies.

Android and iOS builds copy the common notices, this index, the project license,
and the ZXing notices into `ThirdPartyNotices/` in their assets or application
bundle. Desktop packages include the complete `licenses/` directory and the
target Electron notices under `ThirdPartyNotices/` in their resources directory.
The searchable catalog additionally packages deduplicated text assets for the
offline reader; full notice texts are not embedded as JavaScript source strings.

## Expo

The following original notice is retained for Expo-derived portions of this
repository, including the project and native-module scaffolding.

```text
The MIT License (MIT)

Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ZXing-C++

Android QR and barcode decoding uses ZXing-C++ 3.0.2, licensed under Apache-2.0.
The Android wrapper is Copyright 2021 Axel Waggershauser. Upstream copyright
notices remain in the corresponding source files.

- Source: https://github.com/zxing-cpp/zxing-cpp/tree/v3.0.2
- License: [Apache License 2.0](./licenses/zxing-cpp/LICENSE)
- Local changes replace Expo Camera's Android barcode integration; ZXing-C++
  itself is used unmodified. Its Android reader is built with barcode writers
  disabled.

ZXing-C++ also bundles libzueci (BSD-3-Clause), including Bjoern Hoehrmann's
UTF-8 decoder. Their notices are preserved in [NOTICE](./licenses/zxing-cpp/NOTICE)
and included with the Android APK.
