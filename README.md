# GitLab MR Actions

> GitLab MR actions and a complete review workflow with your own AI: copy context, fix selected feedback, preview replies and recheck changes. Plus auto-merge, CI tools and Jira integration. No automatic AI uploads.

[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Install-blue?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/gitlab-mr-actions/lbploihmpffiihpgeojdlpcclegbdeak)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## Why?

GitLab's UI requires multiple clicks and page reloads for common MR operations. This extension adds action buttons directly to the MR page — rebase, bump version, enable auto-merge, all in one click. Plus deep Jira integration without leaving GitLab.

## Features

### MR Detail Page — Action Buttons

The toolbar separates MR age and warnings from actions, with quick comments in
their own labelled row. Buttons share GitLab-style sizing and theme colors; force
merge and pipeline cancellation use danger text. Your configured action order is
preserved. MR age uses the selected interface language, with the creation date
available on hover. Long labels wrap on narrow pages.

| Button | What it does |
|--------|-------------|
| **Rebase** | Rebase branch without merging |
| **Version Bump** | Commit version increment (patch/minor/major) via GitLab API |
| **Rebase + Version** | Rebase, then bump version |
| **Rebase + Auto-merge** | Rebase and enable auto-merge when pipeline passes |
| **Ship** | Rebase when needed, bump the version, wait for MR/pipeline readiness, then request auto-merge |
| **Force Merge / Force Ship** | Request merge without waiting for pipeline success; Force Ship also bumps the version. GitLab permissions and merge rules still apply |
| **Retry Failed** | Retry failed jobs in the MR's current pipeline |
| **New Pipeline** | Trigger a new pipeline |
| **Cancel Pipeline** | Request cancellation of running/pending MR pipelines |
| **Draft Toggle** | Mark/unmark MR as draft |
| **Copy MR** | Copy MR title + link to clipboard |
| **Reviewers** | Mention configured usernames in a comment, reuse a reviewer comment, or run the configured CI job |
| **Custom Jobs** | Trigger any manually-configured CI job |
| **MR Actions** | Named buttons to remove selected/all labels, add/replace labels, or clear assignees, reviewers or milestone |

All buttons are configurable — show/hide, reorder via drag & drop or keyboard-accessible arrow buttons. Per-project profiles let you override settings for specific repositories.

Reviewers uses the team's `Reviewer:` / `Reviewers:` comment convention; it does
not assign GitLab's native reviewer field. Keep the MR tab open until Ship,
rebase or auto-merge setup finishes. Once auto-merge is enabled, GitLab handles
the merge when its conditions are met. Custom job chains have a separate
background tracker described below.

In settings, open **MR & commits → MR actions → Add MR action**, enter a button name and choose
an action. For selected labels, enter exact names separated by commas or new
lines; spaces inside names are preserved. **Remove specified labels** leaves
other labels intact. **Clear all labels** removes every label. Adding/replacing
labels may create missing project labels. Each button changes one field and
uses the common confirmation preference. The MR page refreshes after success.
Buttons also appear in the command palette and can be reordered with other
buttons. Project profiles inherit global MR actions until their list is edited, then
use their own list; an explicitly empty project list hides them. Use the global
value to restore inheritance. Export/import includes these actions.
In **MR & commits**, uncheck a custom job or MR-action button to hide it without
deleting its definition. Recheck it to restore the button in its saved order.
Visibility is saved per global/project list and included in exports. Saved changes
to toolbar buttons, their order and quick comments apply immediately to open MR
pages, including project overrides and imports; no page reload is needed. Running
actions keep their state, and hidden buttons cannot be launched from stale palette entries.

Open **All settings → Data & help → Export settings** to download a JSON file
with all settings, project profiles, custom buttons, Jira actions and AI prompts
and instructions. Share the file, then use **Import settings**, select it and click
**Replace settings** on the other installation. Import replaces the full
configuration; it validates the file before writing and requests access to the
distinct Jira origins configured globally or in project profiles when needed. Browser permissions, sessions and caches are
not transferred. The file includes configured URLs, usernames and comment or
prompt text. The popup provides sound and desktop notification toggles, an inline editor for every settings
section and **How it works**. Jira issue type/priority icons remain configurable
under **Jira integration** in either editor. **All settings** opens the
complete settings page in a browser tab.

**How it works** opens the welcome guide, with section navigation, larger reading text,
light/dark themes and a layout for narrow windows. It follows the interface language
selected in settings, including changes made while the guide is open, across all 27 locales.

<a id="copy-review-feedback-for-ai"></a>

### AI review: copy, fix, reply and recheck

Long comments use five-line previews with per-comment expand/collapse controls. The mouse wheel scrolls the whole list. In AI review settings, enable full comments by default globally or per project.

[AI review guide / Гайд по ревью с ИИ](https://termyanen.github.io/gitlab-actions/review-guide.html) — step-by-step scenarios for authors and reviewers.
Source guides: [English](docs/AI_REVIEW_GUIDE_EN.md), [Русский](docs/AI_REVIEW_GUIDE_RU.md).

Use the **AI review…** icon on an MR or project issue, or the copy icon beside a
comment, to prepare a ready-to-paste task for your AI coding tool. Hover over an
icon for its tooltip. Each comment has one icon; **Select this discussion** is
available inside the picker when that comment has replies in its thread. Select the task tab — **New review**, **Fix review findings**, **Prepare replies**, or **Follow-up review** — then use **Copy task**. A summary explains the included context. **Advanced settings** holds the current prompt and applicable file filters. **Paste AI response** opens the editable import preview:


- Copy one comment, its whole discussion, selected comments/discussions, or all
  feedback. Only unresolved discussions are selected initially. The **General
  comments** checkbox appears with the **Unresolved** filter and is off by default;
  enable it to include general comments. Other statuses remain available through
  the filter and **Select all discussions**.
  Changing the status filter replaces the selection with matching visible comments
  and clears the previous preview.
- Search by comment, author or file, preview the export, and optionally include
  the issue/MR description. This checkbox is remembered for future copies,
  including **Select all discussions**. Individual replies retain the rest of their thread
  as context, with requested work marked separately.
- Load discussions through the paginated GitLab API, including collapsed and
  not-yet-rendered comments. Compact Markdown keeps full comments and replies,
  authors, links, resolution state, paths, line ranges and branch/commit information
  without repeated API metadata. Code excerpts use the comment's recorded revision;
  the AI locates the corresponding current code. System activity notes are excluded.
- Edit the English default prompt in extension settings, reset it, or adjust it
  for just one export. The default prompt is shared across projects.

Only GitLab is contacted to assemble the export; no AI service is called. The
text is copied to your clipboard for you to paste. If browser clipboard access
fails, the preview stays selected for manual copying. Use **Refresh** to retrieve
new comments and resolution changes. The default selection follows all unresolved
discussions, with general comments only when enabled; after you change the selection yourself,
refresh preserves your choices that still match the status filter. A comment absent
from the discussion list is looked up directly by its current ID, including newly
posted general MR comments.

Comments created with **Add to review** are unpublished drafts. Their individual
copy icons use the separate draft API and label them as unpublished in the export.
On older servers without that API, copying uses the clicked draft's saved page
Markdown (or rendered text) and explicitly warns about missing context.

Modern and legacy MR/issue URLs and project Work Items issue URLs are handled.
GitLab versions, access rules and server limits can affect available data: missing
pages, unavailable code, Notes API fallback, and context size limits are clearly
marked in both the picker and export. Full comment text is preserved; attachments
are linked rather than downloaded. Group-level/non-issue Work Items are outside
this feature. See [compatibility checks](tests/README.md#review-copy-compatibility-audit-2026-10-13)
for the source versions audited and the remaining live-browser checks.

### Review an Entire MR from Scratch

In **AI review…**, choose the **New review** tab, then **Copy task**.
The task is explicit: clearing feedback never switches modes. Switching tabs preserves
selected discussions and independent prompt edits, but discards the previous preview.
Fix review findings and Prepare replies require a selection; Follow-up review without a selection reviews code only.

The default export is compact: MR link, pinned revisions, source/target branches,
file scope, optional description and one JSON response format. The AI needs
repository access to retrieve the commits, combined diff and surrounding code.
If it cannot access the source, the prompt tells it to request the missing data.

Enable **Include code changes** to attach available MR commits and the cumulative
diff. Partial pages, omitted code and size limits are marked explicitly. This
checkbox applies to fresh and repeat reviews and starts unchecked; short code
excerpts in copied feedback remain included. Fresh review loads MR data independently
of discussions, so a discussion-loading failure does not prevent starting it.

For a new review after another reviewer, enable **Account for existing discussions**
in **New review**. It is off by default and remembers your choice. Published
threads are appended as compact summaries so the AI can review the whole MR
independently first, then remove substantially duplicate findings, including
resolved ones. Drafts, reply bodies and threads outside the file filters are
excluded. The **Existing discussions in a new review** automatic instruction
controls this guidance; uncheck the option to exclude the summaries themselves.
See the [review guide](docs/AI_REVIEW_GUIDE_EN.md) for the steps and the distinction
from Follow-up review and Prepare replies.

**Prompt for a fresh review** has its own saved setting and reset button. You can also
edit it for the current export without changing your prompt for fixing existing
feedback. Specify the response language there if desired. Review and reply
prompts follow the user's requested language or the conversation language;
they no longer require Russian responses.

Extension settings → **AI review** contains five independent prompts: fixing
feedback, reviewing from scratch, new findings for publication, replies to
existing discussions, and repeat review. Each has autosave and its own reset to the English default
(up to 1,500 characters). Set the language, review criteria and writing style in
the appropriate prompt. Task tabs use the fresh, fix, reply and repeat prompts; the new-findings shortcut remains in Import. Task-specific edits in Advanced settings apply only to the open window. MR links, revision identifiers, discussion targets and the required JSON
format are added automatically; they do not need to be included in your settings.

**Automatic instructions (advanced)** exposes 32 additional instruction blocks,
including repository/worktree handling, task boundaries, reply style and output
guidance. Each starts enabled and has independent text, enable/disable and reset
controls (up to 1,500 characters). Blank text omits that block; reset restores its
English default and enables it. `{language}` and `{selection}` insert the selected
response language and discussion scope where applicable. The full task preview
shows the result. MR data, JSON examples and loading notices are generated
separately. File filters and publication validation always remain enforced; the
format-only shortcut remains a fixed reference for the supported import format.

### Repeat Review After Fixes

In **AI review… → Follow-up review**, explicitly select a GitLab MR version to compare against,
or choose **Enter a commit SHA** and enter the full commit hash you reviewed.
The version list comes from the
[GitLab MR versions API](https://docs.gitlab.com/api/merge_requests/#retrieve-merge-request-diff-versions);
it does not record which version was reviewed. No version is selected automatically.
Without a prior version, the task is a full review of the current MR with the
selected discussions; unresolved discussions are selected initially.
If the version list is unavailable on an older GitLab server, manual SHA entry
and full review remain available.

Click **Copy task** to copy the pinned current and selected prior revisions,
file scope, and selected discussions with their full reply context. Selecting any
comment includes its whole thread. The task summary shows the number of discussions.
To include resolved/general threads, select them using the status filter; to include
all threads, choose **All**, clear search and **Select shown**. With none selected,
repeat review checks code only and does not verify previous findings or generate replies.
By default the AI retrieves code from the repository. With **Include code changes**
enabled, the packet attaches the selected snapshot comparison without also attaching
the entire cumulative MR diff. If no prior version is selected, the source head is
unchanged, or the comparison is unavailable, it includes the full current MR diff.
Unavailable comparisons are explicitly marked. The AI must verify fixes in code, classify previous findings,
check for new defects, and return replies and new findings in the existing version
1 import format. Resolved status and a reply saying “fixed” do not establish
correctness.

There is no local review history, stored review text, or “Save reviewed version”
action. Versions and discussions are fetched from GitLab and held in the open
copy window. Publishing comments does not save review snapshots.
Saved prompts and file filters remain preferences. The separate publication
journal retains only digest identifiers and delivery status to prevent accidental
duplicate posts; it does not contain review text or serve as review history.

The comparison uses GitLab's documented
[`straight=true` snapshot comparison](https://docs.gitlab.com/api/repositories/#compare-branches-tags-or-commits),
so it does not assume that the previous head is an ancestor after a force push.
Fork comparisons use the source project. With code inclusion enabled, missing old commits
or unsupported comparison APIs produce an explicit warning and a full current-MR
review instead. Compact packets instruct the AI to use the same fallback if it
cannot retrieve the old commit. Truncated diffs,
missing discussions and context limits remain visible; the prompt requires the
AI to obtain missing material before claiming complete verification. All three MR
revision references are checked again before returning the packet. Import still
validates revisions for new findings and discussion targets for replies before publishing.
Replies leave discussions open unless you explicitly select **Resolve discussion
after publishing** in the import preview.

### File Filters

**AI review** settings contain four lists: included extensions, included paths,
excluded paths and excluded folders. The copy window offers temporary overrides.
Filters apply to fresh/repeat code reviews and the new-finding prompt. They do not
silently remove explicitly selected feedback or change the dedicated reply prompt.

- Enter one pattern per line or separate patterns with commas; `#` starts a comment.
- `*` matches within a path segment, `**` across directories, and `?` one character.
- Bare names match at any depth; `/src/*.js` and `src/*.js` are rooted at the
  repository. Use `**/src/*.js` for any depth. Matching is case-sensitive.
- Exclusions take priority, including either path of a renamed file. Otherwise,
  extensions and included paths are alternatives. Empty lists review everything,
  including lock files; there are no hidden default exclusions.
- Example: include extensions `js, ts`, exclude folders `dist, node_modules`,
  and exclude files `*.min.js, package-lock.json`.

Exports list included/excluded files and remove excluded diff content. Prompts
without code carry the same scope rules for the AI to follow in its checkout.
A repeat-review finding outside the scope must be marked unverifiable, not fixed.
Filters limit code-review scope, not all text: commit messages, descriptions and
quoted discussions can still mention excluded files. Each list allows up to 1,500
characters, with an additional check against browser storage limits.

**AI response language** in the review settings applies to every task and import prompt, independently of the interface language. Choose Automatic (conversation language) or any of the 27 supported interface locales. It overrides saved prompt language instructions without translating JSON keys, paths or code. Format-only copying remains unchanged.

### Import AI Review Comments

Prepare instructions in **AI review…** or directly in **Import AI review…**.
Both windows use current saved prompts. Copy offers replies for selected discussions;
Import offers prompt shortcuts under **Advanced settings**, including replies for all unresolved discussions. **Copy response format** beside them copies only the JSON structure and field rules for inline comments, general comments and replies; it does not load MR data or saved prompts. Use it when the AI already has the task and verified context, including the reviewed revision and reply targets. Import keeps your entered JSON and checked preview while copying a
prompt, and exposes the prompt for manual copying if clipboard access fails:

1. Choose **New review → Copy task**, or the **Copy review prompt** shortcut in Import, and give the task to an AI with access to the repository and
   MR changes. The prompt includes the MR address, reviewed commit and required
   response format. It asks for concrete findings without modifying code.
2. Paste the returned JSON into the importer and check the preview. Each inline
   finding must match a file, line and exact line text in that MR diff. General
   findings appear separately. Uncheck anything you do not want to send, use the
   pencil icon to edit or extend a comment, or choose **Add comment** to write
   your own general MR comment. **Save changes** validates the edited text;
   **Cancel** discards that edit. File locations and reply targets stay attached
   to their original comments, and your other selections are preserved.
3. Choose **Publish selected** to create comments immediately, or **Add to review**
   to save them as your unpublished GitLab review drafts.

Importing and previewing do not post anything. The extension checks the reviewed
revision again before sending new findings, preserves renamed-file paths and old/new line
positions, and checks existing comments to avoid duplicates. Invalid positions
are reported rather than silently converted into general comments. If a request's
outcome is uncertain, it is reported for verification instead of retried blindly.
An unavailable draft API never falls back to public posting. If you delete an imported draft in GitLab, check the input again: a successfully loaded draft list can clear its old delivery marker and allow adding it again. Existing published comments and uncertain sends remain protected.

Saving an edit updates the preview and the imported JSON without sending it.
Publication is disabled while an editor is open and still requires an explicit
**Publish selected** or **Add to review** action afterward. Already delivered
comments and comments with uncertain delivery are locked against editing into
another submission. If an edit cannot be checked, its text stays in the editor.

The response is one JSON object (a single `json` code fence is also accepted):

```json
{
  "version": 1,
  "mr_url": "https://gitlab.example.com/team/repo/-/merge_requests/42",
  "head_sha": "0123456789abcdef0123456789abcdef01234567",
  "comments": [
    {
      "id": "R1",
      "path": "src/parser.ts",
      "side": "new",
      "line": 42,
      "code": "return JSON.parse(input);",
      "body": "[P1] Handle empty input\n\nAn empty response throws here and prevents the remaining items from being processed. Check the input before parsing."
    },
    {
      "id": "R2",
      "path": null,
      "side": null,
      "line": null,
      "code": null,
      "body": "A concrete finding that applies to the MR as a whole."
    }
  ]
}
```

The address, SHA and locations above are examples. Use the actual values supplied
by the prompt and repository. `id` is unique within the response; `path` is relative
to the repository; `side` is `new` or `old`; `line` starts at 1; `code` is the exact
single line without a diff prefix. Set all four location fields to `null` for a
general finding. `body` is the complete comment in Markdown. Return an empty
`comments` array when there are no findings. This version supports single-line
text anchors and general MR comments.

### Reply to Existing Review Discussions

**Fix review findings** has a **Prepare replies too** checkbox, enabled by default for each new dialog. Disable it for fixes and a normal summary only; the choice survives task-tab switches in that window. When enabled, it requests ready-to-import replies for selected published MR discussions, covering fixes, remaining work and reasons for not making changes. Push all your fix commits, then paste that JSON directly into Import. No second AI pass is required. Replies-only JSON may omit `head_sha`; an older SHA does not block replies after new commits or a force push. In mixed results, stale new findings are blocked separately. Reply targets, changed discussions, duplicate sends and account checks remain enforced.

After addressing feedback, open **AI review… → Prepare replies**, select the discussions you want
to answer and choose **Copy task**. The summary counts discussions, not
individual comments. Selecting any comment includes its full thread, exact IDs
and the current MR commit. Resolved and general threads can be selected too;
unpublished drafts cannot receive these replies. With none selected, the action
is disabled. File filters do not remove selected reply threads.

In Import, **Reply prompt for all unresolved discussions** remains available without
a discussion picker and includes all open threads. To prepare a subset, use Copy.

Give the resulting prompt to the AI that made the fixes, with access to the updated code. The prompt asks for factual
replies in your chosen language explaining what changed and how, and forbids inventing completed fixes
or test results. Local changes not yet pushed must not be presented as already
available in the MR.

Open **Import AI review…** and paste the returned JSON. Preview each original comment
with the proposed answer, adjust the wording with the pencil icon if needed,
select the replies, then publish them or add them to
your review drafts. Replies use the existing discussion, including comments on
older code. By default, replies leave resolution status unchanged. On an open, resolvable
thread, optionally check **Resolve discussion after publishing**. Resolution runs only
after a confirmed published reply and a fresh discussion check; its outcome is shown
separately. Drafts never resolve threads or schedule resolution for later. If resolution
fails, check GitLab; do not repost the already published reply.

Reply entries can be mixed with new findings in the same version 1 envelope:

```json
{
  "version": 1,
  "mr_url": "https://gitlab.example.com/team/repo/-/merge_requests/42",
  "head_sha": "0123456789abcdef0123456789abcdef01234567",
  "comments": [
    {
      "id": "reply-1",
      "type": "reply",
      "discussion_id": "abcdef0123456789abcdef0123456789abcdef0123",
      "note_id": 20970,
      "body": "Исправлено: добавлена проверка пустого ответа перед разбором JSON. Пустой ответ теперь возвращает пустой список."
    }
  ]
}
```

Use the real IDs from the copied context, and replace the example body with what
was actually done. `note_id` identifies the original published comment inside
`discussion_id`; no new file position is needed. The importer checks this
association again before sending. Missing comments are reported rather than
replaced by a new discussion. Duplicate checks are scoped to the discussion,
so identical answers to different threads remain independent.

### MR List Page — Enhancements

- **Jira status badges** — colored badges showing ticket status parsed from MR titles
- **Issue type & priority icons** — native Jira icons next to status badges
- **"Only mine" filter** — one-click toggle to show only your MRs
- **"Needs my review" filter** — show MRs where you are a reviewer
- **"Your review" badge** — detects reviewer assignments from comments
- **Dim Draft MRs** — visually de-emphasize draft MRs
- **Highlight your MRs** — blue left border on your own MRs
- **Copy MR from list** — copy title + link without opening the MR
- **Thread, size, conflict and approval badges** — show MR metadata, with incomplete counts marked
- **Branch names** — source and target branches, with optional links

### Page tools and background jobs

- **MR detail tools:** age badge, failed-job log previews, sensitive-file reminders,
  quick comments and copyable Git commands. Check commands against your local
  repository before running them; hard reset discards local changes.
- **Command palette:** Cmd+K on macOS or Ctrl+K elsewhere opens navigation,
  available MR actions and repository file-name search.
- **Daily activity report:** choose a day, collect created/merged/reviewed/open MRs
  and optionally enrich them with Jira titles. Incomplete selections are marked.
- **Custom job chains:** configure job names in order. The background tracker shows
  progress and cancellation; checkpoints allow recovery after worker restarts.
  Keep at least one signed-in tab on the same GitLab origin open for API access.
  Cancelling a chain prevents subsequent actions; it does not cancel a job already
  started in GitLab.
- **Pipeline groups:** run remaining manual jobs from a group in the pipeline graph.
- **Commit tools:** version badges use the configured version file; cherry-pick
  commits to selected branches directly or through new MRs. Configure target branches
  under **MR & commits → Cherry-pick branches** in **All projects** or a project
  profile. An empty project list inherits the global branches; the editor previews
  the effective list. With Smart fallback
  enabled, a verified version-file conflict can be replayed without that file,
  optionally bumping the target version in the same commit. Other conflicts,
  unsafe changes and uncertain request outcomes stop for inspection.

See [configuration and limits](docs/CONFIGURATION.md) for defaults, inheritance,
cache lifetimes and collection limits.

### Jira Integration

Integration targets Jira Server / Data Center REST API v2 using your signed-in
browser session. Set the HTTPS Jira base URL (including a context path such as
`/jira`, if used), sign in to Jira in the same browser, and click **Allow Jira site
access** beside the URL in extension settings. Saving the URL alone does not ask
for permission. Use the same button to restore revoked site access without
changing the URL; no API token is requested. Settings import requests access when
you explicitly apply the imported configuration.

- **Status badges** on MR list and detail pages with color coding
- **Full ticket sidebar** — click any badge to view: summary, status, type, priority, assignee, reporter, labels, epic, sprint, components, versions, description, attachments
- **Change status** — workflow transition buttons, change ticket status without leaving GitLab
- **Change assignee** — search and reassign with autocomplete
- **Quick actions** — configure each button to change one field or several: status, assignee, labels, Fix Version, affected versions, components, priority and due date. Add, remove or replace list values; advanced custom fields accept a Jira field ID and JSON value. Buttons without a status change work independently of workflow transitions. Existing status + assignee actions remain compatible.
- **Attachments** — view images/videos in lightbox, download files
- **Clickable Epic Link** — opens epic in Jira

The site-access status names the configured Jira host and confirms the browser
permission, not the Jira login state.
**Open Jira** in settings or popup opens your configured address, including any
installation path, in a new tab. **Check connection** in either interface performs
a read-only Jira identity request using your browser session. It shows the result
and check time, with **Sign in to Jira** for expired/missing sessions and distinct
permission, network and response errors. This confirms sign-in and API availability
at that time, not permission to modify every issue. Retry after signing in; results
are not stored or polled, and changing the URL or revoking access clears them.

When configured Jira is unavailable, the extension distinguishes sign-in/session
problems, denied operations, missing site permission and connection/server errors.
Open Jira to sign in or check access, then retry loading data. Failed or uncertain
writes are not automatically replayed. See [Jira compatibility and recovery](docs/JIRA_COMPATIBILITY.md)
for supported contracts, Server/Data Center differences and checks for your instance.

### Version Bump

Flexible configuration for automatic version bumping:

- Supports `package.json`, `pyproject.toml`, `version.txt`, or any custom file
- Configurable JSON/TOML field path (e.g., `version`, `tool.poetry.version`)
- Strategies: patch, minor, major
- Custom commit message template

## Installation

### From Chrome Web Store

1. Install from [Chrome Web Store](https://chromewebstore.google.com/detail/gitlab-mr-actions/lbploihmpffiihpgeojdlpcclegbdeak)
2. Open any GitLab merge request page
3. Action buttons appear automatically

### Manual (Developer Mode)

1. Clone this repo:
   ```bash
   git clone https://github.com/termyanen/gitlab-actions.git
   ```
2. Use Node.js 26 LTS (`nvm install`, then `nvm use`), then run `npm ci` and `npm run build`. Node 22.x (22.13+) and 24.x are also supported; use the latest patch of your chosen line. Node is needed only to build from source.
3. Open `chrome://extensions/` and enable "Developer mode".
4. Click "Load unpacked" and select the generated `dist/` folder.
5. Open a GitLab merge request over HTTPS and allow the extension access to that site.

Use `npm run dev` to rebuild JavaScript and copy changed assets during development.
Reload the unpacked extension and the GitLab tab after a rebuild. Production
builds contain no development server or source maps. Start with
[the contributor guide](CONTRIBUTING.md) and [architecture map](docs/ARCHITECTURE.md).

## Configuration

Click the extension icon for global sound and notification toggles,
project context, the applicable Jira connection status and shortcuts. Choose **All settings** for the full workspace:

- **MR & commits** — MR toolbar order, custom MR actions, quick comments,
  reviewers, version files/strategies, commit-page version display and cherry-pick
- **CI/CD & jobs** — custom job chains, grouped pipeline controls and failed-job/log preview limits
- **Jira** — server URL and explicit site access, issue icons, standup enrichment, commit fields,
  multi-field quick actions and advanced ticket matching
- **AI review** — copy controls, all five prompts, automatic instructions, filters and response language
- **GitLab interface** — MR list/detail enhancements, display thresholds and sensitive-file rules
- **General** — interface language, notifications, sound and confirmations
- **Data & help** — settings export/import; onboarding is linked in the sidebar

Search matches translated section/setting text within the selected scope.
**Settings scope** selects **All projects** or a project profile. Project profiles
cover MR actions and lists, comments, commits/cherry-pick, versions, CI/CD, Jira,
AI review, confirmations and GitLab appearance. Edit an inherited field to set a
project value; **Use global value** restores inheritance. Existing settings and
profiles keep their values, and saving an unrelated field does not copy all
shared defaults into a profile. Interface language, sound, desktop notifications,
cross-project report enrichment and remembered review-dialog choices stay global.
Open settings from a GitLab MR, commit, branch or pipeline page to create its profile. Changes autosave; navigating within
a form preserves drafts. The save status shows pending changes, writes
and failures, with an explicit **Retry** button. Scope changes wait for a successful
write; failed loads keep editing locked. Quick toggles stay synchronized between
the popup and an open settings page, including while editing another setting. Empty profile fields show the inherited
global values. Light/dark styling follows the browser/system theme. Successful save/import messages clear after 10 seconds; errors and unsaved-change warnings remain visible until resolved.

Display policies support global defaults and project overrides, both included in
settings export/import. Existing defaults remain unchanged. Reload GitLab tabs
after changing non-toolbar settings. Incomplete
file scans, thread counts and standup selections are marked explicitly. See
[Configuration and operational limits](docs/CONFIGURATION.md) for defaults,
accepted values, profile inheritance and fixed network/storage budgets.

## How It Works

- **No tokens needed** — uses your existing GitLab session cookies for API calls
- **Jira auth** — uses your signed-in browser session after you grant access to the configured site; no `cookies` API permission is required
- **Privacy** — no telemetry or automatic AI uploads; API requests go to your GitLab/Jira. Optional Chrome Sync stores preferences; AI sharing happens only when you paste the copied context. See the [privacy policy](PRIVACY_POLICY.md).
- **Manifest V3** — modern Chrome extension architecture with service worker

## Supported Languages

27 interface locales:

English, Русский, Deutsch, Español, Français, 日本語, 简体中文, Português (Brasil), Italiano, Polski, 한국어, Türkçe, Nederlands, Bahasa Indonesia, Tiếng Việt, Čeština, Svenska, Română, हिन्दी, Suomi, Dansk, Magyar, Ελληνικά, Slovenčina, ไทย, Български, Bahasa Melayu

Choose a language in settings or use the browser default. The same choices are available for AI responses. See [localization maintenance](docs/LOCALIZATION.md) and [store listing translations](store-listing/README.md). The website and long-form guides remain English/Russian.

## Compatibility

- Chrome 110+ / corresponding Chromium-based browsers (Edge, Brave, Arc, etc.)
- HTTPS GitLab.com and self-hosted GitLab, with site access allowed for the extension.
  Features depend on the server's API, page layout and your permissions; see
  [audited compatibility and live-test gaps](tests/README.md).
- Optional Jira integration uses a signed-in browser session and access to the
  configured HTTPS origin. It targets Server / Data Center APIs; server version,
  SSO, account permissions and custom fields still affect individual features.
  Jira Cloud is not fully supported. See [Jira compatibility](docs/JIRA_COMPATIBILITY.md).

## Development architecture

Extension runtime lives in `src/` and uses strict TypeScript with FSD layers:
`app → pages → widgets → features → entities → shared`. Imports between slices
use their public APIs; CI checks layer direction, prohibits sibling-slice
imports, detects runtime cycles and unreachable source modules, and rejects legacy JavaScript/blanket type
suppressions. Settings, the compact popup and welcome page use React + TypeScript with shared controls.
React is bundled locally in shared UI chunks; content scripts and the service
worker remain framework-free. esbuild and FSD boundaries are unchanged.

Use the [feature implementation and architecture guide](docs/ARCHITECTURE.md)
to choose an owning module, wire content/background/settings behavior, define
public APIs and resolve dependency cycles. The same guide is linked from the
shared agent instructions and contributor workflow.

esbuild emits a small isolated-world content bootstrap and packaged ESM chunks.
Routes load their widgets; review operations, Jira/cherry-pick dialogs, palette
and standup load on demand. Route scopes release listeners, observers and timers,
and abort obsolete reads. Popup and welcome are separate extension pages.
Static manifest, HTML/CSS, icons and locales remain at the repository root to
preserve version/release tooling; only `dist/` is loaded or packaged.

CI chains keep checkpoints in local storage and use a one-minute alarm to wake
the worker. Browser startup re-creates the alarm if Chrome discarded it. A live
worker retains its 20-second job polling. Recovery keeps the
selected pipeline and reconciles an interrupted job start before continuing;
uncertain outcomes are reported for manual verification, without replaying a
write. Preferences and exported settings keep their existing formats.

The [migration plan](docs/REFACTOR_PLAN_RU.md) records the refactor history. Run
`npm run format` after editing sources. `npm run check` includes strict typing,
lint, formatting, FSD boundaries, regressions, bundle budgets and ZIP checks.
`npm run test:browser` checks the installed production artifact on local fixtures.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md) for setup, verification and review
expectations. [AGENTS.md](AGENTS.md) documents architecture and safety constraints
for contributors and coding agents; `CLAUDE.md` and `GEMINI.md` are symlinks to it.
The [delivery procedure](docs/DELIVERY.md) defines PR contents, documentation
updates and release preparation. Portable skills live in `.agents/skills/`.

Use the [issue forms](https://github.com/termyanen/gitlab-actions/issues/new/choose)
for bugs and feature requests. Report vulnerabilities privately using
[SECURITY.md](SECURITY.md). Repository configuration and release checks that need
maintainer verification are listed in [CONTRIBUTING.md](CONTRIBUTING.md#repository-setup-and-release-readiness).

## Testing

Run `npm ci`, then `npm run check` with Node.js 26 LTS (`nvm use`). Node 22.x
(22.13+) and 24.x also have CI compatibility checks. This checks TypeScript,
lint, regressions and the production build. Use `npm test` for regressions only. The
regression suite covers version bumps, MR actions, CI job chains, API relay, Jira
handlers, cherry-pick flows and diff helpers, locales, and release packaging. Tests run in
CI and before Chrome Web Store uploads. See [test coverage and browser checks](tests/README.md)
for details and the remaining end-to-end coverage gaps.

## Preparing a release

Follow the [release procedure and documentation matrix](docs/DELIVERY.md#prepare-a-release-locally).
`manifest.json` is the version source. Update both root changelogs and the site's
`softwareVersion`, then run `npm run docs:build` to regenerate site changelog copies
and guide/privacy version footers. Record user-facing changes in EN/RU Unreleased
sections until preparing a particular release; keep published history unchanged.

`npm run release:check` checks consistency during development and is included in
`npm run check`. Before release, `npm run release:check -- --ready` also rejects
pending Unreleased notes. `npm run --silent release:notes` prints the current
bilingual release notes. These commands do not modify files or publish anything.
The procedure covers validation, ZIP packaging, PR contents and publication.

The private `package.json` configures the development toolchain and has no separate
release version. Both packaging paths build and package only `dist/`.

### CI and Chrome Web Store configuration

Pushes, pull requests and store uploads share `.github/workflows/verify.yml`
on Ubuntu 24.04; the runner label is explicit to avoid an unplanned OS migration.
It installs from the lockfile, validates workflows with actionlint, audits dev
dependencies, and runs `npm run check`. It packages `extension.zip` once and
stores it as the `extension-package` artifact. A separate job unpacks that ZIP
for the Chromium regression and memory/performance checks. The store job waits
for both jobs and uploads the same ZIP. Build and browser reports are retained
for 14 days. `bash pack.sh` still creates `gitlab-mr-actions-v<version>.zip`.
Both archives contain `manifest.json` at their root and packaged MV3 runtime,
icons, CSS, HTML and locales, without development files.

The store workflow uses Chrome Web Store API v2. Configure the following under
**Settings → Secrets and variables → Actions**:

| Setting | Storage | Value |
| --- | --- | --- |
| `CWS_PUBLISHER_ID` | Repository variable | Publisher ID from Developer Dashboard → Publisher → Settings; not a credential |
| `CWS_EXTENSION_ID` | Existing repository secret | The store item ID |
| `CWS_CLIENT_ID` | Existing repository secret | OAuth client ID |
| `CWS_CLIENT_SECRET` | Repository secret | OAuth client secret |
| `CWS_REFRESH_TOKEN` | Repository secret | Refresh token with the `chromewebstore` scope |

A published GitHub release uploads the ZIP without submitting it for review.
The manual workflow defaults to `upload`; selecting `publish` explicitly
uploads and submits after successful processing. HTTP success alone does not
count as successful submission. Release tags must match the manifest version
(`v` prefix optional); bump the version before a new store release.

The minimatch override fixes [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
in the development toolchain. Remove it when upstream dependency ranges include
the fixed version. TypeScript remains on 6.0.3 because the installed
typescript-eslint packages require `<6.1.0`; moving to TypeScript 7 requires a
compatible linter release. Dependabot tracks npm and pinned GitHub Actions updates.

## License

MIT
