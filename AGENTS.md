# Repository instructions

- Read the [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/) before writing code.
- Write documentation and code comments in English. Localize user-facing UI strings in `src/i18n/`.
- Confirm priorities with the maintainer before starting a major feature.
- Use Conventional Commits with an optional scope. Follow the release guide for the exact release commit format.

## Which documents to read

| Document | Owns |
| --- | --- |
| [Design](docs/DESIGN.md) | Shared visual and interaction constraints. Read it before any UI change. Follow its hard rules and record the reason for any approved exception in the PR or commit message. |
| [Architecture](docs/ARCHITECTURE.md) | System boundaries, state and data ownership, lifecycle, and performance invariants. Read it before changing how these fit together. |
| [Protocols](docs/protocols/README.md) | Observable contracts that peers, clients, or embedded apps rely on. Read the relevant spec before changing a contract. |
| [Implementation notes](docs/implementation/README.md) | Feature-specific rationale, compatibility constraints, and platform caveats that are hard to recover from code. Read the relevant note when working in that area. |
| [Contributing](CONTRIBUTING.md) | Development setup, quality checks, and contribution workflow. |
| [Releasing](docs/RELEASING.md) | Builds, signing, publishing, and changelog conventions. Read it before release or changelog work. |

## Keep documentation current

Before finishing a change, update the owning document in the same change when a
durable convention, system invariant, compatibility contract, or documented
workflow changes. Fix inaccurate guidance when you find it. Turn a maintainer
correction or a recurring mistake into a brief rule when it applies to future
work. Enforce the rule in code, tests, or lint where practical.

Edit or replace the existing rule and link to its owner where needed. When
shortening a document, check that current compatibility constraints, intentional
exceptions, and regression-prone rules still have an identifiable home.
Keep component APIs, internal constants, and screen details in code and tests.
Keep values in the spec when peers or callers rely on them. Routine fixes
under an existing rule need no new prose once the regression is covered.
