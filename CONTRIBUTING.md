# Contributing

GitLab MR Actions is a Manifest V3 extension built with TypeScript and esbuild.
Read [AGENTS.md](AGENTS.md) for architecture and behavioral constraints; the same
rules apply to human contributions and agent-assisted changes.

## Report a problem or propose a feature

Use the [issue forms](https://github.com/termyanen/gitlab-actions/issues/new/choose)
for reproducible bugs and workflow proposals. English and Russian are welcome.
Include relevant versions, settings and sanitized reproduction steps. Security
issues follow [SECURITY.md](SECURITY.md) and the private reporting channel.

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

`npm run lint` checks runtime TS, Node scripts and root tool configurations with
zero warnings allowed. Type-aware rules catch unhandled/misused promises, invalid
awaits, redundant assertions and incomplete union switches. Do not replace a
missing catch with `void`; implement the error path appropriate to the operation.

`npm run format` applies the pinned Prettier style to TS, Node scripts, tool
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
