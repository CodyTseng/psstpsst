# Open-source notices

About links to a searchable catalog and offline license reader. Package names,
resolved versions, original copyright statements, license texts, and additional
notices are preserved. Repository and website links are separate actions.
PsstPsst's own MIT license is readable from About as well.

## Sources and coverage

- `licenses/third-party/common/npm-inventory.json` inventories the complete
  non-development closure in `package-lock.json`, including nested versions,
  all platforms' optional packages, and the shipped Electron runtime (declared
  in `devDependencies`). This conservative set includes build utilities; it is
  not an exact inventory of the contents of any one binary.
- `npm-notices.txt` contains the original texts, deduplicated by SHA-256. The
  inventory records each package's registry integrity, source URL, and notice
  file hashes. A license expression alone is not a substitute for these texts.
- `catalog-supplements.json` connects manually reviewed native libraries and
  artwork to their original notice collections. `snapshots.json` records the
  reviewed files and distribution versions. Mobile source collections and
  individual librsvg Rust crates are also indexed.
- Electron's project details open the exact installed distribution's
  `LICENSES.chromium.html` in the system's document viewer. Packaging retains
  that file separately; the mobile app does not include Chromium notices.

This catalog does not certify license compatibility or exhaustively identify
all libraries embedded in native binaries. The existing reviewed mobile source
collection is not an automatically resolved Gradle or CocoaPods inventory, and
librsvg's Rust inventory does not cover the desktop Bluetooth helpers' separate
Cargo dependency trees. Release review must reconcile those platform dependency
graphs and actual artifacts, preserve additional notices, and fulfill any
applicable source and relinking requirements. Do not infer compliance solely
from a green catalog check or a permissive top-level package license.

## Updating

After changing npm dependencies:

```sh
npm run licenses:refresh
npm run licenses:check
npm run licenses:test
```

Refresh reuses texts only for the same package version and registry integrity.
For new or changed packages it downloads the lockfile's exact npm archive,
verifies its integrity, and reads license, copying, copyright, patent, author,
and notice files, including nested files. Package scripts are never executed.
It requires Node.js with built-in `fetch` and the system `tar` command. It does
not use the host's installed optional-package set as its source of truth.

Review the resulting diff before committing. Missing declared licenses or
notice files stop collection; investigate rather than assigning a guessed
license. Some sharp-libvips archives omit their notice files. Their explicit
exception uses the distribution version and notice hash in `snapshots.json`,
including when the npm inventory is cached. A new distribution version requires
reviewing its original notice collection and updating the corresponding snapshot;
an unreviewed version or changed notice text stops refresh with a targeted error.

`@expo/xcpretty` also omits a standalone license. Its explicit npm override is
pinned to the reviewed version and archive integrity. The snapshot retains the
published package metadata and README alongside the previously collected standard
BSD-3-Clause terms. Those terms are labeled as a reference, not as an original
upstream copyright notice; the missing notice remains a release-review limitation.
Other packages without notices still fail collection.

Provenance review for `@expo/xcpretty@4.4.5` (2026-09-12):

- Source: the [versioned npm metadata](https://registry.npmjs.org/@expo%2Fxcpretty/4.4.5)
  and its [published archive](https://registry.npmjs.org/@expo/xcpretty/-/xcpretty-4.4.5.tgz).
  The archive matches the SHA-512 integrity pinned in `snapshots.json`; its SHA-256
  is `309e1bf1d29a7db46c9bd66538ba2b3097b0a9bfd8687328fb47f3b8d01d6ca9`.
- Published `package.json` declares `BSD-3-Clause` and names Evan Bacon as author.
  Author metadata does not establish the copyright holder or copyright years.
  None of the archive's 47 files is a license or notice file. The 15 source files
  embedded in source maps contain no copyright or license headers.
- The declared repository is `expo/expo-cli`. Its inspected archived main tree
  at [`54997b9b1aa66329f91e33e913f98155bcbb2464`](https://github.com/expo/expo-cli/tree/54997b9b1aa66329f91e33e913f98155bcbb2464)
  references xcpretty as a dependency but contains no xcpretty package source.
  Published metadata provides no `gitHead` linking this release to a source commit.
  The repository's general MIT declaration does not resolve the package's BSD notice.
- Status: the published license identifier is verified; the original copyright
  notice is unresolved. Close this exception only with an authoritative upstream
  notice applicable to this version, then replace the reference terms and regenerate
  the inventory. Passing generation checks verifies integrity and coverage, not
  resolution of this provenance gap.

For native libraries and artwork, refresh the matching upstream version's
original notice collections, update their hashes and version pins in
`snapshots.json`, and update `catalog-supplements.json` when needed. Preserve
original wording and additional notices. Then run:

```sh
npm run licenses:generate
npm run licenses:check
```

Commit the reviewed source snapshots and generated `src/generated/licenses/`
and `assets/licenses/` together. Generation is deterministic and offline;
verification works without `node_modules`. CI rejects missing package coverage,
changed registry integrity, broken text hashes, stale native distribution pins,
and stale generated files. Release validation runs the same checks.

## Runtime and verification

Only catalog metadata is loaded when entering the feature. Notice text remains
in Metro assets and is read through `platform.bundledNotices` on demand. Static
asset references include those files in native release bundles and Electron's
renderer export. No public website is needed to read a license in a release
build; development builds obtain assets from Metro as usual.

The reader uses bounded text chunks and a virtualized list. Processing large
collections yields to rendering, concurrent reads of one document are shared,
and a bounded cache retains recent notices. Original texts are selectable and
retain their source language independently of the application locale.

Before release, verify on a fresh offline installation of each target platform:
open About, search for a scoped package, read its complete license and notices,
return to the same search, and open the project's repository after reconnecting.
On Electron also open Chromium's bundled document. Check both appearance modes,
large text, and an RTL locale. These device checks complement the automated
integrity, coverage, reader, and localization tests.
