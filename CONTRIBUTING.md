# Contributing

GitLab MR Actions is a Manifest V3 extension built with TypeScript and esbuild.
Read [AGENTS.md](AGENTS.md) for architecture and behavioral constraints; the same
rules apply to human contributions and agent-assisted changes.

## Setup

Use Node 22.13+ on the 22.x line, or Node 24+. `.nvmrc` selects the CI major;
`.npmrc` rejects incompatible engines. Use npm and commit `package-lock.json`
alongside intentional dependency changes.

```sh
nvm use
npm ci
npm run build
```

Load `dist/` with **Load unpacked** at `chrome://extensions/`. Use `npm run dev`
while editing, then reload the extension and the target page after a rebuild.
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

`npm run check` runs TypeScript, ESLint, Prettier, FSD boundary/cycle checks and
regression tests. Tests first build production output. `npm test` runs the build and regressions
without the other static checks. Fixtures do not use production credentials.
Read [tests/README.md](tests/README.md) for coverage and manual scenarios.

For fast dependency feedback, run `npm run lint:architecture`. When changing
its rules, also run `node --test tests/architecture.test.cjs`; the fixtures must
prove both rejection of invalid graphs and acceptance of supported imports.
Runtime-only cycles are rejected; type-only edges still undergo boundary checks.

The shared CI workflow verifies a ZIP, unpacks it for browser/performance checks,
then makes that same artifact available to the store job. Local success does not
prove GitHub-hosted execution or store credentials work. Store configuration and
release/version rules are in [README.md](README.md#ci-and-chrome-web-store-configuration).

## Linting and formatting

`npm run lint` checks runtime TS, Node scripts and root tool configurations with
zero warnings allowed. Type-aware rules catch unhandled/misused promises, invalid
awaits, redundant assertions and incomplete union switches. Do not replace a
missing catch with `void`; implement the error path appropriate to the operation.

`npm run format` applies the pinned Prettier style to TS, Node scripts, tool
configurations, root JSON and workflow YAML. `npm run format:check` checks those
same files in CI. `.editorconfig` supplies encoding, indentation and line endings
to editors. Formatting is intentionally separate from ESLint.

Legacy CommonJS regression fixtures and the marketing HTML/CSS are outside this
formatting/lint expansion. Keep their surrounding style; avoid reformatting them
as part of a feature change. They still run through regression/browser tests.
No automatic hooks or install-time scripts modify your working tree.

## Reviewable contributions

Follow [Preparing a PR and a release](docs/DELIVERY.md) for the PR body, release
notes, documentation impact matrix and all version locations. The repository ships
portable `prepare-pr` and `prepare-release` skills in `.agents/skills/`; the same
procedure is readable directly by any contributor or coding agent.

Describe the concrete problem, resulting behavior and checks actually run in the
PR. Include screenshots for UI changes and note compatibility/permission/storage
changes. Add focused failure regressions for behavioral fixes. Never upload traces
containing real customer data or credentials.

Prefer small public APIs and explicit contracts over a universal helper. A new
runtime dependency needs measured bundle/startup impact; development dependencies
need a clear tooling purpose and a compatible Node/TypeScript peer range.
Do not edit generated `dist/`, reports or ZIPs. Keep package metadata and tests out
of the extension archive. Do not increment the release version for tooling alone.

## Further type-safety work

`strict` and library declaration checking are enabled. `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes` and a blanket assertion ban are not yet enabled:
existing dynamic API dictionaries, settings and DOM contracts need dedicated
migrations first. Tighten one boundary at a time with regression coverage; do not
turn errors into assertions or change absent-vs-undefined serialization silently.
See the [TypeScript index-access](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html)
and [optional-property](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html)
documentation. The chosen lint rules use [type information](https://typescript-eslint.io/getting-started/typed-linting/)
without adopting an entire stricter preset in one unrelated change.
