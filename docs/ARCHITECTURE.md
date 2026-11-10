# Adding features and keeping module boundaries

This is the implementation map for contributors and coding agents. Read it before
choosing a home for a new feature. [AGENTS.md](../AGENTS.md) defines the shared
constraints; [CONTRIBUTING.md](../CONTRIBUTING.md) covers setup and checks;
[DELIVERY.md](DELIVERY.md) covers PRs, documentation and releases.

## Choose an owner before adding files

First search for the existing behavior in `src/` and its tests. Extend the slice
that already owns it. A new option, button or helper does not automatically need
a new slice. Create one when it has a distinct responsibility and a useful public
contract. Create only the segments it actually needs; do not fill every layer
with forwarding wrappers.

| Layer | Responsibility in this extension | Existing examples |
| --- | --- | --- |
| `app` | Entry points, routes, lazy loading, message dispatch and composition of independent modules | `app/content/runtime.ts`, `app/content/review.ts`, `app/entrypoints/background.ts` |
| `pages` | A complete extension-owned page and its form lifecycle | `pages/settings` (full workspace), `pages/popup` (quick controls), `pages/welcome` (onboarding) |
| `widgets` | A cohesive UI mounted on GitLab, including its local presentation logic | `widgets/mr-toolbar`, `widgets/mr-list`, `widgets/jira-panel` |
| `features` | A user operation or workflow and the behavior needed to perform it | `features/mr-actions`, `features/review-export`, `features/job-chains` |
| `entities` | Domain contracts, state and domain rules used by operations/UI | `entities/merge-request`, `entities/pipeline`, `entities/settings`, `entities/review` |
| `shared` | Focused technical primitives and external-system adapters | `shared/lib/lifecycle`, `shared/api/gitlab`, `shared/config/gitlab` |

Dependencies descend through `app → pages → widgets → features → entities → shared`.
You can skip layers. Code inside one slice can depend on its own files; it cannot
import another slice on the same layer, even through a type-only import.
`app` and `shared` are the exceptions: their own units may compose with each other,
but Shared unit boundaries still require public APIs and runtime cycles are banned.

Typical change locations:

| Change | Where to start and what to connect |
| --- | --- |
| Another existing MR operation | `features/mr-actions/model/`, its `index.ts`, then the button/action registration in `widgets/mr-toolbar`. Palette actions are supplied through the toolbar contract and wired by App. |
| A new independent operation | An existing owning widget plus `features/<verb-noun>/` when a separate workflow is warranted. App composes independent widgets/features when they need to cooperate. |
| An MR-list badge or display rule | `widgets/mr-list/model/` and `ui/`; add settings through the settings path below. Local formatting belongs with its widget. |
| A modal or panel | Extend its widget, or create a widget with an explicit mount/open/dispose contract. Wire route-aware lazy loading in `app/content/runtime.ts` or the relevant App composition. |
| A background operation/message | Keep the handler in its owning feature. Update the message contract, validation in `app/background/messages.ts`, and dispatch in `app/entrypoints/background.ts`. Register worker listeners synchronously. |
| A persisted preference | Contract/defaults/normalization in `entities/settings` when used by runtime; transfer defaults/validation in `features/manage-settings`; form and persistence in `pages/settings`; consumers, all supported locales and round-trip tests. See [configuration rules](CONFIGURATION.md). |
| A GitLab selector or transport change | `shared/config/gitlab` owns DOM selectors; `shared/config/gitlab-api` owns REST protocol constants. Keep these public APIs separate so session transport does not load widget selectors at startup. Feature-specific orchestration stays with the feature; preserve existing fallbacks. |
| A GitLab control or visual change | Read [the UI integration guide](GITLAB_UI.md), reuse the owning widget's native markup/token patterns and existing fallbacks, then add only the scoped CSS the behavior needs. |
| A helper used twice | Keep it local unless its responsibility is independently reusable. Domain code belongs in the owning entity; only generic technical code belongs in Shared. |

## Define a small public API

For a workflow that needs a new slice, a minimal structure can be:

```text
src/features/<use-case>/
  index.ts           explicit external exports
  model/
    run.ts           operation and orchestration
    types.ts         contract, only when it needs its own file
```

Add `api/`, `ui/`, `lib/` or `config/` only if they help explain the responsibility.
Keep internal files private by default. Export only what an actual caller needs.
Use `export { run } from "./model/run"` and `export type { Options } ...`;
`export *` is rejected. Public API files should expose contracts, not initialize
listeners, fetch data, or compose unrelated slices as side effects of importing.

Cross-slice imports use the target slice's root `index.ts`, `content.ts` or
`background.ts`. Shared libraries/adapters/config units expose their own
`index.ts`, for example `shared/lib/lifecycle/index.ts`; do not introduce one
barrel for all Shared utilities. This repository uses relative ESM paths for internal imports. React packages are
the only external runtime imports permitted, and only in the extension-owned UI
units listed by the checker. Path aliases are not currently configured.

Inside a slice, import the implementation directly, not the slice's own public
barrel. For example, from `features/example/model/run.ts`:

```ts
// Internal dependency: this does not loop back through index.ts.
import { formatResult } from "./format";

// Dependency on a lower slice: use its public API.
import type { MergeRequest } from "../../../entities/merge-request";

// Avoid: import { formatResult } from "..";
// index.ts may re-export run.ts, creating index → run → index.
```

`content.ts` and `background.ts` are environment-specific entry points, not a way
to bypass layer rules. For example, `entities/jira-issue/background.ts` exposes
worker-side APIs separately from browser-facing state. Keep DOM-dependent code
out of worker imports. Naming a file `background.ts` does not automatically verify
its execution environment; check the actual imports and relevant worker tests.

## Compose modules without cycles

When A needs B and B needs A, first check whether they are actually one cohesive
slice. If they are, keep related code together and remove the unnecessary reverse
import. Otherwise:

1. Let a higher layer coordinate the operations. A widget/page/App can call two
   lower slices without either slice importing its sibling.
2. Pass a small callback or capability into the consumer. Put that interface with
   the consumer; App or the owning widget supplies the implementation.
3. If both need the same domain rule or data contract, move that responsibility
   to an appropriate entity. Use Shared only for an independent technical concern.

Do not resolve a cycle with a global registry, a blanket `as` cast, a `require`,
a computed import, or by moving arbitrary feature code into Shared. A literal
lazy import still forms a runtime edge and is checked. Lazy loading is for startup
cost and route ownership, not dependency-rule exceptions.

`import type` / `export type` dependencies are erased from JavaScript, so purely
type-level cycles inside an allowed slice are not rejected as runtime cycles.
They still undergo direction/public-API checks. Do not disguise runtime values as
types to bypass the rule; TypeScript and the build must also pass.

Our policy is stricter than general FSD in two places: all cross-slice imports are
relative, and entity `@x` cross-imports are not enabled. Do not assume a documented
FSD exception is automatically enabled here. If a real domain relationship needs
a policy change, explain it and update the checker, its fixtures and this guide
together instead of disabling a check.

## Wire a feature into the extension

1. Establish the existing slice, runtime (content/worker/settings), public contract
   and settings/defaults affected by the behavior. Identify regression cases.
2. Implement the operation in its owner. Validate API/message/imported data at
   the boundary. Inject only the capabilities it needs; avoid module-level state
   that retains a closed view or an old route.
3. Mount the UI through its owning page/widget and App composition. Use a lifecycle
   scope for DOM, listeners, observers, timers and async results. Disposal must
   prevent late results from changing another MR or a closed dialog. Follow the
   [GitLab UI rules](GITLAB_UI.md) for controls, styles, themes and DOM fallbacks.
4. For a new background message, update validation and dispatch together. For a
   long-running job, use durable checkpoints and restart/reconciliation behavior;
   an in-memory callback is not a service-worker persistence mechanism.
5. Keep heavy dialogs/operations lazy. The static graph, source assets and archive
   are controlled by `scripts/build.mjs`, its shared `scripts/entrypoints.mjs`, root `manifest.json`, and
   `tests/release.test.cjs`. Standard new chunks need no manual hash list. Review
   manifest/WAR/permissions only if the feature actually changes those contracts.
6. Complete settings UI, consumers, import/export, locales and user-facing
   documentation together. Follow the delivery matrix; internal tooling changes
   do not need a feature card or version bump.
7. Run the appropriate checks below and review the diff. In the PR, name the
   owning slice, new public exports/dependencies and execution context when those
   changed; explain why a new slice or dependency is needed.

## What is checked automatically

`npm run lint:architecture` parses source with the already installed TypeScript
compiler API. It builds runtime and source dependency graphs without executing
application code. There is no additional graph-checking dependency or production overhead.

It rejects:

- imports upwards or between sibling slices, including type-only dependencies;
- private cross-slice/Shared imports, unknown layers and imports outside `src/`;
- runtime cycles through imports, re-exports, slice barrels and literal lazy imports;
- source modules unreachable from the build entry points in `scripts/entrypoints.mjs`;
- wildcard exports and unresolvable/non-relative imports;
- CommonJS `require` and external `import = require` loads;
- unapproved external packages and React/JSX outside the settings/popup/welcome UI units;
- transitive React dependencies from content, background and non-React entry points;
- JavaScript, JSX, `.mts` and `.cts` runtime sources outside the current
  `.ts`/`.tsx` toolchain, and source symlinks that would hide dependencies from the graph;
- computed dynamic imports, except the single packaged content bootstrap;
- blanket type suppressions, explicit `any` and unnamed numeric timer policies.

Runtime `.ts`/`.tsx` files (including ambient `.d.ts`) are covered. If another source
format becomes necessary, update TypeScript, lint, build and architecture coverage
together. The source-symlink rule applies only within `src/`; the agent instruction
and skill symlinks outside `src/` are unaffected.

Reachability includes type-only imports and literal lazy imports. Ambient `.d.ts`
files are additional roots because TypeScript includes them without imports.
The checker detects detached files and groups of files; it does not detect every
unused exported symbol or prove that a reachable branch executes. Remove obsolete
exports after checking actual callers. `noUnusedLocals`/`noUnusedParameters` then
help catch unused private code. Do not add artificial imports to keep dead files.

The fixtures in `tests/architecture.test.cjs` exercise both allowed and rejected
cases. A cycle failure prints the file chain, for example
`features/a/index.ts → features/a/model/run.ts → features/a/index.ts`.
Fix the dependency direction shown in the chain rather than silencing it.

```sh
npm run lint:architecture                 # fast dependency feedback
node --test tests/architecture.test.cjs   # checker fixtures, when changing its rules
npm run check                            # required static checks + regression/build checks
```

`npm run check` includes the architecture gate. The `Tests` workflow runs on push
and pull requests, calling `verify.yml`, which runs that command. Store delivery
also reuses verification. These are checked-in gates; whether GitHub prevents
merging a failed check depends on repository rules/branch protection, configured
separately. Do not claim that a workflow file alone makes a check required.

Static imports do not prove correct domain boundaries, browser/worker isolation,
absence of message loops, lifecycle cleanup or lazy-loading performance. Review
those explicitly; run browser tests for UI/async changes and performance tests for
lifecycle/rendering/cache changes as specified in CONTRIBUTING.

The background to these rules is documented in the official FSD
[layer reference](https://feature-sliced.design/docs/reference/layers) and
[public API guide](https://feature-sliced.design/docs/reference/public-api).

## Extension-page presentation

`popup.html` remains the full settings page for existing links. The toolbar action
opens `quick-popup.html`, with its own small entry bundle. The install guide uses
`welcome.html` and the `pages/welcome` slice. All three use `settings.css`
and the React presentation primitives in `shared/ui/settings`; no UI dependencies
are loaded into content scripts or the service worker. A separate esbuild UI graph
builds all three HTML entry modules and deduplicates React into `ui/chunks/`. Those chunks
are extension-local assets, with no additional host access or web-accessible resources. The update notice is shared
through `features/view-release-notes`.

Every full-page control belongs to a `.settings-section[data-category]` in its
owning form. Navigation hides sections without unmounting their editors, so drafts
and typed draft/autosave state survives section changes. React owns rendered
children; serialization reads the draft model, never DOM control values. Search is a navigation control,
not a persisted preference. Searching preserves the selected shared/project scope.
Scope changes must wait
for acknowledged storage writes before replacing the form; errors retain drafts
and expose a retry. Text-input blur events must not schedule a duplicate save. New controls must have labels and a category, and new
copy belongs in all 27 locales. Keep limits beside their feature; do not collect
unrelated settings into one advanced section.

Project forms cover MR/commit tools, CI, Jira, AI, page/list appearance and
confirmation preferences. Shared-only language/notification/report preferences are
identified separately; Data & help still operates on the complete configuration.
Drafts carry effective values and explicit override keys. Editing an inherited
value creates only that override; returning to the global value removes it.
Preserve legacy profile fields and absent/false/empty distinctions. Do not copy
all inherited settings into a profile on an unrelated save. The quick popup writes
only the one toggled global notification key, using entity defaults, rather than
replacing a full form snapshot; its Jira summary resolves the active profile.

Settings persistence merges edits against freshly read storage rather than writing
a complete stale draft. The settings controller serializes read/merge/write work
through the named `gitlab-mr-actions-settings` Web Lock shared by extension pages
on the extension origin. This prevents unrelated profile/field changes in another
settings window from being overwritten; same-field conflicts use the last completed
save. Storage subscriptions reconcile all setting keys, including profiles and
imports, while preserving pending edits. Import deliberately replaces the complete
configuration. Preserve no-op legacy values and reject imported rows missing
required properties rather than repairing malformed external data silently.

`shared/config/project-settings` lists the supported project keys. The small
`shared/api/project-settings` adapter captures the project before asynchronous
storage reads and resolves requested overrides; the promise reader lives in
`shared/api/storage`. Legacy version/button/job/action semantics remain in
`entities/settings` through `getRepositorySettings`, avoiding domain settings in
the shared bootstrap graph. Settings transfer validation rejects unsupported or
malformed nested overrides. AI operations carry their original project context
through asynchronous prompt, filter and instruction reads. Every new scoped
setting must be wired through its actual consumer, not only its settings form.
Do not bypass the existing runtime/lazy-loading budgets for a shared reader.


React imports and automatic JSX runtime are allowed only in `pages/settings`,
`pages/popup`, `pages/welcome`, `features/view-release-notes`, `features/check-jira-connection`, `shared/ui/settings`,
`shared/lib/react-page` and `shared/lib/ui-language`. Entry points call page APIs;
they do not import React themselves. Shared domain/settings and API modules stay
usable without React. New React units require an explicit graph-policy change and
fixtures; allowing arbitrary npm imports is not part of the UI migration.

Keep feature-specific editors in `pages/settings/ui`, draft normalization and
save coordination in its model, and generic fields/toggles/buttons/status in
`shared/ui/settings`. The popup reuses the same controls and locale lifecycle,
but must not import full settings/AI editors. The welcome guide owns its onboarding
content in `pages/welcome` and uses the same shared controls and locale lifecycle;
it must not import the settings or popup page implementation. React does not replace validation,
stale-response guards, user-gesture permission requests or storage confirmation.

Settings section IDs, order and locale keys live in `shared/config/settings-navigation`.
Both popup shortcuts and full-page navigation consume that catalogue; update it
once when adding a section. Notification defaults shared by both pages live in
`entities/settings/model/quick-preferences.ts`; Jira display options belong in the
full Jira settings section.

`features/check-jira-connection` owns the shared, explicit session check in popup
and settings. It loads the existing Jira response decoders only on request and
uses the worker’s read-only identity operation. Results are not persisted; URL
changes, permission revocation and unmount discard them. A successful identity
read does not establish write permissions on every issue.

The compact popup imports notification defaults through the lightweight
`entities/settings/content.ts` API, so shared full-form default initialization
does not pull unrelated display settings into its initial bundle.
