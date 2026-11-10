# Jira compatibility and recovery

The integration targets **Jira Server / Data Center REST API v2**. It uses the Jira
session already signed in through the same browser profile. It does not ask for
passwords, create a Jira login session, or request API tokens. Configure the HTTPS
base URL, including an installation context path such as
`https://jira.company.com/jira`. Do not include credentials, query parameters or a
fragment. In extension settings, click **Allow Jira site access** beside the URL
to grant access to that origin. Saving the URL alone does not request permission;
the button can also restore revoked access without changing the saved URL.
Applying an imported settings file remains a separate explicit permission action.

Jira is optional. An empty Jira URL does not trigger Jira requests or connection
warnings. If a configured instance stops working, unrelated GitLab features should
remain usable. Removing configuration disables the integration; browser site access
is managed separately in Chrome.

## Server / Data Center differences

There is no universal supported-version claim or live certification matrix. The
extension uses API response validation and capability fallbacks rather than assuming
that a Jira version number guarantees every feature. Workflows, installed apps,
SSO, issue-security rules and account permissions can change the available data and
operations even between installations of the same release.

| Contract | Current handling and limits |
| --- | --- |
| Browser session | Requests use browser-managed credentials. An expired session can require signing in again. The extension does not implement the login or two-step verification flow. |
| Context path | The configured base path is retained before `/rest/api/2`; site permission applies to the origin. Do not append an issue URL or REST endpoint to the configured base URL. |
| User identities | Server/Data Center assignment uses the returned username (`name`), which may differ from a generated user `key`. User-search records without a usable username cannot safely be sent as an assignee. |
| Issue fields | Unset optional/nullable fields are tolerated. Description/comments follow REST v2 string/wiki-text contracts. Field IDs, allowed values and edit permissions remain instance-specific. |
| Transitions and quick actions | A missing/denied transition list must not disable field-only quick actions. Each operation still needs Jira's own permissions. A multi-step action can finish its transition while a later edit fails; the UI must retain that partial outcome. |
| Network and API shape | Timeouts, HTML login responses, malformed JSON and unsupported field shapes are errors, not successful empty responses. Proxies or authentication plugins may introduce variants requiring an additional tested adapter. |

On **Chromium 158.0.8127.18**, global third-party-cookie blocking did not prevent
this extension's worker from sending `SameSite=None/Lax/Strict` session cookies with
Jira host access. The [cross-site regression](../tests/browser/jira-cross-site.spec.cjs)
uses separate GitLab/Jira HTTPS sites on loopback and production badge/sidebar
controls for reads and five writes. An ordinary page fetch loses its cookies when
blocking is enabled, confirming that the test actually exercises the restriction.

Chrome's [cookie overview](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies#partitioning_and_samesite_behavior)
describes host-access and same-site behavior; Chromium's tests distinguish the
[extension exemption from global third-party blocking](https://chromium.googlesource.com/chromium/src/+/HEAD/components/content_settings/core/browser/cookie_settings_unittest.cc#1362)
from [explicit site cookie blocks that still apply](https://chromium.googlesource.com/chromium/src/+/HEAD/components/content_settings/core/browser/cookie_settings_unittest.cc#1333).
The local result does not certify other Chrome versions, explicit site cookie bans,
enterprise policies, partitioned sessions or SSO deployments. Verify the actual
browser/server configuration when login alone does not recover access; see
[coverage and fixture limits](../tests/README.md).

Atlassian documents `401` for expired session cookies. Its Jira 10.2+ two-step
verification notes concern creating a login session; this extension instead relies
on a session established by the user in Jira. Successful login still does not grant
access to every issue or edit. See Atlassian's
[Data Center cookie authentication guide](https://developer.atlassian.com/server/jira/platform/cookie-based-authentication/).

Jira Cloud is **not fully supported** by this Server/Data Center integration. Cloud
uses different user identifiers and query/write contracts (`accountId` rather than
legacy username/key); those values must not be guessed or sent as Server usernames.
Cloud also deprecated cookie-based authentication for integrations. A shared
`/rest/api/2` path is not proof of compatibility, and rich-text ADF responses need
their own adapter. See Atlassian's
[user-identity migration](https://developer.atlassian.com/cloud/jira/platform/deprecation-notice-user-privacy-api-migration-guide/),
[Cloud authentication notice](https://developer.atlassian.com/cloud/jira/platform/deprecation-notice-basic-auth-and-cookie-based-auth/)
and [REST version differences](https://developer.atlassian.com/cloud/jira/platform/rest/v2/intro/#version).

## What an error means

| Situation | Recovery |
| --- | --- |
| Sign-in required / expired session / recognized login response | Open the configured Jira site, complete login/SSO, then retry loading. |
| `403` / denied operation | Check the signed-in account, issue visibility and operation permissions in Jira. Repeated login is not a universal fix for `403`. |
| Missing or revoked extension site access | Check the configured Jira URL, click **Allow Jira site access** in extension settings, then retry loading. The same button works for an unchanged saved URL; site-access restrictions can also be managed in Chrome. |
| Offline, VPN, connection error or read timeout | Restore connectivity and check the URL, then retry loading. |
| Rate limiting or temporary server failure | Wait before retrying loading. Avoid repeated background requests while the service is unavailable. |
| `404` | Check the issue key and its visibility. A missing/inaccessible issue does not prove that the whole Jira session is invalid. |
| Unsupported response | Check the base URL and Server/Data Center API compatibility; capture a sanitized response shape for a bug report, never cookies or credentials. |

**Retry loading only reads data.** If a comment, assignment, transition or other
write reports a network failure, its result may be uncertain. Inspect the issue in
Jira before repeating the action. The extension must not automatically replay an
uncertain write or repeat the successful part of a partial quick action.

## Verify your deployment

Automated fixtures cover request/response contracts and failure behavior; they do
not replace testing on the actual server. Record the Jira product/version, browser,
base-path setup, authentication method and account permissions used for a live check.
Use a disposable issue with permission to modify it.

| Scenario | Expected check |
| --- | --- |
| Existing configuration and valid session | MR/commit badges, issue panel, comments, user search and applicable quick actions continue working after extension update. |
| Signed out after previously successful use | Show a sign-in explanation and recovery action; after login, a read retry recovers without reloading the entire extension. |
| Issue readable but an edit or transition forbidden | Explain denied access, keep unrelated reads/field-only actions available and preserve any partial success. |
| Site permission denied, later granted, then revoked | Saving a URL does not prompt. The access button grants or restores only the configured origin, including for an unchanged URL. A denied request leaves other features usable, and a later deliberate grant allows a read retry without a prompt loop. |
| Offline/VPN failure, timeout, `429` or `5xx` | Stop repeated failure requests, show useful feedback, and recover on a read retry. |
| Context path, SSO redirect or HTML login page | Retain the configured base path; avoid rendering HTML as API data or treating it as success. |
| Nullable/missing fields, renamed user, custom fields and plugins | Preserve supported variants; fail visibly for unsupported writes instead of substituting an unsafe identifier. |
| Close panel, change ticket, navigate GitLab while a request is pending | Ignore stale view callbacks, clean up UI, and retain the actual result of any already-started mutation. |
| Jira URL cleared or never configured | No Jira requests or Jira connection warnings. |

See [regression coverage](../tests/README.md) and the
[permission inventory](PERMISSIONS.md) for implementation evidence and remaining
manual scenarios. Report untested combinations rather than treating a fixture pass
as support for all Jira versions.
