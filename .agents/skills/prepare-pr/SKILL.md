---
name: prepare-pr
description: Prepare a reviewable PR for GitLab MR Actions, including its title/body, documentation impact, release intent and validation evidence. Use when asked to prepare or update a PR; creating or pushing it still depends on the user's authorization.
---

# Prepare a PR

Read the repository's [AGENTS.md](../../../AGENTS.md), the PR and documentation
sections of [docs/DELIVERY.md](../../../docs/DELIVERY.md), and the
[PR template](../../../.github/pull_request_template.md).

Establish the requested base and inspect both the complete branch diff and local
changes. Use the available local base when offline; disclose it. Do not describe
only the latest commit or copy a stale description from an earlier task scope.

Apply the delivery document's impact matrix to the actual behavior change. Update
affected sources and generated website outputs. Record user-visible pending changes
in both EN/RU Unreleased sections; a normal PR does not imply a release/version bump.
Do not create unrelated feature cards, screenshots or privacy changes.

Run the checks selected by [CONTRIBUTING.md](../../../CONTRIBUTING.md) and
`npm run release:check`. Write the final title/body using the checked-in template:
problem and outcome, evidence, compatibility, updated docs or concrete reasons they
are unaffected, and release intent. List failures and unrun checks accurately.

Return a concrete local draft at `.reports/pr.md` unless the user chose another
path. Create the directory when needed. Create/update the remote PR only when that
action is authorized; never infer permission to push, merge or publish from a
request to prepare its text. Respect authorization already present in the task.
