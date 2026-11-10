# Configuration and operational limits

Open the extension popup and choose **All settings**. The popup contains only
global sound/desktop notification toggles, shortcuts to every settings section
and the welcome guide, and the current project context. Changes are saved automatically; the
status shows pending changes, saving, success or failure with **Retry**. Successful
save/import messages on the full settings page disappear after 10 seconds; pending
changes and errors remain visible until resolved.
Switching scope waits for storage confirmation and keeps the current draft on
failure. A failed settings load keeps editing locked until a successful retry.
Search stays within the selected scope, including a selected project profile.
Fields identify shared or project values; **Use global value** restores inheritance.
Legacy blank version/reviewer fields retain their existing inheritance behavior.
Open settings pages synchronize saved settings, project profiles and imports;
notification toggles also stay synchronized with the popup. MR toolbar buttons,
their order and quick comments update after settings are saved,
without reloading the MR. Other display rules still require reloading existing GitLab tabs. Export/import includes every persisted user setting
and project profile. Import replaces settings, validates values, and supplies
current defaults for keys absent from an older export. Rows missing required
properties are rejected rather than silently imported as incomplete actions.

## What users can configure

| Area | Controls |
| --- | --- |
| General | When several settings windows are open, ordinary saves merge only edited fields
with the latest stored configuration. Editing one project does not overwrite
unrelated changes to another project or field. Unchanged legacy branch values and
overrides are preserved without reformatting. Simultaneous edits to the same field
use the last completed save. Import remains an explicit replacement of the whole
configuration, including profiles; it is not a merge of the selected project.

Interface language, sound, desktop notifications and confirmation prompts |
| MR & commits | Visibility/order of MR toolbar buttons; quick comments; named MR actions; reviewer controls; version-file and commit-page settings; cherry-pick |
| CI/CD & jobs | Custom jobs/chains, grouped pipeline controls, failed-job preview and its limits |
| Version bump | File path/preset, nested version field, patch/minor/major, commit message template, version from target branch |
| Reviewer action | Fixed usernames or fallback CI job name (`get-reviewers` by default) |
| MR list | Own/review filters, draft dimming, own-MR highlight, copy, reviewer, thread, size, conflict, approval, branch and Jira badges; branch links |
| Page tools | Collapsed bars, right sidebar, command palette, standup/Jira enrichment, Git commands, sensitive-file warning |
| Jira | HTTPS base URL (including an installation context path), ticket regular expression, displayed commit fields, named quick actions and field updates; **Allow Jira site access** grants or restores access to the selected origin separately from saving the URL |
| Cherry-pick | Target branches, create MR, smart fallback, version bump, commit-page cherry-pick controls |
| AI review | Visibility, five task prompts, response language, editable instruction blocks, file filters, close confirmation; dialog controls also remember the existing-discussion choice |
| Display rules and limits | MR size thresholds, failed-job count/log lines, reviewer-comment scan depth, sensitive patterns/exclusions/built-in rules |

GitLab origin, current project/MR, branches, merge/squash/remove-source-branch options
are obtained from the active GitLab context. They are not tied to the author's
repository. Jira defaults can be replaced in settings. New installs enable a small
starter set of buttons and sound; updates do not reapply that starter preset.

## Cherry-pick branch inheritance

Open **MR & commits → Cherry-pick branches**. Select **All projects** to edit the
global list, or select a project profile to set its own target branches. A non-empty
project list replaces the global list; leaving it empty (including blank rows)
inherits the current global list. The project editor previews the effective branches.
If both lists are empty, add branches in settings or in the cherry-pick dialog.
Project lists use `projectProfiles[project].cherry_pick_branches` in exports; older
profiles without this key inherit automatically. Removing the last branch restores
inheritance. This follows the existing profile matching rules (exact project first,
then a matching saved pattern). Reload an already open commit page after saving.
Dialog-only edits do not change saved defaults.

## Display rules and limits

The full settings page groups limits with their features: failed-job/log limits
in **CI/CD & jobs**, reviewer lookup depth in **MR & commits**, and MR size
thresholds and sensitive-file patterns in **GitLab interface**. Open the rules
and limits disclosure in the corresponding section.

These settings support **global defaults and per-project overrides**. All previous
defaults are retained. Invalid UI/import values are rejected; invalid values
written directly into browser storage fall back to defaults at runtime.

| Setting / exported key | Default | Accepted values and behavior |
| --- | --- | --- |
| Jobs to preview / `failed_jobs_limit` | 5 | Integer 1–20. Loads one extra job to detect more results; links to the complete pipeline instead of claiming a total. At most five traces are fetched concurrently. |
| Log lines / `failed_job_trace_lines` | 50 | Integer 10–500. Last non-empty lines; GitLab's full trace is downloaded before trimming. This limits the preview, not download bytes. |
| Reviewer scan / `reviewer_notes_limit` | 10 | Integer 1–100. Searches the oldest comments for `Reviewer:` or `Reviewers:` and an exact username mention. This is a comment convention, independent of GitLab's native reviewer assignment. |
| Line thresholds / `mr_size_lines` | `50, 200, 500` | Three increasing positive integers, comma-separated. Inclusive upper bounds for S, M and L; larger changes are XL. |
| File thresholds / `mr_size_files` | `5, 15, 30` | Same format; used when line counts are unavailable. A GitLab count such as `1000+` stays marked as a lower bound. |
| Built-in sensitive rules / `sensitive_file_defaults` | `true` | Disable to use only additional patterns. The warning itself is separately enabled by `show_sensitive_warning`. |
| Additional patterns / `sensitive_file_patterns` | Empty | One glob per line, at most 1,500 characters per field. |
| Exclusions / `sensitive_file_exclusions` | Empty | Same format; take precedence over built-in and additional matches for each checked path. |

Sensitive-file patterns are **case-insensitive**. `*` matches any text, including
`/`; `?` matches one character. Other characters are literal, not regular
expressions. A pattern without `/` matches the basename at any depth; a pattern
with `/` matches the full repository-relative path. `**` is equivalent to `*` in
these patterns. This deliberately differs from the existing case-sensitive AI
review filters: neither setting silently changes the other.

For example, add `private/*` and `*.token` on separate lines; exclude
`private/examples/*`. Both old and new paths of a rename are checked: excluding
one path does not suppress a sensitive match on the other path.

Built-in rules preserve the previous detector: `.env`/`.env.*`,
`Dockerfile`/`Dockerfile.*`, `docker-compose*.yml`/`.yaml`, `.gitlab-ci.yml`, root
`.github/workflows/`, `Jenkinsfile`, paths containing `credentials`,
`secret`/`secrets` files ending in `.json`, `.yml`, `.yaml`, `.toml`, `.xml`,
`.properties`, `.cfg`, `.conf`, `.ini`, root `.ssh/`, `.npmrc`, `.pypirc`,
`.htpasswd`, `.pgpass`, names starting with `id_rsa`, and `.pem`/`.key` files.
These are path-based reminders, not an inspection of secret contents.

## Project profiles and inheritance

Select a project in **Settings scope**, then edit its settings in the same sections
as **All projects**. Project settings include button visibility/order, custom jobs,
MR actions, quick comments, reviewers, version files/strategies and target-branch
version selection, commit tools/cherry-pick, MR-list and page presentation, CI
preview limits, Jira URL/matching/fields/actions, and AI prompts/instructions,
filters, response language and close confirmation.

An unchanged setting inherits its current shared value. Editing it creates a
project override; **Use global value** removes the override. The source label
shows **All projects** or **Project value**. Existing profiles and shared values
are preserved, with no migration or reset. Saving one preference does not freeze
unrelated inherited values. A new profile starts with no overrides and inherits
shared CI jobs as well; an explicitly empty job list disables them for that project.
New overrides are stored under
`projectProfiles[project].overrides`; old profile fields retain their export keys.
An explicitly empty quick-comment, custom-job, MR-action or Jira-action list hides
those entries for that project. An empty project Jira URL disables its Jira
integration. Empty cherry-pick branches are the exception: they inherit the shared
branch list. Legacy blank version/reviewer strings also continue to inherit.

When several settings windows are open, ordinary saves merge only edited fields
with the latest stored configuration. Editing one project does not overwrite
unrelated changes to another project or field. Unchanged legacy branch values and
overrides are preserved without reformatting. Simultaneous edits to the same field
use the last completed save. Import remains an explicit replacement of the whole
configuration, including profiles; it is not a merge of the selected project.

Interface language, sound, desktop notifications, Jira enrichment of the report
spanning multiple projects, and remembered review-dialog choices stay global.
Change them under **All projects**. The popup's notification toggles remain global;
its Jira status/link uses the active project's effective URL. The data section
exports/imports the whole configuration, not only the selected profile.

Each configured Jira origin needs its own optional site access. Saving a URL does
not request access; use **Allow Jira site access** for the displayed URL. Applying
an import requests the distinct origins configured globally and in its profiles;
a denial preserves the existing configuration. Browser sessions and grants are
not transferred by export. Other project settings do not add permissions.

The button-order checkboxes also control custom jobs and MR actions. Unchecking
hides a button from the MR toolbar and command palette, retaining its definition
and order. Re-enable it with the same checkbox; saved changes update open MR
toolbars immediately, including global/project overrides and imported settings.
Unrelated settings do not rebuild the toolbar; updates do not refetch MR data or
restart running actions. Export/import preserves optional `enabled` booleans inside each
`customJobs` / `mrActions` entry, including project entries. Missing `enabled` means
enabled for compatibility with existing settings. Visibility follows the entry
when other jobs are deleted or the button order changes.

An exact repository-path match wins. For legacy partial profile keys, the first
matching substring in stored profile order wins; there is no wildcard or
longest-prefix matching. Prefer full `group/project` paths to avoid ambiguous
matches. Imported profile keys follow the same rule.

## Fixed operational bounds

These bounds intentionally remain in code. They constrain network load, memory,
browser storage, or workflow waiting; they are not team-specific naming rules.

- **Sensitive-file scan:** at most ten pages of 100 files. API failures or a full
  last page produce an explicit incomplete-scan warning, including when no match
  was found. GitLab server-side diff limits can also restrict what its API exposes.
- **Thread badges:** inspect the first 100 discussions. A full page is marked with
  `+`; no known unresolved count or an API failure is shown as `?`, with an
  explanation in the tooltip. Cached MR metadata and reviewer badges live for
  five minutes; a page reload refreshes them.
- **Reviewer action:** its search/repost flow reads a page of up to 100 recent
  notes, then falls back to the configured CI job. This is separate from the
  configurable list badge's oldest-comment scan.
- **CI job waiting:** 20-second polling, up to 120 attempts (40 minutes of polling
  delays, plus request time). This bounds how long a chain waits, not how long a
  GitLab job is allowed to run. Rebase/MR-ready/pipeline-discovery waits also have
  finite bounds and report failures. These are not currently settings.
  Background chains need a signed-in tab on the same GitLab origin for API access.
  Ship/rebase/auto-merge setup runs in the originating page; keep that tab open
  until completion. Chain cancellation does not cancel a job already started in GitLab.
- **Standup:** up to 50 MRs per category and 500 activity events; 180-second report
  timeout. Reaching a selection bound adds a warning to the report. The selected
  day is configurable; it does not increase the collection budgets.
- **AI review:** prompts, instruction text and each file filter are capped at
  1,500 characters. Export has finite page/file/context budgets (for example,
  100 pages, 120 file reads, 256 KiB per file and 120,000 diff characters).
  Omitted or unavailable context is disclosed in previews/exports. See
  [the review guide](AI_REVIEW_GUIDE_EN.md) and the named policies in
  `src/features/review-export/model/limits.ts` and
  `src/features/review-import/model/limits.ts`.
- **Settings storage:** the import file limit is 1 MiB; Chrome Sync imposes smaller
  per-item/total quotas. A large profiles object can hit the per-item limit even
  when the file is small. The UI reports save/import errors; export is not a way
  to bypass browser quotas. See [Chrome's storage reference](https://developer.chrome.com/docs/extensions/reference/api/storage).

Route polling, debounce delays, cache lifetimes, API page sizes, concurrency,
protocol field names, DOM selectors and visual design tokens are implementation
policies. Exposing all of them as preferences would not make the extension more
reliable. New behavior that depends on a user's project should have an explicit
setting or use GitLab/Jira data; newly introduced incomplete results should be
visible to users. GitLab documents its lower-bound `changes_count` and diff limits
in [the merge requests API](https://docs.gitlab.com/api/merge_requests/).

The Jira access status names the configured host (including a custom port) and
reports the browser site permission, not whether your Jira session is signed in. **Open Jira** in settings and popup opens the configured
HTTPS URL, including its installation path, in a new tab. A sign-in/session error
appears only when a Jira request reports it. **Check connection** explicitly reads
`/rest/api/2/myself` through the existing worker transport, without HTTP caching.
The status and time describe that last check, not continuous availability or write
permissions for every issue. It does not poll, check while typing, persist identity
or request additional access. Open Jira to sign in, then repeat the check. Changes
to the URL or site permission discard the result; late responses cannot restore it.
