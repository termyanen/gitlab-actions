# Working on GitLab MR Actions

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and validation commands.
This file is the shared instruction source for coding agents. Keep tool-specific
instruction files as pointers here, rather than maintaining competing rules.

## Delivery workflows

- For PR preparation, read `.agents/skills/prepare-pr/SKILL.md`.
- For release preparation, read `.agents/skills/prepare-release/SKILL.md`.
- [docs/DELIVERY.md](docs/DELIVERY.md) is the shared PR/release procedure and source
  map for README, website, locales, changelogs, privacy and version updates. Follow
  its impact matrix before declaring a change ready. An unaffected surface needs
  a reason, not a cosmetic edit. Instructions apply to every agent, not just Claude.
- `CLAUDE.md` and `GEMINI.md` are symlinks to this file. Edit this canonical file.

## Project map

- Before adding or moving a feature, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
  for the ownership map, wiring steps and cycle fixes. Extend an existing owner
  when appropriate; a helper or button does not automatically need a new slice.
- Chrome Manifest V3 extension, TypeScript + esbuild. Settings, popup and welcome use React;
  injected GitLab UI and the worker remain framework-free.
- `src/app/entrypoints/` contains browser entry points; `src/app/` composes features.
- FSD layers descend through `app → pages → widgets → features → entities → shared`.
  Sibling slices cannot import each other. Import through a slice's explicit
  `index.ts`, `content.ts` or `background.ts` public API. Shared units expose `index.ts`.
- `scripts/check-architecture.mjs` enforces imports, runtime cycles, source reachability
  and named timer policies. Build entry points live in `scripts/entrypoints.mjs`.
  Do not bypass checks with dynamic imports, wildcard exports or test hooks.
- Inside a slice, import implementation files directly rather than its own public
  barrel. Compose independent slices in a higher layer or inject a small capability.
  Type-only imports still obey boundaries. Runtime sources use `.ts`/`.tsx` and ESM;
  CommonJS, unconfigured source extensions and symlinks inside `src/` are rejected.
  React imports/JSX are restricted to extension-owned UI units; the checker also
  rejects transitive React dependencies from content and background entry points.
- Root manifest, HTML, CSS, icons and `_locales/` are source assets. Root runtime
  JavaScript files are obsolete: edit `src/`, build, then load `dist/` in Chrome.
- `scripts/` is Node tooling; `tests/` holds VM regressions and Chromium fixtures.
  `.reports/`, `dist/`, archives and browser traces are generated, not source.

## GitLab UI integration

- Before adding or changing injected UI, read [docs/GITLAB_UI.md](docs/GITLAB_UI.md).
  Reuse GitLab controls, markup/class patterns and semantic theme tokens through
  the existing integration points. Do not invent a separate button or visual style
  when an appropriate GitLab pattern already works in the supported contexts.
- Custom CSS needs a concrete layout, missing-control or compatibility reason.
  Keep it scoped to extension UI; preserve selector/theme fallbacks and keyboard
  behavior. Do not add a UI framework to injected GitLab controls or copy GitLab's stylesheet
  to style a control. Extension-owned settings, popup and welcome use their shared React UI.
- For UI PRs, name what was reused, explain new styles/fallbacks and record light/dark,
  keyboard and affected modern/legacy DOM checks. Report untested combinations;
  passing API fixtures does not certify styling on every GitLab version.

## Preserve behavior and contracts

- Preserve settings keys/defaults, per-project overrides, import/export formats,
  localized strings and existing GitLab/Jira compatibility fallbacks.
- React page components use controlled typed drafts, shared controls and explicit
  save/error state. Keep parsing/serialization outside rendering. Do not reintroduce
  HTML-string templates, DOM-value scraping or imperative child replacement inside
  React trees. Hooks must obey rules-of-hooks/exhaustive-deps; effects own subscription
  cleanup and ignore stale results.
- Settings contracts live in `src/entities/settings/`; settings transfer validation
  lives in `src/features/manage-settings/`; settings UI lives in `src/pages/settings/`.
  Update all affected paths together when introducing a setting.
- Put GitLab DOM selectors in `src/shared/config/gitlab/` and REST protocol
  constants/paths in `src/shared/config/gitlab-api/`; prefer
  `data-testid` plus existing legacy fallbacks. Extension-owned markup can use
  local selectors. Name timing, retry, size and concurrency policies close to their
  owner; do not extract every literal or move feature-specific code into Shared.
- New user-facing strings belong in all supported `_locales/*/messages.json` files.
  User-visible features also need appropriate README/welcome/site documentation.
- Validate external messages, imported JSON and API data before narrowing types.
  Use `unknown`, guards and discriminated unions at boundaries. Avoid `any`,
  `as unknown as`, broad assertions and non-null assertions that hide missing data.
- `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are required. ESLint
  rejects unsafe narrowing, non-null assertions and unsafe operations on `any`.
  Preserve absent-vs-undefined serialization; capture checked state/capabilities
  before async callbacks. Put response decoders with the entity/feature that owns
  the contract; keep nullable fields, legacy variants and partial-review recovery.
- Required extension template nodes use checked DOM access. Optional nodes,
  including controls rendered only in some UI states, need a missing-node path.
  Settings fields must use their actual control kind;
  do not label a select or textarea as an input to access its value.
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
- For API changes, cover the affected failure paths: missing/revoked host access,
  expired sessions or login-page responses, denied operations, unavailable servers,
  malformed/partial data and stale/cancelled requests. Show actionable localized
  feedback in the relevant UI; do not report failure as an empty successful result.
  Distinguish authentication from authorization: a 403 does not by itself prove
  that signing in again will help. Preserve unrelated GitLab features when Jira
  fails, and avoid repeated alerts for the same background failure.
- Jira compatibility is capability-based. Preserve Server/Data Center response
  variants and identify Cloud-specific contracts before claiming support. Add
  fixtures for the response variants touched and state which live versions, if
  any, were tested; a shared endpoint path is not proof of universal compatibility.

## Browser permissions and exposed resources

- Read [docs/PERMISSIONS.md](docs/PERMISSIONS.md) before changing `permissions`,
  `optional_permissions`, host patterns, content-script matches or web-accessible
  resources. Do not add or broaden access for hypothetical future features.
- Each addition or expansion must name the implemented feature and code path,
  explain why existing access or a narrower alternative is insufficient, and use
  the smallest API/resource/origin scope. Prefer optional access for optional
  features; explain any required grant rather than copying existing permissions.
- Document when access is requested, the user gesture and visible explanation,
  denial/revocation behavior, and any install/update warning impact. Do not
  repeatedly prompt or broaden access to work around a denied request.
  Call `permissions.request` directly from an explicit user action, before an
  `await` or debounce; autosave must not trigger permission prompts. Provide a
  deliberate recovery action for revoked access even when settings are unchanged.
- Update the inventory and PR rationale in the same change. Prepare the matching
  Chrome Web Store permission justification and privacy/listing changes when
  affected; only change the actual dashboard within the authorized publish scope.
- Validate both granted and denied/revoked paths, an existing-user upgrade where
  relevant, and the final packaged manifest. Never add a permission just to make a
  test pass; remove unused access when its last consumer is removed.

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
  and both changelogs, then regenerate website copies and version footers with
  `npm run docs:build`. Run `npm run release:check -- --ready` before handing off a
  release. Tooling-only work does not need a version bump.
