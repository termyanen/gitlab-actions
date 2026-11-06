# Security reporting

Report vulnerabilities through [GitHub Private Vulnerability Reporting](https://github.com/termyanen/gitlab-actions/security/advisories/new).
On the repository's **Security → Advisories** page, choose **Report a vulnerability**.
Do not disclose exploit details, credentials or private project data in a public
issue or pull request.

The repository owner must enable Private Vulnerability Reporting in GitHub settings;
this file alone does not enable it. If the button or form is unavailable, open an
issue asking the maintainer to enable a private reporting channel, without including
vulnerability details. The maintainer can then arrange private disclosure.

Include:

- Affected extension version or commit, browser version and relevant GitLab/Jira versions.
- The affected feature, expected security boundary and observed impact.
- Minimal reproduction steps using a test account/repository and sanitized evidence.
- Any known workaround. A patch is welcome but not required.

Do not send session cookies, API tokens, Chrome Web Store credentials, customer
source code or a full browser profile. Use only systems you own or are authorized
to test. The maintainer confirms affected versions and coordinates a fix and
advisory through the private report; no response-time or backport SLA is promised.

Ordinary bugs and feature requests belong in [Issues](https://github.com/termyanen/gitlab-actions/issues).
The extension's data handling is described in [PRIVACY_POLICY.md](PRIVACY_POLICY.md).
