# Working on GitLab MR Actions

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and validation commands.
This file is the shared instruction source for coding agents. Keep tool-specific
instruction files as pointers here, rather than maintaining competing rules.

## Project map

- Chrome Manifest V3 extension, TypeScript + esbuild, framework-free DOM UI.
- `src/app/entrypoints/` contains browser entry points; `src/app/` composes features.
- FSD layers descend through `app → pages → widgets → features → entities → shared`.
  Sibling slices cannot import each other. Import through a slice's explicit
  `index.ts`, `content.ts` or `background.ts` public API. Shared units expose `index.ts`.
- `scripts/check-architecture.mjs` enforces imports, runtime cycles and named timer
  policies. Do not bypass it with dynamic imports, wildcard exports or test hooks.
- Root manifest, HTML, CSS, icons and `_locales/` are source assets. Root runtime
  JavaScript files are obsolete: edit `src/`, build, then load `dist/` in Chrome.
- `scripts/` is Node tooling; `tests/` holds VM regressions and Chromium fixtures.
  `.reports/`, `dist/`, archives and browser traces are generated, not source.

## Preserve behavior and contracts

- Preserve settings keys/defaults, per-project overrides, import/export formats,
  localized strings and existing GitLab/Jira compatibility fallbacks.
- Settings contracts live in `src/entities/settings/`; settings transfer validation
  lives in `src/features/manage-settings/`; settings UI lives in `src/pages/settings/`.
  Update all affected paths together when introducing a setting.
- Put GitLab DOM selectors and API paths in `src/shared/config/gitlab/`; prefer
  `data-testid` plus existing legacy fallbacks. Extension-owned markup can use
  local selectors. Name timing, retry, size and concurrency policies close to their
  owner; do not extract every literal or move feature-specific code into Shared.
- New user-facing strings belong in all seven `_locales/*/messages.json` files.
  User-visible features also need appropriate README/welcome/site documentation.
- Validate external messages, imported JSON and API data before narrowing types.
  Use `unknown`, guards and discriminated unions at boundaries. Avoid `any`,
  `as unknown as`, broad assertions and non-null assertions that hide missing data.
- Do not disable checks or raise bundle/performance budgets just to make a change
  pass. A necessary narrow exception needs a reason beside it. Never add
  `@ts-ignore` or `@ts-nocheck`; an exceptional `@ts-expect-error` needs an explanation.

## Async work, lifecycle and extension security

- Handle rejected promises. Use the existing interactive error flow for user
  actions; `reportError` is a terminal diagnostic for unexpected failures.
  `void` does not catch a rejection and must not be used to silence the linter.
- Chrome callback errors must read `runtime.lastError` inside the callback;
  `reportRuntimeError` handles fire-and-forget callbacks. Respect the minimum Chrome
  version in `manifest.json`: current type definitions also describe newer APIs.
- Own timers, observers, DOM handlers and async results with lifecycle scopes.
  Dialog close and SPA navigation must release references, abort cancellable reads
  and ignore stale responses. Dispose child scopes when their view closes.
- Service worker event listeners register synchronously. Durable job checkpoints
  live in storage; alarms restore execution after restart. Preserve pipeline/job
  identity and independent explicit starts. Do not automatically replay a write
  after an ambiguous network failure; reconcile against server state first.
- GitLab requests use the session API/content-script relay. Jira uses the configured
  origin and optional host permission. Do not add remote code, eval, embedded
  credentials, unconditional host permissions or a page-message mutation bridge.
- Escape untrusted HTML and validate URLs. Keep content styles scoped. New browser
  dependencies/permissions/WAR exposure must have a concrete runtime need.

## Validation and delivery

- Use the pinned toolchain: `nvm use`, `npm ci`, `npm run check`.
- For UI, async, lifecycle or content-script changes run `npm run test:browser`;
  for lifecycle/rendering/cache changes also run `npm run test:performance`.
  See CONTRIBUTING for installing Chromium and for packaging/workflow checks.
- Add a focused regression when fixing a behavioral bug. Test the failure and
  observable outcome, not source spelling, internal line numbers or a config mirror.
- Review the diff, generated package and relevant reports. Report actual commands,
  results and untested areas; fixtures do not certify every live GitLab/Jira version.
- Keep changes scoped; leave unrelated user edits intact. Separate mechanical
  formatting, behavior changes and broad migrations when that improves review.
- Do not push, publish, submit a store build or change remote settings unless the
  user authorizes that action. Tests must not read deployment credentials or contact
  production services. Never include secrets in code, fixtures or logs.
- When local commits are requested, use the configured author, do not add agent
  signatures/Co-authored-by trailers, and do not enable commit signing for the task.
- Version bumps are release work: update `manifest.json`, site `softwareVersion`
  and both changelogs together. Tooling-only work does not need a version bump.
