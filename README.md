# GitLab MR Actions

> GitLab MR actions and a complete review workflow with your own AI: copy context, fix selected feedback, preview replies and recheck changes. Plus auto-merge, CI tools and Jira integration. No automatic AI uploads.

[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Install-blue?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/gitlab-mr-actions/lbploihmpffiihpgeojdlpcclegbdeak)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## Why?

GitLab's UI requires multiple clicks and page reloads for common MR operations. This extension adds action buttons directly to the MR page — rebase, bump version, enable auto-merge, all in one click. Plus deep Jira integration without leaving GitLab.

## Features

### MR Detail Page — Action Buttons

| Button | What it does |
|--------|-------------|
| **Rebase** | Rebase branch without merging |
| **Version Bump** | Commit version increment (patch/minor/major) via GitLab API |
| **Rebase + Version** | Rebase, then bump version |
| **Rebase + Auto-merge** | Rebase and enable auto-merge when pipeline passes |
| **Ship** | Rebase + Version + Auto-merge — full release flow in one click |
| **Force Merge** | Merge immediately, bypass pipeline wait |
| **Retry Failed** | Retry all failed CI jobs |
| **New Pipeline** | Trigger a new pipeline |
| **Cancel Pipeline** | Cancel running pipeline |
| **Draft Toggle** | Mark/unmark MR as draft |
| **Copy MR** | Copy MR title + link to clipboard |
| **Reviewers** | Quick-set reviewers from a preconfigured list |
| **Custom Jobs** | Trigger any manually-configured CI job |
| **MR Actions** | Named buttons to remove selected/all labels, add/replace labels, or clear assignees, reviewers or milestone |

All buttons are configurable — show/hide, reorder via drag & drop. Per-project profiles let you override settings for specific repositories.

In settings, open **MR actions → Add MR action**, enter a button name and choose
an action. For selected labels, enter exact names separated by commas or new
lines; spaces inside names are preserved. **Remove specified labels** leaves
other labels intact. **Clear all labels** removes every label. Adding/replacing
labels may create missing project labels. Each button changes one field and
uses the common confirmation preference. The MR page refreshes after success.
Buttons also appear in the command palette and can be reordered with other
buttons. Project profiles inherit global MR actions until saved, then use their
own list; an empty project list hides them. Export/import includes these actions.

Use **Export settings** at the top of the extension popup to download a JSON file
with all settings, project profiles, custom buttons, Jira actions and AI prompts
and instructions. Share the file, then use **Import settings**, select it and click
**Replace settings** on the other installation. Import replaces the full
configuration; it validates the file before writing and requests access to the
configured Jira site when needed. Browser permissions, sessions and caches are
not transferred. The file includes configured URLs, usernames and comment or
prompt text. The ↗ button opens settings in a separate browser tab.

### Copy Review Feedback for AI

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

**Automatic instructions (advanced)** exposes 31 additional instruction blocks,
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
validates revisions for new findings and discussion targets for replies before publishing; it never
resolves discussions automatically.

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

**AI response language** in the review settings applies to every task and import prompt, independently of the interface language. Choose Automatic (conversation language), Russian, English, German, Spanish, French, Japanese or Simplified Chinese. It overrides saved prompt language instructions without translating JSON keys, paths or code. Format-only copying remains unchanged.

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
- **MR age badge** — shows time since MR was created

### Jira Integration

Deep integration with Jira via session cookies (no API tokens needed):

- **Status badges** on MR list and detail pages with color coding
- **Full ticket sidebar** — click any badge to view: summary, status, type, priority, assignee, reporter, labels, epic, sprint, components, versions, description, attachments
- **Change status** — workflow transition buttons, change ticket status without leaving GitLab
- **Change assignee** — search and reassign with autocomplete
- **Quick actions** — configure each button to change one field or several: status, assignee, labels, Fix Version, affected versions, components, priority and due date. Add, remove or replace list values; advanced custom fields accept a Jira field ID and JSON value. Buttons without a status change work independently of workflow transitions. Existing status + assignee actions remain compatible.
- **Attachments** — view images/videos in lightbox, download files
- **Clickable Epic Link** — opens epic in Jira

### Version Bump

Flexible configuration for automatic version bumping:

- Supports `package.json`, `pyproject.toml`, `version.txt`, or any custom file
- Configurable JSON path (e.g., `version`, `tool.poetry.version`)
- Strategies: patch, minor, major
- Custom commit message template

## Installation

### From Chrome Web Store

1. Install from [Chrome Web Store](https://chromewebstore.google.com/detail/gitlab-mr-actions/lbploihmpffiihpgeojdlpcclegbdeak) (link coming soon)
2. Open any GitLab merge request page
3. Action buttons appear automatically

### Manual (Developer Mode)

1. Clone this repo:
   ```bash
   git clone https://github.com/termyanen/gitlab-actions.git
   ```
2. Open `chrome://extensions/` in Chrome
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the cloned folder
5. Open any GitLab merge request page

## Configuration

Click the extension icon to open settings:

- **Buttons** — toggle and reorder action buttons
- **Version Bump** — file path, JSON field, strategy, commit template
- **Custom Jobs** — add CI jobs to trigger manually
- **MR List** — toggle list page enhancements
- **Jira** — set Jira URL, ticket regex, quick actions
- **Project Profiles** — per-project overrides for action buttons, jobs and version settings
- **AI review** — show/hide copy controls and customize all five prompts and file filters, with independent resets

## How It Works

- **No tokens needed** — uses your existing GitLab session cookies for API calls
- **Jira auth** — reads Jira session cookies via `chrome.cookies` API (grant permission once in settings)
- **Privacy** — no telemetry or automatic AI uploads; API requests go to your GitLab/Jira. Optional Chrome Sync stores preferences; AI sharing happens only when you paste the copied context. See the [privacy policy](PRIVACY_POLICY.md).
- **Manifest V3** — modern Chrome extension architecture with service worker

## Supported Languages

English, Русский, 中文, 日本語, Deutsch, Français, Español

## Compatibility

- Chrome / Chromium-based browsers (Edge, Brave, Arc, etc.)
- Any self-hosted GitLab instance
- Any Jira Server / Data Center instance (Cloud support varies)

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Test on a GitLab MR page
5. Submit a pull request

## Testing

Run `npm test` with Node.js 18.18+; no dependency installation is required. The
regression suite covers version bumps, MR actions, CI job chains, API relay, Jira
handlers, cherry-pick flows and diff helpers, locales, and release packaging. Tests run in
CI and before Chrome Web Store uploads. See [test coverage and browser checks](tests/README.md)
for details and the remaining end-to-end coverage gaps.

## Preparing a release

`manifest.json` is the source of truth for the extension version. For each patch
release:

1. Increment the patch component in `manifest.json`.
2. Add or promote the release section in both `CHANGELOG.md` and `CHANGELOG_RU.md`;
   describe fixes and relevant technical changes, keeping older entries unchanged.
3. Update `softwareVersion` in `docs/index.html` to match. The website loads release
   notes from the changelogs; the extension's update notice reads the manifest.
4. Run `npm test` and the applicable [browser checks](tests/README.md). CI checks
   version consistency, update behavior, and both ZIP packaging paths.
5. Package with `bash pack.sh` when needed; the archive name comes from the manifest.
   If creating a GitHub release, use the same version in its tag and release notes.

The private `package.json` exists only to run tests and has no separate release
version. Both packaging paths exclude it and the test/development files.

## License

MIT
