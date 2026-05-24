# Changelog

## 1.7.4

### New features
- **Jira ticket titles in daily activity report** — when Jira integration is configured, the daily activity report automatically enriches MR entries with Jira ticket titles extracted from MR names. Toggle in settings under the daily activity report option.

---

## 1.7.3

### New features
- **Branch names on MR list** — displays source and target branch names on each MR in the list, so you can see at a glance where the code is coming from and where it merges into.

---

## 1.7.2

### New features
- **My approval indicator** — shows whether you have approved each MR on the list page. Green person+check icon when you approved, grey icon when approved by others only. Restores the distinction that GitLab removed in recent updates.

---

## 1.7.1

### Bug fixes
- **GitLab 17.11 compatibility** — fixed broken selectors after GitLab migrated MR list and commits pages to Vue components. Cherry-pick buttons, size badges, conflict indicators, "Only mine" / "Needs my review" toggles, and Jira badges now work on GitLab 17.11+.
- **Cross-version support** — all GitLab DOM selectors are now centralized (`SEL` object) with multiple fallbacks: `data-testid` attributes (stable GitLab API) as primary, legacy CSS classes as secondary. Supports GitLab 16.x through 17.11+.
- **Robust cherry-pick detection** — commit SHA groups are now found via two strategies: CSS selectors first, then fallback to clipboard buttons with SHA hex pattern. Works even if GitLab changes all class names.
- **Vue rendering timing** — added retry/polling for cases where Vue hasn't rendered the MR list or filter bar when the extension runs. List observer falls back to watching `document.body` until the list container appears.
- **Badge insertion fix** — fixed `insertBefore` crash when title link is nested deeper inside the title container (new GitLab DOM structure).

---

## 1.7.0

### New features
- **Cherry-pick to multiple branches** — cherry-pick any commit to multiple branches at once from the commits page. Button next to each commit SHA. Modal with branch selection, real-time status per branch (success/conflict). Option to create a merge request for each cherry-pick (like native GitLab). Save default target branches in settings.
- **Smart cherry-pick fallback** — when cherry-pick fails due to version file conflicts, automatically replays the commit via Commits API excluding the version file, preserving original author. Optional version bump in the target branch after cherry-pick. Both features configurable per-operation and in settings.
- **File search in command palette** — type a filename in Cmd+K palette to search project files and open them in the repository.

---

## 1.6.0

### New features
- **Command palette (Cmd+K)** — press Cmd+K (Mac) or Ctrl+K (Win) on any GitLab page to open a command palette with navigation, MR actions, and extension commands. Contextual: shows MR actions on MR detail pages, navigation commands on all pages.
- **Daily activity report** — generate a summary of your GitLab activity for the day (MRs created, merged, commented, approved, in progress). Copy and paste into Slack or Jira. Available via command palette or extension settings.

---

## 1.5.0

### New features
- **Failed job quick view** — when a pipeline fails, shows failed job names and last lines of the error log directly on the MR page. Collapsible per job, first job expanded by default. Up to 5 jobs with trace preview.
- **Conflicts indicator** — red CONFLICTS badge on MR detail page and MR list when the branch has merge conflicts. List badge is togglable in settings.
- **Unresolved threads count** — red badge on MR list showing the number of unresolved discussion threads per MR. Fetches via API with 5 min cache.
- **MR size labels** — color-coded S/M/L/XL badges on MR list based on changed lines count (S: 1-50, M: 51-200, L: 201-500, XL: 500+). Falls back to file count on older GitLab versions.
- **Quick comments** — configurable template comment buttons on MR detail page. Instantly posts a general comment to the MR with one click. Configure in popup settings.
- **Collapse top bars** — button to collapse/expand GitLab top navigation bars. State persisted per session.
- **Hide right sidebar** — toggle in settings to hide the right sidebar on MR pages for full-width content.
- **Version from target branch** — option to read the current version from the target branch (e.g. main) instead of the source branch. Prevents stale versions when using merge commit strategy.
- **Smart rebase button visibility** — rebase and rebase+version buttons are now hidden when the project merge method does not require rebase (merge commit strategy).

### Improvements
- **Jira multi-ticket separation** — visual separators between Jira ticket badge groups when MR title contains multiple tickets.
- **Parallel API fetching** — MR metadata (size, threads, conflicts) fetched in batches of 5 instead of sequentially.

---

## 1.4.0

### New features
- **Jira ticket sidebar** — click any Jira badge to open a sidebar with full ticket details: summary, status, resolution, type, priority, assignee, reporter, labels, epic, components, versions, fix versions, dates, and description. Renders Jira wiki markup — images, videos, links. Close with × or Escape.
- **Attachments in sidebar** — view images, videos, and files attached to Jira tickets directly in the sidebar. Images and videos open in a fullscreen lightbox, other files open in a new tab.
- **Jira badges on MR detail page** — Jira ticket status badges are shown in the MR title on the detail page. Click to open the sidebar with full ticket details.
- **Custom Jira ticket regex** — configurable regular expression for parsing ticket IDs from MR titles. Useful when your project uses non-standard ticket prefixes.
- **Change Jira status from sidebar** — transition buttons below the current status show only available workflow transitions. Change ticket status without leaving GitLab.
- **Change Jira assignee from sidebar** — click the assignee name to search and reassign. Autocomplete with avatars, searches only users assignable to the ticket. Unassign button to remove assignee.
- **Jira quick actions** — configure composite actions in settings: change status + assign user in one click. Buttons appear in the sidebar only when the target transition is available from the current status.
- **Issue type & priority icons** — show native Jira icons for issue type and priority next to status badges on MR list and detail pages. Enable in Jira settings.
- **Sprint field in sidebar** — displays the current sprint name in the Jira ticket sidebar.
- **Clickable Epic Link** — Epic Link in sidebar opens the epic in Jira in a new tab.

---

## 1.3.0

### New features
- **Jira integration** — shows Jira ticket statuses as colored badges on the MR list page. Parses ticket IDs (e.g. `CCS-1111`) from MR titles and fetches status via Jira REST API using session cookies. Color-coded: green (Done), blue (In Progress), purple (QA), yellow (In Review), gray (To Do). Skeleton loaders while fetching.
- **Copy MR from list** — copy button in the controls bar of each MR on the list page. Copies title + link to clipboard with one click. Always visible, icon turns green on success.
- **"Needs my review" toggle** — filter button on MR list page to show only MRs where you are assigned as a reviewer. Works via GitLab's `reviewer_username` parameter.
- **"Your review" badge** — scans first 10 comments of each MR for "Reviewer(s): @you" pattern and shows an orange badge. For teams that assign reviewers via comments instead of GitLab's built-in feature. Results cached for 5 min.

### Technical
- Uses `chrome.cookies` API for Jira auth (same session cookie approach as GitLab)
- Status caching (5 min TTL) to minimize API calls
- Sequential ticket fetching to avoid overloading Jira
- Added `cookies` permission and `optional_host_permissions` to manifest

---

## 1.2.10

### New features
- **Rebase** button — rebase branch without merging
- **Rebase + Version** button — rebase and bump version without merging
- **Copy MR** button — copy MR title and link to clipboard with one click
- **Dim Draft MRs** — visually dim Draft MRs on the merge requests list page
- **Highlight your MRs** — highlight your own MRs on the list page with a blue border
- **Skip confirmations** setting — disable all confirmation dialogs for one-click workflow
- **"Only mine"** toggle on MR list page — hide all MRs except yours


### Improvements
- New "MR list enhancements" settings section for list page UX features
- Current username detection via GitLab API with local caching
