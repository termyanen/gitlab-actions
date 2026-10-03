# Regression tests

Run from the repository root with Node.js 18.18 or newer:

```sh
npm test
```

No npm dependencies or install step are needed. Packaging checks also use Bash,
`zip` and `unzip` (available on macOS and the Ubuntu CI runner). CI runs on Node.js
22 on pushes and pull requests, and before Chrome Web Store uploads.

## What is covered

| Area | Automated checks |
| --- | --- |
| Version bump | Source/target version base, JSON/TOML/plain text, nested fields, preservation of source changes, Unicode, strategies, project overrides, failed reads/writes, concurrent source edits |
| MR workflows | Ship with merge/semi-linear/fast-forward history, Force Ship, rebase + auto-merge, delayed SHA/diff-head updates, commits fallback, rebase/pipeline timeouts, temporary/fatal merge errors and retry limits, branch removal settings, pipeline actions, draft toggle, copy, fixed reviewers, custom job dispatch |
| Background chains | One pipeline per chain, multi-job execution, retries, concurrent retry after 403, missing pipelines, polling, failure, timeout, cancellation before/during API requests and polling, independent explicit starts across tabs/new pipelines, unique IDs, tab closure, and a simulated fresh worker |
| GitLab API relay | Originating tab preference, frozen tabs, no open tabs, API errors, no replay of ambiguously delivered mutations |
| Jira API handlers | Statuses/details, expired sessions, transitions, assignee, fix versions, posting/deleting comments, mutation errors |
| Cherry-pick diff helper | Clean/shifted/multiple hunks, preservation of unrelated changes, newline handling, rejecting missing/ambiguous context and malformed/binary diffs |
| Cherry-pick flow | Direct/MR modes and mode changes after failure, multiple branches, duplicate clicks, existing branches, modern/legacy conflict responses vs ambiguous failures, paginated/overlapping/oversized diffs, create/update/delete actions, JSON/TOML/text bump in the fallback commit, original author, unsafe reads, concurrent edits, partial failures, retrying MR creation and recognizing an existing MR |
| Install/update | Fresh-install defaults and welcome page, update version notice without resetting settings, missing previous version, browser-only update |
| Extension integrity | JavaScript syntax, locale key parity, manifest resource paths, version consistency across the manifest, website metadata and both changelogs |
| Distribution | Actual ZIP builds from both `pack.sh` and the workflow, required extension resources, exclusion of test files and `node_modules` |

The harness evaluates the checked-in JavaScript in isolated Node VM contexts.
It exposes the original functions **in tests only**; no test hooks or extra
modules are added to the extension. Network requests and Chrome APIs are mocked,
timers are advanced deterministically, and presentation methods such as toasts
are stubbed. No test sends requests to a real GitLab/Jira instance. Packaging runs
in temporary directories, so existing release archives are untouched.

Cherry-pick tests expose the original nested modal function in the VM and drive
its event handlers through a small control/row fixture; the real API adapter,
promise chains, diff replay and version parsers run unchanged. This fixture does
not test HTML layout or GitLab selectors. Requests assert the GitLab
[commit API contract](https://docs.gitlab.com/api/commits/) for explicit conflict
codes and per-file commit guards.

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

## Remaining coverage gaps

This suite covers selected behaviors, not every path or combination of settings.
There is no measured full-extension coverage percentage. The following scenarios
still need tests; their absence does not establish a bug.

| Priority | Area | Scenarios still missing |
| --- | --- | --- |
| Next | Real browser lifecycle | Actual Chrome worker suspension/restart, offline request completion and page reloads. The fresh-VM test confirms existing behavior: tasks live in worker memory, become `not_found` after restart, and are not automatically replayed. Automatic recovery is not implemented. Cherry-pick retry checkpoints last only while its modal remains open. |
| Next | Popup/settings | Debounced autosave, profile switching, button reordering, language changes and permission approval/denial in Chrome. |
| Next | GitLab DOM and navigation | Selector fallbacks across GitLab versions, SPA navigation, repeated injection, confirmation dialogs, command palette, task progress, failed-job panel and list/sidebar badges. |
| Next | Group play | Parent/child pipelines with matching stage names, pagination, status changes while starting a group and partial API failures. |
| Next | Daily activity report | Date/timezone boundaries, event pagination, report watchdog, Jira enrichment failures and malformed/empty-matching ticket regexes. |
| Next | Jira sidebar and quick actions | Full issue/custom-field mapping, comment pagination, multi-step quick actions with partial failures, attachments/media and real cookie sessions. Current API-handler tests cover selected reads and mutations. |
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
