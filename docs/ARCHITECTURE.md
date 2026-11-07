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
| `pages` | A complete extension-owned page and its form lifecycle | `pages/settings` |
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
| A GitLab selector or transport change | Shared GitLab configuration/adapter for the external contract; feature-specific request orchestration stays with the feature. Keep existing GitLab fallbacks. |
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
barrel for all Shared utilities. This repository uses relative ESM paths for
both internal and external imports. Path aliases are not currently configured.

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
- JavaScript, JSX, `.tsx`, `.mts` and `.cts` runtime sources outside the current
  `.ts` toolchain, and source symlinks that would hide dependencies from the graph;
- computed dynamic imports, except the single packaged content bootstrap;
- blanket type suppressions, explicit `any` and unnamed numeric timer policies.

Runtime `.ts` files (including ambient `.d.ts`) are covered. If another source
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
