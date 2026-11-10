## Change

Describe the problem and resulting behavior across the complete PR. Link the issue
if there is one. Mention changed defaults and meaningful user-visible examples.

## Validation

List commands actually run and their results. Note any relevant checks not run.
For UI changes, include screenshots. For lifecycle/rendering changes, include the
browser and performance results. Fixtures do not establish live-server compatibility.

For UI injected into GitLab, name the reused controls/classes/tokens and explain
any new custom styles or compatibility fallbacks. Record light/dark appearance,
keyboard behavior and affected modern/legacy DOM variants actually checked; state
what remains untested. See `docs/GITLAB_UI.md`; write "not applicable" otherwise.

## Compatibility

When module boundaries changed, name the owning slice, new public exports or
dependencies, and execution context (content script, worker, settings page).
Explain why a new slice/dependency is needed and record `npm run lint:architecture`
or `npm run check` above. See `docs/ARCHITECTURE.md`; write "unchanged" otherwise.

Mention changes to permissions, supported Chrome/GitLab versions, settings/storage
formats, runtime dependencies or package contents. Write "unchanged" if applicable.

## Permissions and exposed resources

Write "unchanged" if API permissions, host access, content-script matches and
web-accessible resources are unchanged. Otherwise, for each addition or expansion:

- Name the implemented feature, consuming code path and exact scope.
- Explain why existing access or a narrower alternative is insufficient, and why
  the grant is optional or required.
- Describe the request moment/user gesture, user-facing explanation and any
  install/update warning impact.
- Record granted, denied and revoked behavior/checks, plus upgrade coverage where
  relevant. Explain removed permissions when their last consumer is removed.
- Link the updated `docs/PERMISSIONS.md` inventory, proposed Chrome Web Store
  justification and affected privacy/usage disclosures. State dashboard work that
  remains unpublished. See `docs/PERMISSIONS.md` for the procedure.

## Documentation and release

For each applicable surface, name the updated files; otherwise explain why it is
unaffected. See `docs/DELIVERY.md` in the repository.

| Surface | Updated files or reason not applicable |
| --- | --- |
| EN/RU changelog / Unreleased notes | |
| README and site feature/usage copy (EN/RU) | |
| Welcome page and seven extension locales | |
| AI review guides / privacy policies and generated pages | |
| Contributor/agent instructions and development commands | |
| Permission inventory and proposed store justification | |
| Version and generated site metadata | |

Release intent: no release / pending changes / preparing version …
For a release PR, include the target version, release notes and package location,
the result of `npm run release:check -- --ready`, and remaining publication steps.
Do not describe local preparation as a deployed website or published extension.
