# GitLab MR Actions

> One-click actions for GitLab merge requests: auto-merge, version bump, force merge, custom CI jobs, Jira integration. Works with any self-hosted GitLab instance. No tokens needed.

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

All buttons are configurable — show/hide, reorder via drag & drop. Per-project profiles let you override settings for specific repositories.

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
- **Quick actions** — composite actions (status + assignee) in one click
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
- **Project Profiles** — per-project overrides for all settings above

## How It Works

- **No tokens needed** — uses your existing GitLab session cookies for API calls
- **Jira auth** — reads Jira session cookies via `chrome.cookies` API (grant permission once in settings)
- **Privacy** — no data leaves your browser except to your own GitLab/Jira instances
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
