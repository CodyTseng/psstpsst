# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Language

This is an open-source project: **all documentation and code comments must be in English.** (User-facing UI strings live in `src/i18n/` and are a separate concern.)

# Design System

Before any UI change (new screen, new component, style tweak, theme change,
adding an icon), you MUST read [`docs/DESIGN.md`](./docs/DESIGN.md) and follow
its §12 "Hard Rules". Breaking a rule requires stating the reason in the PR /
commit message.

`docs/DESIGN.md` is a **living charter**: when a durable design convention changes,
update its concise semantic rule in the same change. Do not copy component APIs,
screen-specific layouts, or implementation narratives into it; those belong in
code.

`docs/DESIGN.md` owns visual and interaction conventions.
`docs/ARCHITECTURE.md` owns
durable system boundaries and data-flow invariants. Detailed protocol behaviour
belongs in `docs/protocols/`; component and screen implementation belongs in
code and tests. Keep all three documents concise.

# Performance

Write high-quality, **high-performance** code: treat performance as part of the task, not an afterthought to bolt on once someone notices lag. Before writing, reason about the cost — how often does this run, on how much data, what does it re-trigger? Then pick the approach that holds up as the data grows (this app's conversations can reach 10k–1M messages). **Judge case by case**; the items below are common levers and examples, **not** absolute rules.

- **Do incremental work, not full recomputation.** When data changes a little, update a little: insert/merge into an already-sorted list instead of re-sorting the whole thing; update one entry instead of rebuilding a whole map; avoid hidden O(n²). Reach for full recompute only when it's genuinely cheaper or simpler-and-small.
- **Avoid unnecessary re-renders — where it pays off.** Memoizing a `FlatList`/`SectionList` row (`React.memo`, with a value-based comparator when props carry per-render closures/objects) is worth it when the list is large and rendered rows seldom change; for a tiny or rarely-updated list it's needless complexity. Judge by the row's render cost and how often siblings actually change.
- **Keep volatile state local.** Put frequently-changing state (e.g. a text input's `value`) in the smallest component that needs it, so a keystroke doesn't re-render a large list.
- **Never let a synchronous task block UI rendering.** Database access already uses the async platform port: Expo uses asynchronous SQLite APIs, and Electron runs SQLite in a worker. Keep that boundary; do not introduce synchronous database calls into UI work. CPU-bound JavaScript, including crypto fallbacks and large result transformations, can still freeze the JS thread. An `await` does **not** help if the awaited work is synchronous or only chains resolved promises: microtasks drain before the next paint. Update the UI **optimistically first**, then defer unavoidable synchronous work to a later **macrotask** (`setTimeout(0)`). Yield between substantial chunks or use a native/worker implementation for sustained CPU-heavy work; a timer delays blocking but does not make the work non-blocking.
- **Don't redo settled work.** Cache/memoize expensive derived values; query or recompute only what changed; bound queries to a window instead of loading whole (possibly huge) histories.

These are examples — the standard is to *think about the performance characteristics of what you write*, not to apply a fixed checklist.

# Project Structure & Platform Layer

The codebase shares its core between mobile and Electron — see
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) §2 for the layer boundaries.
The layers and their rules:

- `src/app/`, `src/components/` — **UI**. Read data via `src/hooks/` + `src/stores/` (never the raw `@/db/client` handle); trigger work via `src/services/`.
- `src/services/`, `src/db/`, `src/lib/`, `src/stores/`, `src/i18n/` — **core**. Business logic, platform-free: these layers must not import `expo-*` or `react-native` (a few sanctioned wrappers exempt — `lib/haptics.ts`, `lib/clipboard.ts`, `lib/navigation.ts`, `lib/platform.ts`, `lib/attachments/failure.ts`; the Drizzle binding has its own seam in `db/use-live-query.ts`). Session state that services drive lives in the service layer as vanilla zustand stores; `src/stores/` holds the React bindings. Services never import from UI layers.
- `src/platform/` — **ports & adapters**. `ports/` are pure interfaces; `expo/` are the implementations; consumers use `import { platform } from '@/platform'`.

Conventions enforced here (and by `no-restricted-imports` in `eslint.config.js`):

- **New OS capability → port first.** Define the interface in `src/platform/ports/`, implement the Expo adapter, register both, then consume via `platform.<port>`. Never import an `expo-*` module into a core layer directly.
- **Ports are async-first.** Every port method returns a promise, even when the Expo adapter underneath is synchronous. No sync port methods (documented exceptions: capability probes, listener registration, cached module-scope reads, pure-CPU work).
- **Live queries** import `useLiveQuery`/`useMigrations` from `@/db/use-live-query` only — never from `drizzle-orm/expo-sqlite`.
- **New UI dependency → prefer libraries with a web implementation** (the desktop shell will render via react-native-web).

# Project Direction

Confirm priorities with the maintainer before starting a major new feature.
