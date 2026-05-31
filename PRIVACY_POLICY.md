# Privacy Policy — GitLab MR Actions

**Last updated:** May 31, 2026

## Overview

GitLab MR Actions is a browser extension that adds one-click action buttons and UX enhancements to GitLab merge request pages, with optional Jira integration. This policy describes how the extension handles your data.

## Data Collection

**This extension does not collect, store, or transmit any personal data to third parties.**

No analytics, telemetry, tracking, advertising, or third-party scripts are included.

## What Data the Extension Accesses

### GitLab Session Cookies

The extension communicates exclusively with your GitLab instance (the one you are currently browsing). It uses your existing browser session cookies to authenticate API requests — the same cookies your browser already sends when you use GitLab normally. No API tokens are required or stored. No credentials are read, stored, or transmitted externally.

API calls are made to perform actions you explicitly trigger (rebase, merge, version bump, etc.) and to read MR metadata displayed in the UI.

### Jira Session Cookies (Optional)

If you configure a Jira URL in settings, the extension reads your Jira session cookies via the `chrome.cookies` API to fetch ticket statuses and details. This data is:
- Fetched directly from your Jira instance
- Cached locally in memory for up to 5 minutes to reduce API calls
- Never sent anywhere else

You must explicitly grant host permission for your Jira domain before this feature activates.

### Extension Settings

The extension uses `chrome.storage.sync` to save your settings (button toggles, version bump config, Jira URL, etc.). This data may be synced across your Chrome browsers via your Google account if you have Chrome Sync enabled. The extension developer does not operate any servers and has no access to your stored data.

## What Data the Extension Does NOT Access

- No browsing history
- No personally identifiable information
- No analytics or telemetry
- No tracking pixels or third-party scripts
- No advertising

## Third-Party Services

The extension communicates only with:
- **Your GitLab instance** — the self-hosted or cloud GitLab server you are logged into
- **Your Jira instance** (optional) — only if you configure Jira integration

No data is sent to any other third-party services, analytics platforms, or external servers.

## Permissions Explained

| Permission | Purpose |
|-----------|---------|
| `storage` | Save your extension settings |
| `notifications` | Show desktop notifications when background jobs complete |
| `tabs` | Communicate between content scripts and the background service worker |
| `cookies` | Read session cookies for GitLab/Jira API authentication |
| `optional_host_permissions` | Requested on-demand when you configure Jira, so the extension can access your Jira domain |

## Children's Privacy

This extension is a developer productivity tool and is not directed at children under 13.

## Changes to This Policy

If this policy is updated, the changes will be posted on this page with an updated date. Since the extension collects no data, significant changes are unlikely.

## Open Source

This extension is open source. You can review the full source code to verify these claims.

## Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/termyanen/gitlab-actions/issues).
