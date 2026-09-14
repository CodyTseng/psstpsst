# Dependency security

Reviewed against the installed dependency paths on 2026-09-14. Keep Expo SDK 57
dependencies compatible; `npm audit fix --force` proposes unrelated downgrades
of Expo, Expo Router, and Drizzle Kit and is not the remediation for these paths.

## Local security patches

`npm ci` applies the version-specific files in `patches/` through the existing
`postinstall` command (`patch-package --error-on-fail`). Run
`npm run test:dependencies` after installing or upgrading dependencies. CI runs
these tests too. Malformed-input tests execute in child processes with memory
and time limits so a missing patch cannot hang the test runner.

- `decode-uri-component@0.2.2`, used by Expo Router through `query-string@7.1.3`:
  [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr).
  Backport the UTF-8 scanner from upstream 0.5.0 while retaining the CommonJS
  export and plus-to-space behavior expected by the current consumer. The local
  adaptation scans malformed input once, preserves the legacy BOM/incomplete
  `%C2` replacements, and avoids constructing regular expressions from input or
  rescanning decoded escapes. Valid Unicode, repeated query parameters, literal
  percent escapes, and long malformed inputs are covered by regression tests.
  Upstream 0.5.0 is ESM, so forcing that version into the existing CommonJS
  dependency is not a drop-in update.
These patches mitigate the tested vulnerable paths without changing package
versions. `npm audit` inspects version ranges, not patched source, and therefore
continues to report these packages and their dependent chains. Do not suppress
the audit output or treat the raw count as a count of independently exploitable
application paths. Installations that skip postinstall do not have these fixes.

Remove each patch when the consuming dependency supports an upstream fix and
the same regression tests pass without it. Recheck module exports and Metro
compatibility, regenerate third-party notices, and validate native/desktop
bundles before accepting the replacement.

## Remaining toolchain findings

- `drizzle-kit@0.31.10` loads `@esbuild-kit/core-utils@3.3.2`, which uses
  `esbuild@0.18.20` for transforms. The
  [esbuild advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99) concerns
  esbuild's HTTP development server. That server is not invoked by this loader;
  the application's build commands use the separate, newer root esbuild.
  Track the upstream loader replacement instead of downgrading Drizzle Kit or
  forcing a different esbuild API into its dependency tree. Reassess if this
  toolchain starts using esbuild's `serve` API.
- `xcode@3.0.1` uses `uuid@7.0.3` in `generateUuid()` through `uuid.v4()` without
  an output buffer. The
  [uuid advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq) affects
  `v3`/`v5`/`v6` output-buffer bounds, so the inspected call does not exercise
  that vulnerability. Track the upstream dependency update and reassess if the
  call changes. The resulting Expo audit entries are transitive findings.

`sharp@0.35.4` and its updated libvips distribution address the earlier
[sharp advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c). Keep the lockfile
and reviewed native notice snapshots together. This assessment is scoped to the
listed advisories and inspected paths, not a guarantee against other defects.
