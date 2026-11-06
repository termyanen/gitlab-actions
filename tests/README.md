# Regression tests

Run from the repository root with Node.js 22.13+ or 24+:

```sh
npm ci
npm test
```

The esbuild/TypeScript toolchain is installed from the lockfile. Packaging checks
also use Bash, `zip` and `unzip` (available on macOS and the Ubuntu CI runner). CI runs on Node.js
22 on pushes and pull requests, and before Chrome Web Store uploads.

The shared verification workflow packages once, then runs the browser suite and
profiler against the unpacked ZIP. The store upload job consumes the same
artifact only after both verification jobs succeed. `chrome-web-store.test.cjs`
uses injected transport responses to cover API v2 upload, polling, explicit
submission, HTTP/application failures, OAuth form encoding and version/tag
validation. No test reads deployment credentials or contacts the store.

`npm run release:check` validates versions, EN/RU changelog history and generated
site copies/footers without changing files. `-- --ready` also rejects pending
Unreleased notes. Regression fixtures cover stale pages, translations, duplicate
or misordered versions and release-note extraction. CI regenerates the website
with the pinned `docs/requirements.txt` and fails on a generated-file diff. See
[the delivery procedure](../docs/DELIVERY.md) for PR and release requirements.

`npm test` first builds the production extension and verifies its manifest,
resources, CSP and packaging. A test-only module adapter supports moving
regressions from legacy scripts to TypeScript exports without shipping test hooks.
Initial source and production bundle sizes are recorded in
`fixtures/refactor-baseline.json`. Release graph checks enforce 2 KiB for the
all-HTTPS bootstrap, 20 KB for common GitLab startup and 160 KB for initial MR
JavaScript. `.reports/performance.json` records the comparison; these are not
browser CPU, memory or latency measurements.

Run `npm run test:performance` for a real Chromium resource-retention check.
It loads the packaged extension into a temporary profile, intercepts every
HTTP(S) request, and writes `.reports/runtime-performance.json`. The workload
replaces 20 MR rows 60 times on one route, then opens both review dialogs and
navigates away/back 20 times. Warm-up precedes each measurement. CDP forces GC
and records live DOM nodes, listeners, JS heap, script/task time and list latency.
The latter includes the intentional list debounce; it is not network latency.
Resource budgets fail the command if a scenario retains more than 600 extra
nodes, 5 listeners or 2 MiB of JS heap. Timing is reported without a flaky
machine-dependent pass/fail threshold.

To compare existing production builds without rebuilding either:

```sh
node scripts/profile-runtime.mjs /absolute/path/to/old/dist .reports/runtime-before.json
node scripts/profile-runtime.mjs dist .reports/runtime-after.json --check
```

`tests/browser/lifecycle.spec.cjs` additionally tests delayed/out-of-order Jira
and standup replies, ticket switching, completed Jira mutations, and 100 dialog
openings with deliberately undelivered responses. Memory assertions wait for
rendering frames before GC so transient renderer references are not mistaken
for leaks. These focused fixtures bundle production widget modules with a fake
Chrome transport; `extension.spec.cjs` and the profiler use the installed
production extension and real Chrome extension APIs.

Browser smoke checks install the actual production build in a separate Chromium
profile, intercept all HTTP(S) requests, and exercise real Chrome APIs:

```sh
PLAYWRIGHT_BROWSERS_PATH=node_modules/.cache/ms-playwright npx playwright install chromium
npm run test:browser
```

These checks cover settings autosave/reload, preserving edits across profile and
language changes, an unrelated HTTPS page, review
controls under DOM updates, untrusted page messages, and lazy UI under a restrictive
page CSP. They also cover SPA cleanup of Git commands, failed-job panels and
approval badges, late API responses, stale palette actions, and an in-flight MR
action retaining its original target during DOM replacement. A real worker
stop/restart is tested both for saved status and for an active job chain completing
without replaying its play request. They use local fixtures and do not establish
compatibility with a live GitLab/Jira server. Each run removes its test profile.

The refactor review against `main` (`1d97afe`) ran the same 659 behavioral checks
against both implementations; all passed on both. After the architecture pass,
the full suite has 839 Node tests and 14 production-browser scenarios. Review UI regressions also cover
keeping an edited draft when navigation is declined, ignoring late validation
responses, recovering from an aborted export after returning, and requiring new
validation after an interrupted import send. Test counts describe this review
snapshot, not a whole-extension coverage percentage.

Architecture fixtures verify downward imports, slice and Shared public APIs,
runtime cycle detection, type-only dependency handling, explicit exports, named
timer policies, and the packaged bootstrap exception for dynamic imports. They
exercise both accepted and rejected dependency graphs. TypeScript also checks
unused locals/parameters, accidental switch fallthrough and missing overrides.

## What is covered

| Area | Automated checks |
| --- | --- |
| Version bump | Source/target version base, JSON/TOML/plain text, nested fields, preservation of source changes, Unicode, strategies, project overrides, failed reads/writes, concurrent source edits |
| MR workflows | Ship with merge/semi-linear/fast-forward history, Force Ship, rebase + auto-merge, delayed SHA/diff-head updates, commits fallback, rebase/pipeline timeouts, temporary/fatal merge errors and retry limits, branch removal settings, pipeline actions, draft toggle, copy, fixed reviewers, custom job dispatch, configurable MR label/field actions, validation, API failures and project overrides |
| Background chains | One pipeline per chain, multi-job execution, retries, concurrent retry after 403, missing pipelines, polling, failure, timeout, cancellation before/during API requests and polling, independent explicit starts across tabs/new pipelines, unique IDs, tab closure, durable checkpoints, restart reconciliation, persistence failure and alarms |
| GitLab API relay | Originating tab preference, frozen tabs, no open tabs, API errors, no replay of ambiguously delivered mutations |
| Jira API handlers | Statuses/details, expired sessions, transitions, assignee, fix versions, posting/deleting comments, mutation errors; field-only and composite quick actions, add/remove/set payloads, custom fields, validation before writes, partial failures without retries |
| Jira quick-action settings | Assignee/version-only actions, legacy status+assignee shape, list normalization, custom JSON including null/false/zero, duplicate fields and invalid dates/JSON preventing settings writes |
| MR list lifecycle | Replacement of the list container or rows, pagination during Jira/reviewer/metadata requests, late list rendering, cached and partially cached tickets, title changes and replacement, missing tickets and failed responses without request loops, authentication failures, observer cleanup |
| AI review export | Modern/legacy/project Work Item routes, relative URL roots, all discussion pages and replies, missing pagination headers, duplicate/malformed records, partial failures, Notes API fallback, timeout/cancellation, explicit comment/thread/description selection, Markdown boundaries, fork and renamed-file context pinned to commit SHAs, old anchors, Unicode file fallback, oversized/binary/image files, attachment and snippet limitations |
| Public documentation | Landing-page EN/RU key parity, guide/privacy anchors and assets, repeated language switching, local changelog synchronization and inline script parsing |
| Fresh MR review | Compact default without commit/diff requests, optional code inclusion, all paginated commits and cumulative changed files, legacy changes fallback, pinned revision checks, bounded diff context and explicit omissions, explicit task tabs, empty-selection safeguards, missing-note safeguards, independent prompts/settings and language-neutral output instructions |
| AI review picker and settings | Real picker handlers in a DOM fixture: note/thread/subset/all selection, unresolved-only defaults with optional general comments, filter/checkbox refresh behavior, preservation of manual selections, preview invalidation, missing notes, live note IDs after DOM reuse, newly posted ordinary-comment recovery, separate draft IDs/API and old-server page fallback, draft publication transitions, delayed load/export/clipboard responses, legacy and Work Items wrappers, repeated rendering, system-note exclusion, relative URL roots, clipboard fallback, five independent saved prompts and resets, shared/fallback default parity, prompt quota validation and saved/error status |
| Repeat review and file scope | Selected-thread scope, whole-thread context, empty selection as code-only without discussion requests, missing selected threads, no local review-history writes, explicit GitLab version/manual SHA selection, headerless/unsupported version APIs, direct snapshot comparison after rewritten history, source forks and relative roots, resolved discussions, missing/truncated comparisons, changing refs and cancellation; include/exclude precedence, renames/deletions, legacy diffs, settings quotas and temporary scope overrides |
| AI review import | Versioned JSON and MR identity, current revision and exact diff-line validation, renamed/deleted/context lines, general comments, legacy diff fallback, duplicate detection, editable preview with explicit publication/draft actions, cancellation and per-comment outcomes; text revisions preserve private source, destinations and manual exclusions, added general comments, edit cancellation and delayed responses; targeted replies and original-comment preview, selected-thread reply prompts versus all-unresolved import prompts, thread counts, empty selection and stale selection cancellation, live saved instructions in both prompt buttons in the copy picker, duplicate prompt actions in import preserving input focus, entered JSON and selections, prompt storage errors and cancellation, thread-scoped duplicate detection; controls follow navigation and stale previews cannot send |
| Cherry-pick diff helper | Clean/shifted/multiple hunks, preservation of unrelated changes, newline handling, rejecting missing/ambiguous context and malformed/binary diffs |
| Cherry-pick flow | Direct/MR modes and mode changes after failure, multiple branches, duplicate clicks, existing branches, modern/legacy conflict responses vs ambiguous failures, paginated/overlapping/oversized diffs, create/update/delete actions, JSON/TOML/text bump in the fallback commit, original author, unsafe reads, concurrent edits, partial failures, retrying MR creation and recognizing an existing MR |
| Install/update | Fresh-install defaults and welcome page, update version notice without resetting settings, missing previous version, browser-only update |
| Extension integrity | JavaScript syntax, locale key parity, manifest resource paths, version consistency across the manifest, website metadata and both changelogs |
| Distribution | Actual ZIP builds from both `pack.sh` and the workflow, required extension resources, exclusion of test files and `node_modules` |

The harness evaluates the bundled TypeScript modules in isolated Node VM contexts.
It exposes module functions and controlled UI bindings **in tests only**; no test hooks or extra
modules are added to the extension. Network requests and Chrome APIs are mocked,
timers are advanced deterministically, and presentation methods such as toasts
are stubbed. No test sends requests to a real GitLab/Jira instance. Packaging runs
in temporary directories, so existing release archives are untouched.

Cherry-pick tests call the public dialog factory in the VM and drive
its event handlers through a small control/row fixture; the real API adapter,
promise chains, diff replay and version parsers run unchanged. This fixture does
not test HTML layout or GitLab selectors. Requests assert the GitLab
[commit API contract](https://docs.gitlab.com/api/commits/) for explicit conflict
codes and per-file commit guards.

MR list tests run the original list initializer and rendering code against a
small DOM fixture with asynchronous mutation delivery and detached-subtree
handling. They cover the existing modern and legacy selector shapes in the
fixture, but do not establish compatibility with every live GitLab version or
replace browser checks of native DOM behavior.

Assertions check observable results and API requests rather than snapshots of
the implementation. New bug fixes should first add a regression that fails with
the old behavior. Keep tests out of extension runtime scripts and archives.

## GitLab compatibility audit (2026-10-03)

The changed API paths were checked against official historical source tags and
current documentation. The table records specific contracts, not a supported
version range for the entire extension. No live old/new GitLab servers were used.

| API difference | Behavior covered by tests | Primary sources |
| --- | --- | --- |
| Older cherry-pick errors omit `error_code` | The exact known HTTP 400 message permits fallback only after verifying actual non-version changes. Already-applied, version-only and unverifiable changes cannot trigger another bump. | GitLab 10.8.7 [Commits API](https://github.com/gitlabhq/gitlabhq/blob/v10.8.7/lib/api/commits.rb) and [ChangeService](https://github.com/gitlabhq/gitlabhq/blob/v10.8.7/app/services/commits/change_service.rb) |
| Newer cherry-pick errors identify `conflict` or `empty` | Explicit conflict supports the existing fallback, including version-only bumps. Explicit empty/unknown codes override legacy-looking messages and stop. | GitLab 12.10.14 [Commits API](https://github.com/gitlabhq/gitlabhq/blob/v12.10.14/lib/api/commits.rb), [current commit documentation](https://docs.gitlab.com/api/commits/#cherry-pick-a-commit) |
| Merge readiness can return 405, and changed from 406 to 422 for an unmergeable branch | Bounded retries, including both `message` and `error` response fields; no repeated version bump/rebase. Authentication, permission and missing-MR failures stop. | [GitLab 13.12.15](https://github.com/gitlabhq/gitlabhq/blob/v13.12.15/lib/api/merge_requests.rb), [GitLab 18.4.0](https://github.com/gitlabhq/gitlabhq/blob/v18.4.0/lib/api/merge_requests.rb) |
| New auto-merge naming and additional MR fields | Retain `merge_when_pipeline_succeeds`, accepted by both checked API generations; do not require `auto_merge`, `detailed_merge_status`, `diff_head_sha` or embedded pipeline data. Preserve squash/branch-removal options. | The same [13.12.15 API](https://github.com/gitlabhq/gitlabhq/blob/v13.12.15/lib/api/merge_requests.rb) and [18.4.0 API](https://github.com/gitlabhq/gitlabhq/blob/v18.4.0/lib/api/merge_requests.rb); alias also inspected in [current source](https://github.com/gitlabhq/gitlabhq/blob/master/lib/api/merge_requests.rb) on the audit date |
| Per-file concurrency guards | Send the read file's `last_commit_id` on updates/deletes, and stop on rejection. This parameter is not a new GitLab-only dependency. | [10.8.7 commit actions](https://github.com/gitlabhq/gitlabhq/blob/v10.8.7/doc/api/commits.md), [12.10.14 repository files](https://github.com/gitlabhq/gitlabhq/blob/v12.10.14/doc/api/repository_files.md), [current file API](https://docs.gitlab.com/api/repository_files/) |

Backward-behavior comparison: **49 selected scenarios passed on both** the
original extension 1.12.1 (`25841dd3f807d1ff3d5c25aeeabd617aecae0fa3`) and the
revised runtime. These cover source-based bumps, plain version files, custom
configuration, Ship/Force Ship ordering and waits, MR/job actions, native and
verified legacy cherry-picks, version-only explicit conflicts, and independent
starts on a newer pipeline. Tests for intentionally corrected behavior, such as
preserving source fields in a target-based bump, are separate regressions.

For another comparison, export that revision's `content.js`, `content_proxy.js`
and `background.js` to a temporary directory, then run selected existing tests:

```sh
EXTENSION_TEST_SOURCE_DIR=/absolute/path/to/baseline \
  node --test --test-name-pattern='source-based|plain VERSION|^Force Ship|^native cherry-pick|^direct cherry-pick' \
  tests/version-bump.test.cjs tests/mr-actions.test.cjs tests/cherry-pick-flow.test.cjs
```

Without this optional environment variable, `npm test` uses only workspace
runtime sources. CI does not depend on Git history or downloaded server code.

## Review-copy compatibility audit (2026-10-13)

Review copying reads the GitLab API when the picker opens, so its contents do not
depend on which discussion pages, replies, or diff files the browser has rendered.
An individually copied draft can fall back to its saved page content on older
servers without the draft endpoint, with an explicit incomplete-context warning.
The source checks below establish particular contracts, not compatibility with
every GitLab release. No live old/new GitLab servers were used for this audit.

| Contract | Implementation decision | Primary sources |
| --- | --- | --- |
| Discussions are paginated; their nested notes are serialized together. Read access can filter the notes after discussion IDs are paginated. | Follow pagination, retain all readable replies, and probe for more pages when headers are absent. Report interrupted or inconsistent pagination as incomplete. | [GitLab 13.12.15 Discussions API source](https://github.com/gitlabhq/gitlabhq/blob/v13.12.15/lib/api/discussions.rb), [GitLab 18.4.0 Discussions API source](https://github.com/gitlabhq/gitlabhq/blob/v18.4.0/lib/api/discussions.rb) |
| The Discussions endpoint requires authentication; the Notes API does not guarantee discussion replies. | An authentication failure before comments load is an error. The Notes fallback is explicitly incomplete, never a successful claim that all review feedback was loaded. | The two Discussions API sources above; [discussion note types](https://docs.gitlab.com/api/discussions/#understand-note-types-in-the-api) |
| Ordinary MR comments are individual discussion items and can also be retrieved by note ID. | If the clicked comment is missing, validate an uncached lookup of that exact ID. Ordinary comments can be recovered directly; threaded/unknown comments require one discussion reload or an explicit missing-context warning. Read the current DOM ID when clicked, including after GitLab reuses a note node. | [MR discussion items](https://docs.gitlab.com/api/discussions/#list-all-merge-request-discussion-items), [retrieve an MR note](https://docs.gitlab.com/api/notes/#retrieve-a-merge-request-note) |
| Add to review creates a draft with a separate ID namespace and `note` body field. Older draft components reuse `note_…` anchors; newer ones use `draft_…`. | Identify drafts from their own DOM markers, request the exact draft endpoint and label the export as unpublished. On unavailable endpoints only, use scoped saved Markdown or rendered body text with a partial-context warning. Never substitute a published note with the same number or copy an unsaved editor. | [Draft Notes API](https://docs.gitlab.com/api/draft_notes/), [GitLab 15.11 draft component](https://gitlab.com/gitlab-org/gitlab/-/blob/v15.11.0-ee/app/assets/javascripts/batch_comments/components/draft_note.vue), [current draft component](https://gitlab.com/gitlab-org/gitlab/-/blob/master/app/assets/javascripts/batch_comments/components/draft_note.vue), [saved note body](https://gitlab.com/gitlab-org/gitlab/-/blob/v13.12.0-ee/app/assets/javascripts/notes/components/note_body.vue) |
| REST exposes the tracked `position`, which may move to a newer diff. An anchor is active only when its base, start, and head refs match. | Describe code as the anchor revision, compare all available refs, and label historical and GitLab-mapped locations separately. Export only pinned anchor excerpts, without guessed current-code neighborhoods. | [GitLab 18.4.0 Note entity](https://github.com/gitlabhq/gitlabhq/blob/v18.4.0/lib/api/entities/note.rb), [position tracking](https://github.com/gitlabhq/gitlabhq/blob/v18.4.0/app/models/concerns/diff_positionable_note.rb), [diff comparison refs](https://github.com/gitlabhq/gitlabhq/blob/v18.4.0/lib/gitlab/diff/diff_refs.rb) |
| Notes use numeric `note_…` anchors in both legacy notes and the Work Items UI. Work Item thread wrappers can also carry the root note ID. | Attach controls to actual notes and avoid duplicate controls on enclosing thread wrappers. | [GitLab 13.12.15 note component](https://github.com/gitlabhq/gitlabhq/blob/v13.12.15/app/assets/javascripts/notes/components/noteable_note.vue), [GitLab 18.4.0 Work Item note](https://github.com/gitlabhq/gitlabhq/blob/v18.4.0/app/assets/javascripts/work_items/components/notes/work_item_note.vue), [Work Item discussion](https://github.com/gitlabhq/gitlabhq/blob/v18.4.0/app/assets/javascripts/work_items/components/notes/work_item_discussion.vue) |
| Recent GitLab redirects issue URLs to Work Item URLs; GitLab can also be installed below a nested URL prefix. | Recognize project Work Item routes and retain the installation prefix in API and web links. Group work items and non-issue types are outside this feature's project MR/issue scope. | [Work Items documentation](https://docs.gitlab.com/user/work_items/), [relative URL installations](https://docs.gitlab.com/install/relative_url/), [GitLab 18.4.0 issue-compatible types](https://github.com/gitlabhq/gitlabhq/blob/v18.4.0/app/models/work_items/type.rb) |

Code excerpts have explicit size, line, and request limits. Missing historical
commits, permission failures, binary/image files, LFS contents, and oversized
files remain visible as limitations in the copied text; they do not remove the
selected comments. Attachments and external resources are linked, not downloaded.
Compact output omits repeated API fields and timestamps, but preserves full review
bodies, selected/context-only scope, reply roles, status and precise anchor ranges.
The receiving AI must locate the corresponding current code before applying a change.

The review-export tests exercise the real data/formatting code with mocked HTTP
responses. They do not establish live GitLab DOM, Chrome clipboard permission,
or page-rendering compatibility; use the browser checks below for those surfaces.

Fresh MR review reads the [MR commits](https://docs.gitlab.com/api/merge_requests/#retrieve-merge-request-commits)
and [file diffs](https://docs.gitlab.com/api/merge_requests/#list-merge-request-diffs)
endpoints separately from discussion loading. Tests cover pagination and compare
all three revision references before and after loading. A capped file list,
missing hunks, collapsed/oversized content and local copy limits must be disclosed
in the prompt rather than described as a complete review context.

The import tests also mock GitLab: they do not create real comments. Publication
uses the [Discussions API](https://docs.gitlab.com/api/discussions/#create-a-new-thread-in-the-merge-request-diff)
and explicit draft creation uses the [Draft Notes API](https://docs.gitlab.com/api/draft_notes/#create-a-draft-note).
Each text position uses the server's old/new paths and three diff refs; context
lines require both old and new line numbers. Unsupported draft creation never
switches to publication, and the importer does not call `bulk_publish`, which
would also publish the user's unrelated pending review comments.

Existing-thread replies use [the discussion notes endpoint](https://docs.gitlab.com/api/discussions/#add-note-to-a-merge-request-thread)
with `body`, while draft replies use `in_reply_to_discussion_id`. The importer
checks both the public discussion hash and the original published note ID.
GitLab 15.11's draft API metadata calls `discussion_id` an integer, but its
[model validates a string hash](https://gitlab.com/gitlab-org/gitlab/-/blob/v15.11.0-ee/app/models/draft_note.rb);
numeric IDs must not be guessed or conflated with public discussion IDs.
Sending a reply does not issue a resolve/reopen request. All reply tests use
mocked GitLab responses and do not publish real comments.

A local Chrome fixture was also checked on 2026-10-13 with the production review
scripts/styles and simulated GitLab responses. It verified pagination beyond the
rendered comments, a single reply's requested/context scope, complete and partial
copying, project Work Items navigation, safe rendering of comment text, and layout
at desktop and 390px widths in light/dark themes. The fixture mocked clipboard
writes and extension storage; these checks are not a live-GitLab or installed-
extension compatibility certification.

## Jira quick-action release checks (2026-10-21)

Local Chrome fixtures verified the production popup and sidebar handlers for
version-only and assignee-only actions, existing action settings, adding/removing
fields, list operations, custom JSON and duplicate/date validation. They checked
field-only availability after failed transition loading, transition-name matching,
duplicate-click prevention, refreshed values, preserved comment drafts and
partial-failure notices. Popup layout fits its 392px outer width; status, assignee,
version and operation selectors show one right-aligned chevron in light and dark
themes. The fixtures used simulated extension APIs and Jira responses, without
mutating a real Jira instance.

## GitLab 18.11 compatibility audit

The CI and rebase paths were checked against GitLab 18.11 API source and the
documented REST contracts. A supplied saved MR page from GitLab 18.11.14 was
parsed locally to check the widget, project, description and review action
selectors. The saved page contained the extension's action bar and review
launchers; it did not contain loaded pipeline jobs or an ordinary published
comment suitable for checking the inline copy controls. The supplied page is
not stored in this repository.

`gitlab-18-compat.test.cjs` covers head-pipeline selection, job pagination,
fork project IDs, retry recovery without switching pipelines, queued job states,
bulk retry read failures, cancellation during pagination, explicit rebase status
polling, rejected or incomplete rebase responses, and quickly finished pipelines.
Merged-results and merge-train head references are checked separately because
their synthetic commit SHA differs from the source branch SHA.

| Contract | Audit outcome | Primary source |
| --- | --- | --- |
| MR responses expose the selected head pipeline. Pipeline job results are paginated and ordered newest first. | Reviewers, custom jobs, chains and bulk failed-job retry share this selection policy. Named lookups follow later pages when needed; chains retain their pipeline and project. | [MR API](https://docs.gitlab.com/api/merge_requests/#retrieve-a-merge-request), [18.11 pipeline jobs endpoint](https://github.com/gitlabhq/gitlabhq/blob/v18.11.0/lib/api/ci/pipelines.rb#L160), [Jobs API](https://docs.gitlab.com/api/jobs/#list-all-jobs-by-pipeline) |
| Rebase is asynchronous; the read endpoint returns its status when `include_rebase_in_progress` is requested. A 403 indicates inability to rebase, including source-branch permissions. | Poll with the parameter; fail on missing status or a rejected request before continuing Ship. These were existing assumptions, not a proven new regression introduced by 18.11. | [18.11 MR read parameters](https://github.com/gitlabhq/gitlabhq/blob/v18.11.0/lib/api/merge_requests.rb#L385), [rebase API](https://docs.gitlab.com/api/merge_requests/#rebase-a-merge-request) |
| `preparing`, `waiting_for_resource` and `scheduled` are valid nonterminal job states. | Treat them as already queued and poll them in background chains without replaying play/retry. | [Job status values](https://docs.gitlab.com/api/jobs/#job-status-values) |
| 18.11 accepts both `merge_when_pipeline_succeeds` and `auto_merge`. | Retain the existing request parameter to preserve older-server compatibility. No removal was found in this path. | [18.11 merge endpoint](https://github.com/gitlabhq/gitlabhq/blob/v18.11.0/lib/api/merge_requests.rb#L734) |
| The pipeline bridges route still exists in 18.11. | Group play can retain `/bridges`; this audit does not certify its live graph selectors. | [18.11 bridges endpoint](https://github.com/gitlabhq/gitlabhq/blob/v18.11.0/lib/api/ci/pipelines.rb#L193) |

The saved overview HTML cannot establish compatibility for MR-list rendering,
expanded pipeline graphs, or unpublished drafts. No live GitLab mutations were
performed during the audit. The automated checks use simulated API responses;
they are not certification of every GitLab 18.11 configuration.

### Backward compatibility verification (2026-11-06)

`gitlab-backward-compat.test.cjs` and `helpers/gitlab-contracts.cjs` exercise the
production actions against minimal, source-derived response shapes for these
official GitLab tags:

| GitLab tag | Pipeline response differences | Merge-readiness response | Primary sources |
| --- | --- | --- | --- |
| 12.10.14 | No `project_id`, `source` or `iid` in the pipeline entity | 406 | [Pipeline entity](https://github.com/gitlabhq/gitlabhq/blob/v12.10.14/lib/api/entities/pipeline_basic.rb), [MR API](https://github.com/gitlabhq/gitlabhq/blob/v12.10.14/lib/api/merge_requests.rb) |
| 13.12.15 | `project_id` present; `source` and `iid` absent | 406 | [Pipeline entity](https://github.com/gitlabhq/gitlabhq/blob/v13.12.15/lib/api/entities/ci/pipeline_basic.rb), [MR API](https://github.com/gitlabhq/gitlabhq/blob/v13.12.15/lib/api/merge_requests.rb) |
| 14.10.5 | `project_id`, `source` and `iid` present | 406 | [Pipeline entity](https://github.com/gitlabhq/gitlabhq/blob/v14.10.5/lib/api/entities/ci/pipeline_basic.rb), [MR API](https://github.com/gitlabhq/gitlabhq/blob/v14.10.5/lib/api/merge_requests.rb) |
| 15.11.13 | Same pipeline fields; old auto-merge parameter retained | 422 | [Pipeline entity](https://github.com/gitlabhq/gitlabhq/blob/v15.11.13/lib/api/entities/ci/pipeline_basic.rb), [MR API](https://github.com/gitlabhq/gitlabhq/blob/v15.11.13/lib/api/merge_requests.rb) |
| 16.11.10 | Same pipeline fields; old auto-merge parameter retained | 422 | [Pipeline entity](https://github.com/gitlabhq/gitlabhq/blob/v16.11.10/lib/api/entities/ci/pipeline_basic.rb), [MR API](https://github.com/gitlabhq/gitlabhq/blob/v16.11.10/lib/api/merge_requests.rb) |
| 17.11.0 | Adds `auto_merge` as an alternative; old parameter still accepted | 422 | [Pipeline entity](https://github.com/gitlabhq/gitlabhq/blob/v17.11.0/lib/api/entities/ci/pipeline_basic.rb), [MR API](https://github.com/gitlabhq/gitlabhq/blob/v17.11.0/lib/api/merge_requests.rb) |
| 18.4.0 | Both auto-merge parameter names accepted | 422 | [Pipeline entity](https://github.com/gitlabhq/gitlabhq/blob/v18.4.0/lib/api/entities/ci/pipeline_basic.rb), [MR API](https://github.com/gitlabhq/gitlabhq/blob/v18.4.0/lib/api/merge_requests.rb) |
| 18.11.0 | Both auto-merge parameter names accepted | 422 | [Pipeline entity](https://github.com/gitlabhq/gitlabhq/blob/v18.11.0/lib/api/entities/ci/pipeline_basic.rb), [MR API](https://github.com/gitlabhq/gitlabhq/blob/v18.11.0/lib/api/merge_requests.rb) |

Every checked tag supports `include_rebase_in_progress`; the MR entity exposes
the boolean only when requested. Fixtures omit it on ordinary reads and reject
a version write or merge while their asynchronous rebase is still running.
Tests exercise reviewers, single jobs, complete background chains, missing head
pipeline data, bulk failed-job retries, source-preserving version bumps, Force
Ship ordering, merge readiness retries, forks and Ship after rebase.

The check caught a regression introduced during the 18.11 repair: selecting the
maximum pipeline ID in the legacy fallback disregarded GitLab's preference for
MR pipelines over branch pipelines. The fallback now keeps the first eligible
pipeline in the server's order while excluding other commit SHAs. That ordering
exists in the checked [12.10 finder](https://github.com/gitlabhq/gitlabhq/blob/v12.10.14/app/finders/ci/pipelines_for_merge_request_finder.rb)
and [18.11 finder](https://github.com/gitlabhq/gitlabhq/blob/v18.11.0/app/finders/ci/pipelines_for_merge_request_finder.rb).

**74 backward-parity scenarios pass on both** the unmodified 1.13.2 runtime
(`9e727c2882075d75b5c10161fd908b509069c2a1`) and the revised runtime. These compare
observable writes and outcomes; extra reads needed to select the MR head are
permitted. **24 additional scenarios pass on the revised runtime** for the
intentional rebase-completion and fork-project fixes. The baseline comparison
can be repeated using the exported baseline runtime files:

```sh
EXTENSION_TEST_SOURCE_DIR=/absolute/path/to/baseline \
  node --test --test-name-pattern='backward parity' tests/gitlab-backward-compat.test.cjs
```

This is a matrix of API contracts and simulated workflows, not a run against
eight installed GitLab servers. It neither asserts support for every feature of
those releases nor establishes a whole-extension minimum version. For example,
the GitLab 10.8.7 CE source lacks the MR pipelines and rebase routes used here;
those pre-existing limitations are not treated as newly supported behavior.

## Remaining coverage gaps

This suite covers selected behaviors, not every path or combination of settings.
There is no measured full-extension coverage percentage. The following scenarios
still need tests; their absence does not establish a bug.

| Priority | Area | Scenarios still missing |
| --- | --- | --- |
| Next | Real browser lifecycle | Natural idle suspension, browser shutdown/relaunch, offline request completion and page reloads. Explicit Chromium worker stop/restart and active job-chain recovery are covered; persisted checkpoints reconcile the pinned pipeline before continuing and do not blindly replay an uncertain mutation. Cherry-pick retry checkpoints last only while its modal remains open. |
| Next | Popup/settings | Debounced autosave, profile switching, button reordering, language changes and permission approval/denial in Chrome. |
| Next | GitLab DOM and navigation | Live selector fallbacks across GitLab versions, navigation between page types, repeated injection, confirmation dialogs, command palette, task progress, failed-job panel and sidebar badges. MR list pagination and Jira rendering have fixture coverage. |
| Next | Group play | Parent/child pipelines with matching stage names, pagination, status changes while starting a group and partial API failures. |
| Next | Daily activity report | Date/timezone boundaries, event pagination, report watchdog, Jira enrichment failures and malformed/empty-matching ticket regexes. |
| Next | Jira sidebar and quick actions | Full issue/custom-field mapping, comment pagination, attachments/media, real cookie sessions and instance-specific edit permissions. API-handler tests cover multi-step quick actions with partial failures; a local Chrome fixture covers field-only availability, refreshes and duplicate clicks. |
| Next | Badges and caches | Cache persistence/expiry/eviction, failed fetches, incremental multi-ticket rendering and commit version comparisons across pages. |

The next layer needs representative GitLab DOM fixtures and a dedicated test
instance; VM checks cannot establish real Chrome scheduling, cookie/permission
behavior, instance-specific API/diff limits, or compatibility with every GitLab
version. Cancellation stops the chain's subsequent actions; it does not cancel a
CI job whose play request has already reached GitLab.

## Browser verification

For a release, use a disposable GitLab project and load the unpacked extension:

1. Change a dependency or another field in the MR's source version file. Enable
   "version from target", bump, and inspect the resulting commit: only the version
   value should change semantically; JSON retains its existing two-space formatting
   behavior. Repeat with the configured TOML/plain-text format if used.
2. Run a custom chain with at least two jobs. While the first runs, create another
   pipeline. All remaining chain actions must stay on the original pipeline.
3. Retry a job inside that original pipeline. The chain must follow the replacement
   job there, and report an error if the original pipeline is deleted or its job fails.
4. Smoke-test Ship/Force Ship only in that disposable project, checking branch
   deletion settings and that a rejected bump does not continue to merge.
5. Update an existing extension installation and confirm that profiles, button
   settings and Jira configuration remain intact; the popup should show the new
   version and link to the changelog. This complements the mocked update tests.
6. Cancel a chain while its first job runs: the job can finish, but the next job
   must not start and the tracker must keep the cancelled result.
7. Cherry-pick to two disposable targets with MR mode and fallback enabled. Check
   that an existing working branch is left intact, and retrying a failed MR
   creation in the same modal does not add another commit/version bump.
8. Repeat the applicable workflows on the oldest supported GitLab deployment and
   a recent deployment, recording their exact versions. Confirm selectors, API
   responses, and that an explicit new chain can target a newer pipeline while
   the older chain continues on its original pipeline.
9. With Jira status/details enabled, paginate the MR list forward and back, change
   a filter, and switch pages before Jira finishes loading. The visible page must
   receive its statuses and icons without a reload, duplicates, or repeated
   requests caused by badge rendering. Repeat with reviewer and branch badges
   enabled, and with an empty list followed by results.

For review copying, repeat these checks on an older GitLab deployment and a
recent deployment, recording the exact versions and any installation URL prefix:

1. Open an MR with more than 100 discussions and collapsed replies/diffs. Copy
   all feedback without expanding or scrolling the page; verify that the last
   API page and reply are included, system activity is omitted, and resolved
   threads are distinguishable from unresolved ones.
2. Copy one reply, then its whole thread. The first output must mark only that
   reply as requested work while retaining the root comment, its location, and
   the other replies as context. Search/filter, select a subset, and verify that
   unrelated discussions are absent from the output.
3. Repeat on an issue, its description-only selection, and a recent project
   Work Item issue page. Check inline controls after lazy loading, after a thread
   is collapsed/reopened, and after navigation to another issue. There must be
   no controls on system notes or duplicate thread wrappers.
4. Include an old diff comment, renamed/deleted file, multiline comment,
   file-level comment, and fork MR. Verify the recorded filenames/SHAs and that
   unavailable historical files or approximate current positions are clearly
   identified. Image attachments must not be described as included image data.
5. Interrupt a later discussion-page request, expire the session, and block one
   repository-file read. The UI must report failures accurately; an interrupted
   later page must retain fetched comments with a partial-data warning in the
   copied text. Retry/refresh, close during loading, and navigate during loading
   to check that stale results never copy another MR's data.
6. Change the saved prompt, reopen the picker, try a temporary prompt edit, and
   reset to the English default. Verify that a temporary edit does not silently
   replace the saved setting. Disable/re-enable the feature and check controls.
7. Block clipboard permission or leave the tab unfocused while data loads. Check
   that the prepared text remains available for manual selection/copy, that a
   fresh Copy click works when allowed, and that Tab/Escape work in the picker.

Repeat-review browser checks: publish findings, push fixes (also try force-pushing
a rewritten branch), explicitly choose the reviewed GitLab version or enter its full SHA and inspect the repeat packet.
Check compact exports first, then enable code inclusion: the selected delta must not
duplicate the cumulative MR diff, and an unavailable comparison must explicitly
fall back to the current MR diff. Verify that replies target existing threads and old-side snapshot lines cannot be
used as current MR diff anchors. Verify that importing or publishing a response creates no local review history. Check file-filter overrides, excluded rename paths, a missing
old commit, and failed version-list requests. Automated coverage uses API/DOM fixtures;
it does not replace these live GitLab checks.

## Configurable MR actions browser check (2026-10-21)

A local Chrome fixture exercised the production popup and MR script with mocked
Chrome storage and GitLab responses. It covered adding/editing/removing buttons,
conditional label inputs, normalized saves, stable button identities and order,
project inheritance and empty overrides, confirmation cancellation, command
palette dispatch, API error recovery and a subsequent successful action. The
Russian popup was inspected at 360 px in dark mode. No real MR was modified;
live GitLab permissions and server-specific behavior still require a live check.
