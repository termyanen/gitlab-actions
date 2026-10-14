# Privacy Policy — GitLab MR Actions

**Last updated:** October 13, 2026

## Overview

GitLab MR Actions adds merge request actions, review tools and optional Jira integration to GitLab. The extension processes content in your browser and communicates with the GitLab instance you are using and, when configured, your Jira server. The developer operates no backend for the extension and receives no repository content, review text or credentials from it. There is no analytics, advertising or telemetry in the extension.

## 1. Data the extension accesses

- **Session information:** existing browser sessions and page CSRF tokens used to authenticate requests to your GitLab/Jira servers. The extension does not ask for passwords, personal access tokens or AI API keys.
- **GitLab content:** MR and issue metadata, authors and usernames, discussions, replies, your review drafts, commit identifiers and messages, file paths, diffs, selected repository content, pipeline/job results and logs needed by enabled features.
- **Jira content, when enabled:** issue fields, users, comments, attachments and available workflow actions from your configured server.
- **Settings and entered text:** enabled features, project profiles, URLs, quick comments, review prompts, file filters, language and AI responses you paste for import.

Access is used for the extension's visible features, not to build a browsing history or profile. The extension does not monitor the clipboard; copy actions write only the text you request. Pasted review responses are processed as data, never executed as code.

## 2. How review data is used

Copying a review fetches the relevant GitLab context and prepares editable instructions or a text preview locally. The extension does not contact an AI provider, upload code to an AI service, or run an AI model. You choose whether and where to paste the copied text. Any service you paste it into then processes it under its own terms and privacy policy.

Importing an AI response checks the MR revision, code locations and existing discussions using your GitLab server. Previewing and editing do not publish comments. Choosing **Publish selected** or **Add to review** sends the selected comment text and necessary location/discussion identifiers to that GitLab instance, as published comments or your review drafts respectively. These actions use your signed-in GitLab account and permissions.

Other enabled features read metadata and perform actions you trigger, such as merge, rebase, pipeline operations and Jira updates. Data is not used for advertising, profiling, sale or unrelated purposes. Use of information obtained through Chrome APIs adheres to the Chrome Web Store User Data Policy, including its Limited Use requirements.

Optional discussion resolution is sent to the same GitLab only when you explicitly select it for a reply and publish that reply successfully. Drafts do not resolve discussions.

## 3. Storage and retention

- **Preferences:** `chrome.storage.sync` stores settings, including custom review prompts, automatic instruction text and enabled states, and file filters, until changed or the extension is uninstalled. If Chrome Sync is enabled, Google may synchronize these preferences between your browsers. Do not put secrets or repository content into saved prompts or instructions if you do not want them in synchronized settings.
- **Local caches:** `chrome.storage.local` stores a GitLab username cache and commit-version badge results, including project/file identifiers and commit hashes. Version results are capped at 1,000 entries. These caches remain until replaced, evicted where applicable, or extension data is removed. Other loaded content and UI state use memory or browser session storage.
- **Duplicate-send protection:** review import stores a local digest identifier, delivery status, timestamp and, after confirmation, comment ID. These records prevent accidental reposting after interruptions and remain until extension data is removed. They contain no comment body, code, prompt or review transcript and are not a review history. They are not stored in Chrome Sync.
- **Review content:** fetched discussions/code and pasted import text remain in page memory while the feature is in use. The extension does not save a persistent review transcript or snapshots. Closing the page clears that page's memory. Clipboard text remains under browser/operating-system control until replaced or cleared; clipboard synchronization tools are outside the extension's control.
- **Credentials:** the extension does not persist session cookies or CSRF tokens; browser cookies remain in the browser's cookie store.

## 4. Recipients

- **Your GitLab instance:** API reads and user-triggered changes, including publishing selected review comments and drafts.
- **Your configured Jira server:** optional integration after you grant host access.
- **Google Chrome Sync:** preferences only, when enabled in your browser.
- **A destination you choose:** copying places text on the clipboard; you decide whether to paste it into an AI tool or another application. There is no automatic AI recipient.

No extension data is sent to a developer-operated server, analytics service, advertising network or data broker. Opening a documentation, GitHub or store link is ordinary browser navigation; the destination may receive normal web request information. The extension does not append MR content or credentials to those links. The public documentation site is hosted by GitHub Pages and is separate from the extension.

## 5. Security and permissions

The extension runs bundled JavaScript and does not download executable code or execute imported AI text. Review API requests stay on the current GitLab origin; redirects are rejected. Sensitive API operations use your existing session and the page's CSRF token where required.

| Permission | Purpose |
|---|---|
| `storage` | Preferences, local caches and duplicate-send protection |
| `notifications` | Completion notifications for background jobs |
| `tabs` | Communicate with GitLab tabs and locate tabs needed for user-triggered work |
| `cookies` | Existing GitLab/Jira session authentication used by integration features |
| Optional HTTPS host access | Requested for the configured Jira domain |
| Content scripts on HTTPS pages | Recognize self-hosted GitLab installations on different domains and provide GitLab features there |

AI review adds no new extension permissions. The browser controls site access; you can restrict it through the extension's site-access settings.

## 6. Your choices and deletion

You can disable AI review controls or other features, edit/reset saved prompts and filters, and remove Jira configuration or its host permission. Removing the extension deletes its local and synchronized extension storage on that browser; Chrome controls synchronization across devices. Session UI state can be cleared by closing the relevant tab or clearing site session storage.

Clearing extension data does not delete comments or drafts already saved in GitLab, data pasted into another application, or clipboard contents. Manage those in the relevant application. Clearing duplicate-send records also removes the extension's local protection against retrying submissions with an uncertain result.

## 7. Children, updates and contact

This developer tool is not directed at children under 13. Policy updates are posted with a new date. The source is available for inspection in the [GitHub repository](https://github.com/termyanen/gitlab-actions). For questions, open a [GitHub issue](https://github.com/termyanen/gitlab-actions/issues).
