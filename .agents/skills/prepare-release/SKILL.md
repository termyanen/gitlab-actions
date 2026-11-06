---
name: prepare-release
description: Prepare a local GitLab MR Actions release with a coordinated version bump, EN/RU release notes, README/site/locale updates, validation and extension ZIP. Use for release preparation, not ordinary tooling changes. Publishing is a separate authorized action.
---

# Prepare a release

Read [AGENTS.md](../../../AGENTS.md) and the release procedure and documentation
matrix in [docs/DELIVERY.md](../../../docs/DELIVERY.md). Use
[CONTRIBUTING.md](../../../CONTRIBUTING.md) for verification and
[docs/README.md](../../../docs/README.md) for the generator environment.

Establish the intended release version and the last released revision from the
user and available repository history. Cover the whole release scope. If a target
version is already prepared, verify and complete it instead of bumping again.
Do not assume a published boundary that has not been verified.

Update manifest, both root changelogs and landing-page JSON-LD together. Promote
Unreleased notes without rewriting published history. Apply the impact matrix to
README, EN/RU website text, onboarding, seven locales, review guides and privacy.
Run the generator for checked-in website copies and version footers. Do not use
`npm version`, rewrite historical version fixtures or hand-edit `dist/`.

Run `npm run release:check -- --ready`, the required static/regression/browser
checks and applicable profiling. Package with `bash pack.sh`. Generate the notes
with `npm run --silent release:notes`, saving the result to
`.reports/release-notes.md` unless a different path was requested. The command
exports reviewed source notes; it cannot write accurate notes from commit titles.

Deliver a local handoff with target version, changed source/generated files,
notes/ZIP paths, actual validation and remaining publication work. A local build
is not a published release. Creating a published GitHub release triggers the store
upload workflow; pushing tags, deploying the website and submitting to the store
need authorization for those actions. Complete the local preparation first and
respect authorization already present in the task.
