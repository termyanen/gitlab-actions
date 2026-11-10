# Browser permissions and exposed resources

This inventory explains the current source manifest and the procedure for changing
access. The [privacy policy](../PRIVACY_POLICY.md#5-security-and-permissions) is the
user-facing summary. Keep both aligned with the packaged manifest and actual
runtime behavior; a table is not proof that a permission remains necessary.

Chrome Web Store requires the least access needed by implemented functionality,
including optional permissions; speculative future use is insufficient. The
developer dashboard also asks for a reason for each declared permission.
See Google's [permission policy](https://developer.chrome.com/docs/webstore/program-policies/permissions),
[minimum-permission FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq#minimum_permission)
and [privacy-field instructions](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy#list_and_justify_any_permissions).

## Current inventory

The source of truth is [manifest.json](../manifest.json). The rows below identify
current consumers; they do not authorize additional access or claim that no
narrower architecture is possible.

| Declaration | Implemented use and code evidence | Scope and grant behavior |
| --- | --- | --- |
| `permissions: storage` | Preferences/project profiles, local metadata caches, durable CI checkpoints and review duplicate-send protection. See [storage adapter](../src/shared/api/storage/index.ts), [job store](../src/features/job-chains/model/store.ts) and [delivery journal](../src/features/review-import/model/journal.ts). | Required API permission. Uses extension `sync` and `local` areas; stored data is described in the privacy policy. |
| `permissions: alarms` | Restore unfinished CI task execution after service-worker suspension. See [job store](../src/features/job-chains/model/store.ts) and [background registration](../src/app/entrypoints/background.ts). | Required API permission. The task alarm exists while unfinished tasks exist and is cleared when none remain. |
| `permissions: notifications` | Desktop completion/failure notifications for background job chains. See [job runner](../src/features/job-chains/model/runner.ts). | Currently required in the manifest; sending is controlled by `notifications_enabled`. Disabling that setting does not revoke the API permission. |
| `permissions: tabs` | Find matching GitLab tabs for the session API relay and read the active tab URL to identify the current project in settings. See [background proxy](../src/shared/api/background-proxy/index.ts), [job runner](../src/features/job-chains/model/runner.ts) and [settings](../src/pages/settings/ui/settings.tsx). | Required API permission in the current architecture. URL-filtered queries support user-started work across worker restarts and matching tabs. Opening a settings tab or calling `tabs.sendMessage` alone is not the rationale. |
| `optional_host_permissions: https://*/` | Allow a user-supplied HTTPS Jira installation rather than a fixed vendor domain. The **Allow Jira site access** button requests the displayed global or project Jira origin with `/*`. The explicit settings-import Apply action requests the distinct origins configured in the imported shared settings and profiles. Saving a URL alone does not request permission. See [site-access control](../src/pages/settings/ui/jira-connection.tsx), [settings import](../src/pages/settings/ui/settings.tsx) and [settings persistence](../src/pages/settings/model/controller.ts). | This declaration allows a later request; it is not an all-host grant at installation. The access button can restore a revoked grant without changing the saved URL. Runtime requests must stay scoped to the configured origin, and unrelated GitLab functionality must work if access is denied or revoked. |
| `content_scripts.matches: https://*/*` | Automatically discover GitLab.com and self-hosted GitLab on arbitrary HTTPS domains. [Bootstrap](../src/app/entrypoints/content_proxy.ts) checks page markers before importing the feature runtime; styles are scoped to the GitLab host marker. | Broad content-script registration at installation, with browser site-access controls. The bootstrap and stylesheet can be delivered to non-GitLab HTTPS pages; detection does not make this declaration a narrow host grant. `activeTab` alone would require invocation on each relevant page and does not preserve automatic discovery. |
| `web_accessible_resources` for `_locales/*/messages.json`, `modules/*.js`, `modules/chunks/*.js`, matched to HTTPS pages | Packaged locale data and split runtime modules loaded by content scripts. See [bootstrap](../src/app/entrypoints/content_proxy.ts), [i18n](../src/shared/i18n/index.ts) and [build](../scripts/build.mjs). | These files can be accessed by matching pages. Expose only files needed by the packaged content runtime; do not expose settings, credentials, development files or arbitrary extension resources. No remote executable code is loaded. |

The manifest has no `cookies`, unconditional `host_permissions`, `activeTab`,
`scripting`, `webRequest` or `debugger` permission. Content-script registration and optional host
grants are separate capabilities; do not describe the extension as having no site
access merely because `host_permissions` is absent.

`notifications` is an existing required declaration for a feature users can disable.
A future conversion to an optional API permission would need an explicit
enable/request flow and tests for existing installations, denial and revocation.
Do not copy that historical required/optional choice into a new feature. Likewise,
replacing broad automatic GitLab discovery requires a deliberate user-site setup
and migration design, not deleting a match pattern and leaving features broken.
The [Jira transport](../src/entities/jira-issue/api/request.ts) uses browser-managed
credentials (`credentials: include`) and checks the configured host grant. It no
longer reads the cookie store or constructs a `Cookie` header, so the unused
`cookies` permission was removed. The [session regression](../tests/browser/jira-session.spec.cjs)
checks fake HttpOnly `SameSite=None/Lax/Strict` cookies at a local HTTPS server,
without the Cookies API permission. The [cross-site regression](../tests/browser/jira-cross-site.spec.cjs)
also verifies the production GitLab UI → worker → Jira read/write path with global
third-party-cookie blocking both enabled and disabled on Chromium 158.0.8127.18.
Its temporary manifest supplies only the Jira host grant; it does not automate the
native optional-permission prompt. These fixtures do not certify real Jira/SSO,
explicit site cookie bans, enterprise policies or partitioned sessions; see
[compatibility limits](JIRA_COMPATIBILITY.md).

The [Tabs API documentation](https://developer.chrome.com/docs/extensions/reference/api/tabs#permissions)
distinguishes URL access from ordinary tab operations. The
[Cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies#permissions)
requires both the API permission and appropriate host access when directly reading
or modifying the cookie store; it is not required merely to send browser-managed
request credentials. Review those specific capabilities before using a permission
name as a generic justification.

## Procedure for a change

1. Identify the concrete user feature and consuming API/resource. Check whether
   existing access suffices; compare narrower API, host, resource and execution
   options. Do not request access for possible later work.
2. Choose the minimum scope. Prefer optional access for optional functionality.
   If required access is needed, explain why the feature cannot reasonably work
   with an optional grant or narrower alternative. For discovered hosts, declare
   the necessary optional pattern but request only the chosen origin at runtime.
3. Specify the request moment and explanation users will see. Optional permission
   requests belong to a user gesture: call `permissions.request` directly from the
   explicit action, before an `await` or debounce can lose that gesture. Autosave
   must not prompt for access. A denied or revoked grant must leave other
   features usable, show an appropriate recovery action and avoid prompt loops.
   Follow the [Permissions API guidance](https://developer.chrome.com/docs/extensions/reference/api/permissions).
4. Update the inventory and [PR template](../.github/pull_request_template.md).
   For each changed declaration provide: exact scope; implemented benefit and
   code path; alternatives considered; optional/required decision; request timing;
   denial/revocation handling; install/update warning impact; and verification.
   Prepare a plain-language store justification tied to that benefit, not a
   generic explanation of what the API can do.
5. Update user-facing usage/privacy text when behavior or data handling changes.
   Include proposed store privacy/listing changes in the release handoff. Check
   them against the final package before submission. Editing repository text does
   not update the Chrome Web Store dashboard or authorize publication.
6. Verify grant, denial, revocation and relevant existing-user upgrade paths.
   Inspect the built manifest and resources, and confirm an unrelated HTTPS page
   does not acquire feature UI or trigger API traffic. Remove a permission when
   its last consumer is removed; do not retain it just because older releases had it.

Web-accessible resources are also part of the access review even though they are
not API permissions: their exposure can reveal installed resources to web pages.
See the [manifest reference](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources).
Existing package and browser checks help validate implementation; they do not
automatically prove permission necessity or guarantee store acceptance.

Project-specific Jira URLs reuse the same optional host declaration. Each origin
is granted separately, only from the explicit access button or import Apply action.
The import request is synchronous with that gesture, deduplicates origins and does
not request wildcard access beyond each configured `origin/*`. Denial leaves the
current configuration unchanged. Revoked/missing access produces the existing
error/recovery flow without disabling unrelated GitLab features. This adds no
manifest permission, installation grant or resource exposure; store justification
remains access to user-configured Jira installations.

The explicit **Check connection** control in popup/settings reuses the existing
`fetch-jira-myself` read and host grant. It requests no additional permissions and
does not read cookies, collect credentials or persist the returned identity.
