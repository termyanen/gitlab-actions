# Preparing a PR and a release

This is the shared delivery procedure for contributors and coding agents. Use
[CONTRIBUTING.md](../CONTRIBUTING.md) for setup and the validation matrix. Preparing
local files does not publish anything. Follow the user's existing authorization
for commits, pushes, PR creation and publication; do not request it again if given.

## Prepare a PR

1. Establish the target branch (normally `main`) and inspect the complete change:
   `git status --short`, `git diff --stat main...HEAD`, and `git diff main...HEAD`.
   Also inspect unstaged/staged changes: the committed diff does not include them.
   Use the requested base when supplied; do not fetch or modify remotes just to
   write the description. State when only a local base was available.
2. Describe the concrete problem and resulting behavior, including changed
   defaults and compatibility limits. Cover the final combined diff, rather than
   listing the conversation or every intermediate commit. Put implementation
   details in the PR only when they help a reviewer judge the change.
3. Apply the documentation matrix below. For each applicable surface, update it
   and name the file in the PR. Otherwise give a short reason it is unaffected.
   A tooling-only change does not need a user-facing feature card or version bump.
4. Add EN/RU `## Unreleased` entries for user-visible changes that will ship later.
   Keep published releases unchanged. If a release is explicitly being prepared,
   put the changes under its selected version instead. Do not bump once per PR
   or once per invocation of an agent.
5. Run the relevant checks, including `npm run release:check`. Use the
   [PR template](../.github/pull_request_template.md), record actual commands and
   results, and disclose omitted checks. A screenshot is evidence for UI changes;
   fixture tests are not a claim about every live GitLab/Jira deployment.
   For injected UI, follow [GITLAB_UI.md](GITLAB_UI.md): name the reused GitLab
   pattern, justify custom CSS and record the themes/DOM variants actually checked.
6. Produce a title and body, defaulting to `.reports/pr.md` for a local draft
   (create `.reports/` if needed). If PR creation is authorized, use the configured
   provider/CLI and this exact body; with `gh`, prefer `--body-file` to shell text.
   Return its link only after actual creation. Do not push to make a draft possible
   when the user has prohibited pushing.

## Documentation impact matrix

| Change | Source to update | Generated or secondary surfaces |
| --- | --- | --- |
| User-visible feature, fix, changed default or behavior | `CHANGELOG.md` and `CHANGELOG_RU.md` with matching scope | `docs/CHANGELOG*.md` via `npm run docs:build` |
| New capability or changed usage/settings | Relevant `README.md` feature/settings section | `docs/index.html`: markup plus both `LANG.en` and `LANG.ru`; update claims/screenshots when affected |
| New discoverable extension feature | `welcome.html`, if the feature belongs in onboarding | User-facing keys in all seven `_locales/*/messages.json` files |
| AI review/export/import workflow or format | `README.md` and both `docs/AI_REVIEW_GUIDE_EN.md` / `docs/AI_REVIEW_GUIDE_RU.md` | `docs/review-guide.html` via generator; update related site examples |
| Data use, storage, permissions or external integration | `PRIVACY_POLICY.md`, `docs/PRIVACY_POLICY_RU.md`, relevant README claims | `docs/privacy.html` via generator; store privacy disclosures need a separate authorized dashboard update |
| Toolchain, architecture, development or agent workflow | `CONTRIBUTING.md`, `AGENTS.md`, this procedure and relevant skill as applicable | `tests/README.md`, `docs/README.md` when commands/coverage change |
| Release version | `manifest.json`, both root changelogs, `docs/index.html` metadata | Both generated page footers, site changelog copies, built extension and ZIP; see below |

The root README is English; the landing page and release notes are EN/RU. Extension
locales are `en`, `ru`, `de`, `fr`, `es`, `ja`, `zh_CN`. Translate new keys in all
seven; do not add marketing cards for internal changes merely to tick a checkbox.

## Prepare a release locally

1. Identify the last released version/revision from available tags/history and the
   target release version. Summarize all unreleased changes since that revision,
   not only the most recent PR. If the release boundary is unknown, state it and
   resolve it before calling the notes complete. A PR can remain version-neutral.
2. Choose a version once: this repository normally uses `major.minor.patch`.
   Fixes use patch, backward-compatible features normally use minor, and breaking
   changes require an explicit compatibility/migration decision. Respect the
   requested target; if it is already present, verify it rather than incrementing
   again. Chrome requires numeric components, each at most 65535, without
   prerelease suffixes. The new version must exceed the published version.
3. Update these source files together:
   - `manifest.json`: the sole extension version source.
   - `CHANGELOG.md` and `CHANGELOG_RU.md`: promote the pending notes to matching
     `## <version>` sections at the top. Keep historical entries intact. State
     observable changes and limitations; do not invent performance/test claims.
   - `docs/index.html`: `SoftwareApplication.softwareVersion` in JSON-LD.
4. Complete the applicable documentation matrix, then run `npm run docs:build`
   using the [pinned Python environment](README.md). This regenerates
   `docs/review-guide.html`, `docs/privacy.html` (including their version footers)
   and both `docs/CHANGELOG*.md` copies. Commit generated website outputs alongside
   their sources. If guide/privacy/landing content changed, preview both languages
   at desktop and narrow widths before declaring it verified.
5. Run `npm run release:check -- --ready`, `npm run check` and
   `npm run test:browser`. Run `npm run test:performance` for rendering/lifecycle/
   cache changes. The release check is read-only; it checks versions, translated
   release histories, generated copies/footers and pending notes. It cannot validate
   the accuracy of marketing prose or determine what is already live in the store.
6. Run `bash pack.sh`; inspect `gitlab-mr-actions-v<version>.zip` with manifest at
   its root. `dist/` and ZIPs are generated locally, not committed. CI builds and
   tests its `extension.zip` artifact; the store consumes that exact artifact.
7. Create the draft notes with:

   ```sh
   mkdir -p .reports
   npm run --silent release:notes > .reports/release-notes.md
   ```

   This exports the current EN/RU release sections and refuses pending Unreleased
   notes. Review the generated text. It does not derive accurate product claims
   from commit subjects and does not publish a GitHub release.
8. Deliver the selected version, source/generated file list, notes and ZIP paths,
   checks with outcomes, and any remaining publication/configuration work. Use
   `.reports/release-summary.md` for a local handoff when helpful. Do not claim that
   the store or website has updated merely because local preparation passed.

Do **not** run `npm version`: the private `package.json` and lockfile deliberately
have no release version. Do not replace versions in historical changelog entries,
audit reports, old compatibility fixtures or examples. Do not edit built JS or
`dist/manifest.json` directly. The popup update notice reads the manifest and needs
no separate version string. The site loads notes from its generated local copies.

## Publish only within the authorized scope

The prepared commit must be the one reviewed and validated. A GitHub release tag
must match the manifest (`v` prefix is accepted). Creating a **published** GitHub
release triggers `.github/workflows/chrome-web-store.yml`: it verifies and uploads
the package to the store. It is an external delivery action, not just saving notes.
The manual workflow defaults to `upload`; `publish` also submits for review.
Store credentials and `CWS_PUBLISHER_ID` are documented in the root README.

GitHub Pages serves the checked-in `docs/` site through the repository's configured
deployment. Preparing local HTML does not deploy it. Do not change Pages settings,
create/push tags, publish GitHub releases or submit to the store without the user's
authorization for those actions. If not authorized, finish the local package and
report the remaining steps without calling the release published.

## Use from any coding agent

`AGENTS.md` is the shared instruction source. `CLAUDE.md` and `GEMINI.md` are relative
symlinks to it; Copilot's instruction file points there. Portable skills live in
`.agents/skills/prepare-pr/` and `.agents/skills/prepare-release/`, with Claude skill
symlinks in `.claude/skills/`. There are no provider-specific copies of the process.

Examples that do not depend on a slash-command implementation:

- “Read AGENTS.md and .agents/skills/prepare-pr/SKILL.md. Prepare the PR against
  main locally, including its documentation impact and validation. Do not push.”
- “Read AGENTS.md and .agents/skills/prepare-release/SKILL.md. Prepare release
  <chosen-version> locally, with EN/RU notes, website updates and ZIP. Do not publish.”

Current [Codex](https://learn.chatgpt.com/docs/build-skills),
[Cursor](https://cursor.com/docs/skills),
[Copilot](https://docs.github.com/en/copilot/concepts/customizations/agent-skills) and
[Gemini CLI](https://geminicli.com/docs/cli/skills/) support `.agents/skills`.
[Claude Code](https://code.claude.com/docs/en/skills) supports linked skill folders.
Discovery still depends on client version, workspace trust and enabled settings;
for another agent, explicitly supply the paths above. On Windows, checkout with
symlink support enabled; otherwise read `AGENTS.md` and the canonical skill paths
directly instead of maintaining copied instructions.
