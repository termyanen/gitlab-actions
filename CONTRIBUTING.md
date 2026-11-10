# Contributing

GitLab MR Actions is a Manifest V3 extension built with TypeScript and esbuild.
The settings page, popup and welcome page use React; GitLab-injected UI and background code keep
their existing DOM/TypeScript implementation.
Read [AGENTS.md](AGENTS.md) for architecture and behavioral constraints; the same
rules apply to human contributions and agent-assisted changes.

## Report a problem or propose a feature

Use the [issue forms](https://github.com/termyanen/gitlab-actions/issues/new/choose)
for reproducible bugs and workflow proposals. English and Russian are welcome.
Include relevant versions, settings and sanitized reproduction steps. Security
issues follow [SECURITY.md](SECURITY.md) and the private reporting channel.

## Setup

Use the latest Node 26 LTS patch selected by `.nvmrc` for development and release
builds. Node 22.x (22.13+) and 24.x remain supported and have separate CI checks;
use their latest security patches. Other majors are not supported implicitly:
`package.json` lists the supported lines and `.npmrc` rejects incompatible engines.
Node runs the build/test tooling; users of the installed Chrome extension do not
need Node. Use npm and commit `package-lock.json` alongside intentional dependency
changes. See the upstream [Node release schedule](https://nodejs.org/en/about/previous-releases).

Recent npm versions require dependency [install-script approvals](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/). `allowScripts`
permits only the pinned esbuild installer, which selects/verifies its native build
binary. Review that script and update its pinned approval when upgrading esbuild;
do not use blanket script approval. Older npm versions do not enforce this policy,
so use the default Node 26 toolchain for the maintained release path.

```sh
nvm install
nvm use
npm ci
npm run build
```

Load `dist/` with **Load unpacked** at `chrome://extensions/`. Use `npm run dev`
while editing, then reload the extension and the target page after a rebuild.
The source stylesheet is `content.css`; the build writes `content-<hash>.css`
and registers that exact filename in the generated manifest. Keep generated
files together when updating an unpacked installation. A clean build removes old
CSS hashes; watch mode retains earlier hashes until the next clean build so the
currently registered manifest can still resolve its resources before reload.
The extension requires Chrome 110+; tests use the pinned Playwright Chromium.

## Choose the right verification

Before implementing a feature, use [the architecture guide](docs/ARCHITECTURE.md)
to choose its owner, public API and content/worker/settings integration. It maps
common changes to existing modules and explains how to compose them without
cycles. Add only the slices and segments the feature actually needs.

| Change | Checks |
| --- | --- |
| Runtime, types, configuration or tooling | `npm run check` |
| UI, content scripts, async behavior | Also `npm run test:browser` |
| Lifecycles, observers, rendering or caches | Also `npm run test:performance` |
| Build or packaging | `npm run check` tests both packaging paths; inspect `bash pack.sh` output |
| Workflows | `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12` and applicable local commands |
| Dependencies | Clean `npm ci`, `npm audit --audit-level=moderate`, then the checks above |

Install the browser before the first browser/performance run:

```sh
PLAYWRIGHT_BROWSERS_PATH=node_modules/.cache/ms-playwright npx playwright install chromium
# On a Linux workstation/runner that needs system libraries, use install --with-deps chromium.
npm run test:browser
npm run test:performance
```

`npm run check` runs TypeScript, ESLint, Prettier, FSD boundary/cycle/reachability checks and
regression tests. Tests first build production output. `npm test` runs the build and regressions
without the other static checks. Fixtures do not use production credentials.
Read [tests/README.md](tests/README.md) for coverage and manual scenarios.

For fast dependency feedback, run `npm run lint:architecture`. When changing
its rules, also run `node --test tests/architecture.test.cjs`; the fixtures must
prove both rejection of invalid graphs and acceptance of supported imports.
Runtime-only cycles are rejected; type-only edges still undergo boundary checks.
Source reachability includes type-only and lazy imports, using the same entry points
as the build. Ambient declarations are included without explicit imports.

The shared CI workflow verifies a ZIP, unpacks it for browser/performance checks,
then makes that same artifact available to the store job. Local success does not
prove GitHub-hosted execution or store credentials work. Store configuration and
release/version rules are in [README.md](README.md#ci-and-chrome-web-store-configuration).

The primary build, browser checks and store tooling use Node 26 from `.nvmrc`;
the Node 22/24 compatibility jobs run the same static and regression checks but
do not produce competing release artifacts. Keep `engines`, `.nvmrc`, this matrix
and the documented support policy aligned when changing supported Node lines.

## Repository setup and release readiness

Local checks cannot establish these external conditions. The maintainer verifies
them for the repository and the release revision:

- Enable GitHub Private Vulnerability Reporting and confirm that the report form
  linked in [SECURITY.md](SECURITY.md) is available.
- Configure repository rules/branch protection to require the verification jobs
  from `.github/workflows/verify.yml`; confirm their actual check names from a CI run.
- Verify GitHub-hosted CI and the Chrome Web Store publisher variable/OAuth secrets
  described in README. Store upload/submission is a separate authorized delivery
  step; mocked API tests do not verify live credentials.
- Run the [manual browser scenarios](tests/README.md#browser-verification) on supported
  GitLab/Jira deployments, including an update with existing settings. Record the
  browser/server versions tested. Local fixtures do not establish universal compatibility.

Follow [the delivery procedure](docs/DELIVERY.md) for version selection, notes,
website updates and the final archive. A cleanup or tooling change does not itself
constitute a release, and none of these external actions is performed by `npm run check`.

## Linting and formatting

`npm run lint` checks runtime TS/TSX, Node scripts and root tool configurations with
zero warnings allowed. Type-aware rules catch unhandled/misused promises, unsafe
assignments/calls/member access/arguments/returns, narrowing assertions, non-null
assertions, untyped Promise rejection callbacks and incomplete union switches.
React rules-of-hooks and exhaustive-deps are errors, including in `.ts` hooks.
Do not replace a missing catch with `void`; implement the error path appropriate
to the operation.

`npm run format` applies the pinned Prettier style to TS/TSX, Node scripts, tool
configurations, root JSON and `.github/` YAML (workflows and issue forms). `npm run format:check` checks those
same files in CI. `.editorconfig` supplies encoding, indentation and line endings
to editors. Formatting is intentionally separate from ESLint.

Legacy CommonJS regression fixtures and the marketing HTML/CSS are outside this
formatting/lint expansion. Keep their surrounding style; avoid reformatting them
as part of a feature change. They still run through regression/browser tests.
No automatic hooks or install-time scripts modify your working tree.

## UI changes on GitLab pages

Follow [the GitLab UI integration guide](docs/GITLAB_UI.md) before adding a button,
badge, field, menu or dialog. Reuse GitLab's existing visual patterns and theme
tokens, and extend the owning widget's integration before adding styles. The guide
maps the actual helpers, native markup examples and compatibility fallbacks; there
is no universal version-independent button factory in this repository.

New custom CSS must solve a specific layout, missing-control or compatibility need.
Explain that need in the PR and include the affected light/dark, keyboard and
modern/legacy DOM checks. Existing custom styles are not a reason to create another
visual system. Extension settings/welcome pages and the website have their own
styles; they cannot rely on a GitLab page's stylesheet.

## Reviewable contributions

Follow [Preparing a PR and a release](docs/DELIVERY.md) for the PR body, release
notes, documentation impact matrix and all version locations. The repository ships
portable `prepare-pr` and `prepare-release` skills in `.agents/skills/`; the same
procedure is readable directly by any contributor or coding agent.

Describe the concrete problem, resulting behavior and checks actually run in the
PR. Include screenshots for UI changes and note compatibility/permission/storage
changes. Add focused failure regressions for behavioral fixes. Never upload traces
containing real customer data or credentials.

Changes to browser permissions or exposed resources follow
[the permissions policy](docs/PERMISSIONS.md): justify the implemented use, minimum
scope, optional/required choice, request timing, denial/revocation behavior and
store disclosure impact.

The UI uses only React and React DOM at runtime, with typed shared components and
existing CSS. esbuild builds all three pages as ESM and shares the renderer in
`ui/chunks/`; those files are not web-accessible resources and never join the
GitLab content/worker graph. The production build selects production React and
ships its MIT notices in `THIRD_PARTY_NOTICES.txt`. TSX, React hooks and FSD boundaries
are checked in CI. Keep public barrels as `.ts` files with explicit exports.

The requested React migration has a measurable size cost: the pinned renderer is
about 221 KB minified/uncompressed, shared by the three UI entry bundles. The release
test records actual UI/application/vendor totals in `.reports/react-ui-size.json`;
its separate vendor budget does not replace the compact-popup application budget.
Measure popup startup and memory as well as bytes when changing UI dependencies;
passing a size check alone is not a latency guarantee.

Prefer small public APIs and explicit contracts over a universal helper. A new
runtime dependency needs measured bundle/startup impact; development dependencies
need a clear tooling purpose and a compatible Node/TypeScript peer range.
Do not edit generated `dist/`, reports or ZIPs. Keep package metadata and tests out
of the extension archive. Do not increment the release version for tooling alone.

## Type-safety contracts

`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and library
declaration checking are enabled for every runtime source. Check array/dictionary
lookups, capture validated state before async work, and omit absent optional fields
instead of assigning `undefined` unless the contract explicitly permits it.

GitLab/Jira transports return `unknown`. Validate consumed response fields with the
owning entity's decoder, using `src/shared/lib/validation/` for small guards. Preserve
optional/nullable fields and legacy response forms; unused write acknowledgements
do not need a full resource schema. Messages, storage and imported JSON also need
runtime evidence. An imported review can contain invalid rows: preserve their
diagnostics and editable source without treating them as sendable comments.

ESLint rejects unsafe narrowing assertions and non-null `!`; `as const` and type
widening for empty default collections remain supported. Use checked DOM access for
required extension templates. Optional GitLab nodes and controls rendered only in
some UI states need a missing-node path. Settings helpers distinguish value
controls, checkboxes, text fields and buttons.
Do not silence errors with casts, suppressions or a generic assertion helper.
See the [TypeScript index-access](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html)
and [optional-property](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html)
documentation. The chosen lint rules use [type information](https://typescript-eslint.io/getting-started/typed-linting/)
without adopting an entire stricter preset in one unrelated change.
