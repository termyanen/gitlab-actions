# Configuration and operational limits

Open the extension popup, or use **Open settings in a new tab**. Changes are saved
automatically; check the save status before closing. Reload existing GitLab tabs
after changing display rules. Export/import includes every persisted user setting
and project profile. Import replaces settings, validates values, and supplies
current defaults for keys absent from an older export.

## What users can configure

| Area | Controls |
| --- | --- |
| General | Interface language, sound, desktop notifications, time tracker, failed-job preview, confirmation prompts |
| MR actions | Visibility and order of built-in buttons; custom manual jobs and job chains; quick comments; named label, assignee, reviewer and milestone actions |
| Version bump | File path/preset, nested version field, patch/minor/major, commit message template, version from target branch |
| Reviewer action | Fixed usernames or fallback CI job name (`get-reviewers` by default) |
| MR list | Own/review filters, draft dimming, own-MR highlight, copy, reviewer, thread, size, conflict, approval, branch and Jira badges; branch links |
| Page tools | Collapsed bars, right sidebar, command palette, standup/Jira enrichment, Git commands, sensitive-file warning |
| Jira | HTTPS origin, ticket regular expression, displayed commit fields, named quick actions and field updates; access to the selected origin is requested separately |
| Cherry-pick | Target branches, create MR, smart fallback, version bump, commit version and group-play controls |
| AI review | Visibility, five task prompts, response language, editable instruction blocks, file filters, close confirmation; dialog controls also remember the existing-discussion choice |
| Display rules and limits | MR size thresholds, failed-job count/log lines, reviewer-comment scan depth, sensitive patterns/exclusions/built-in rules |

GitLab origin, current project/MR, branches, merge/squash/remove-source-branch options
are obtained from the active GitLab context. They are not tied to the author's
repository. Jira defaults can be replaced in settings. New installs enable a small
starter set of buttons and sound; updates do not reapply that starter preset.

## Display rules and limits

These settings are **global**, including on pages with a project profile. All
previous defaults are retained. Invalid UI/import values are rejected; invalid
values written directly into browser storage fall back to defaults at runtime.

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

Profiles override button visibility/order, custom jobs, MR actions, version
file/field/strategy/message and reviewer list/job. Other settings, including
`version_from_target` and display rules, remain global. Blank profile strings
inherit global values; an empty saved action list hides those actions.

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
