# Privacy Policy — GitLab MR Actions

**Last updated:** July 13, 2026

## Overview

GitLab MR Actions ("the extension") is a browser extension that adds one-click action buttons and UX enhancements to GitLab merge request pages, with optional Jira integration. All data is processed locally in your browser. The developer does not operate any servers and never receives, collects, sells, or shares your data. Data is transferred only to the GitLab and (optionally) Jira servers that you yourself use.

## 1. What Data Is Collected

The extension accesses the following categories of data, strictly to provide its features:

- **Authentication information (session cookies)** — your existing browser session cookies for your GitLab instance and, if you enable the optional Jira integration, for your Jira domain. Cookies are read only to authenticate API requests on your behalf. Passwords, tokens, and other credentials are never read or requested.
- **Website content** — merge request titles and metadata, pipeline/job names and statuses, commit messages, and Jira issue fields (summary, status, assignee, comments, attachments) from the GitLab/Jira pages you visit and their APIs.
- **Extension settings** — your configuration: enabled buttons and their order, version bump settings, Jira URL, custom jobs, quick comments, per-project profiles, language.

The extension does **not** collect browsing history, keystrokes, or personally identifiable information beyond the above, and contains no analytics, telemetry, tracking pixels, third-party scripts, or advertising.

## 2. How Data Is Used (Processing)

- Session cookies are attached by the browser to API requests to your own GitLab/Jira servers to perform actions you explicitly trigger (rebase, merge, run jobs, post comments) and to read metadata displayed in the UI (badges, statuses, reports).
- Website content is processed locally in your browser to render UI enhancements (badges, buttons, panels, reports).
- Settings are used solely to configure the extension's behavior.

Data is never used for advertising, profiling, credit assessment, or any purpose unrelated to the extension's single purpose. Use of data obtained through Chrome APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## 3. How Data Is Stored

- **Settings** are stored in `chrome.storage.sync` on your device and are kept until you change them or uninstall the extension. If Chrome Sync is enabled, Google may sync them across your browsers under your Google account.
- **GitLab/Jira data** (statuses, issue details) is cached in memory for up to 5 minutes to reduce API load and is discarded when the page is closed. It is never written to persistent storage.
- **Cookies** are never stored by the extension — they remain in the browser's cookie store and are only attached to requests to their own origin.
- The developer operates no servers; nothing is stored outside your browser.

## 4. Who Data Is Transferred To (Recipients)

Data leaves your browser only towards the following recipients:

- **Your GitLab server** — the self-hosted or cloud GitLab instance you are logged into and browsing (API requests with your session cookies).
- **Your Jira server** (optional) — only if you configure the Jira integration and explicitly grant host permission for that domain.
- **Google Chrome Sync** (optional) — extension settings only, if you have Chrome Sync enabled in your browser.

Data is **never** transferred to the developer, analytics providers, advertising networks, data brokers, or any other third party. Data is never sold. No data is transferred for purposes unrelated to the extension's functionality.

## 5. Security

All communication with your GitLab/Jira servers uses the same origin and transport security (HTTPS) as your normal browser session. The extension adds no additional endpoints and requests no credentials.

## 6. Your Choices and Data Deletion

- Uninstalling the extension removes all its settings from `chrome.storage.sync`.
- The Jira integration is off by default and can be disabled at any time by removing the Jira URL and revoking the host permission.
- In-memory caches are cleared automatically when tabs are closed.

## 7. Permissions Explained

| Permission | Purpose |
|-----------|---------|
| `storage` | Save your extension settings |
| `notifications` | Show desktop notifications when background jobs complete |
| `tabs` | Communicate between content scripts and the background service worker |
| `cookies` | Read session cookies for GitLab/Jira API authentication |
| `optional_host_permissions` | Requested on-demand when you configure Jira, so the extension can access your Jira domain |

## 8. Children's Privacy

This extension is a developer productivity tool and is not directed at children under 13.

## 9. Changes to This Policy

If this policy is updated, the changes will be posted on this page with an updated date.

## 10. Open Source

This extension is open source. You can review the full source code to verify these claims.

## 11. Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/termyanen/gitlab-actions/issues).
