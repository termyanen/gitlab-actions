# UI integration with GitLab

These rules apply to contributors and coding agents adding UI to GitLab pages.
New controls must follow GitLab's existing UI patterns wherever they fit the
operation. Reuse the integration already present before adding markup, CSS or a
dependency. Keep module ownership and public imports from [ARCHITECTURE.md](ARCHITECTURE.md).

## What exists today

Compatibility is spread across DOM selectors, widget markup and scoped CSS.
There is no universal button factory or bundled GitLab component library.

| Need | Existing integration to inspect |
| --- | --- |
| Modern/legacy host selectors | [`SEL` in Shared GitLab configuration](../src/shared/config/gitlab/index.ts); retain its fallback selectors when adding a new shape. Some widget-specific host lookups still live locally. |
| Safe DOM lookup and insertion | [`q`, `qAll`, `qUp`, `insertAfterSafe`](../src/shared/lib/dom/index.ts); these handle absent/nested host elements, not visual styling. |
| DOM element creation | [`element`](../src/shared/ui/dom/index.ts); a typed DOM helper, not a GitLab component adapter. |
| Native button markup | [MR-list filters](../src/widgets/mr-list/ui/list.ts), [commit cherry-pick controls](../src/widgets/commit-actions/ui/cherry-pick.ts), [cherry-pick dialog](../src/widgets/cherry-pick-dialog/ui/dialog.ts) use combinations of `gl-button`, `btn`, size and variant classes. Verify the relevant host markup before reusing a combination. |
| Native badges and existing actions | [Approval indicators](../src/widgets/mr-list/ui/metadata-badges.ts) enhance an existing badge or create a fallback; [pipeline actions](../src/widgets/pipeline-actions/ui/pipeline.ts) avoid duplicating a native stage action. |
| Theme values and layout fallbacks | Root [`content.css`](../content.css), scoped with `:where(html.gl-actions-host)` plus extension-owned roots/classes. It uses `--gl-*` theme values, fallback values and some dark-mode selectors. |
| Dialog keyboard behavior and disposal | [`createDialogKeydown`](../src/shared/ui/dialog/index.ts), [`createLifecycle`](../src/shared/lib/lifecycle/index.ts) and the owning widget's open/close contract. The caller still owns focus restoration and listener cleanup. |

The MR toolbar, review dialogs, tracker and some other controls still have custom
styles. Review export/import share `.gl-review-*` CSS, but their button factories
are private to their widgets. These are existing implementations, not proof that
every control uses native GitLab styling or works in every theme/version. Do not
copy their custom appearance into a new feature without a concrete reason.

The MR toolbar uses GitLab’s default medium button size, matching the surrounding
Merge control. Do not add `btn-sm` alongside a medium CSS fallback: GitLab’s
higher-specificity small-button rule wins and shrinks the click target. Its scoped
fallback preserves a 32px target when host button styles are unavailable.

## Choose the control before writing CSS

1. Inspect the affected GitLab surface and the owning widget. If GitLab already
   provides the operation, reuse or enhance it where appropriate instead of adding
   a duplicate. Preserve native behavior and restore modified host state on cleanup.
2. For a new operation, use the relevant native button, link, badge or form-control
   markup/classes already verified in that context. Match its size, hierarchy and
   states. Use a button for an action and a link for navigation; styling alone does
   not supply keyboard behavior, tooltips or a working dropdown.
3. Extend the existing widget or reusable primitive. Never import another widget's
   private helper to share a style. If several owners need the same independent
   control, extract a small typed primitive into `shared/ui/<control>/index.ts`
   with callers and checks in the same change; do not build an unused UI framework.
4. Add custom CSS only for extension-specific layout/content, a missing control or
   a demonstrated compatibility gap. Explain why the existing pattern is inadequate
   beside a non-obvious fallback and in the PR. Keep an existing custom surface
   consistent while changing it; a full visual migration is separate, verified work.

The extension uses plain DOM in content scripts. GitLab's Vue components and
private application instances are not an integration API. Do not import Vue or
`@gitlab/ui`, copy a complete GitLab stylesheet, fetch remote CSS/JS, or reach into
GitLab's component internals just to obtain a button. A new runtime dependency
requires its own justification and bundle/performance evidence.

## Styles, themes and compatibility

- Prefer existing component styles and semantic `--gl-*` tokens over fixed colors.
  Use foreground/background/border values for their intended role. Reuse an
  existing local token family, such as `--gl-review-*`, within its owning surface.
  Do not replace the host's theme tokens globally.
- Preserve fallback values for hosts without a token. Where a gap requires local
  values, check readable foreground/background pairs in both light and dark modes;
  a light fallback alone is insufficient evidence. Do not guess a GitLab version
  from a color or assume one dark-mode selector covers every installation.
- Keep new content CSS in `content.css`, scoped to an extension-owned component
  under `:where(html.gl-actions-host)`. The host marker alone does not isolate a
  broad `button`, `.btn`, `.gl-button` or `input` rule from GitLab controls. Every
  branch of a selector list needs the relevant scope. Avoid global resets and
  `!important` unless a documented, narrow host conflict requires it.
- Keep static visual declarations in CSS instead of adding per-feature `cssText`
  blocks or generated stylesheets. Inline values are appropriate for genuinely
  dynamic measurements/state that cannot be expressed by classes or attributes.
- Prefer existing selector/capability fallbacks over server-version branching.
  Use `data-testid` with the existing legacy alternatives where available. Missing
  host elements must not break the page, and SPA rerenders must not duplicate UI.
- Preserve focus visibility, accessible names, disabled/loading behavior and
  keyboard activation. Give icon-only controls localized accessible labels; use
  the existing dialog lifecycle for Escape, focus containment and cleanup. Colors
  must not be the only indication of an action's result or status.
- Reuse existing spacing, font and control-size patterns. Do not introduce a new
  palette, shadow/radius scale or animation for each feature. Avoid per-render
  theme polling and repeated computed-style reads; use CSS inheritance/tokens.

Settings, welcome and website pages are separate documents with their own styles;
they cannot inherit GitLab's stylesheet. Extend their existing local components
instead. This policy does not require loading GitLab assets into those pages.

## Verify an injected UI change

Run the checks selected by [CONTRIBUTING.md](../CONTRIBUTING.md): `npm run check`
and `npm run test:browser` for runtime UI changes; also `npm run test:performance`
when rendering, observers, lifecycle or caches change. Add focused behavioral
regressions for a changed fallback or a bug, rather than asserting class spelling.

For the affected controls, verify and record:

- Light and dark appearance, including fallback values when relevant tokens/styles
  are absent; readable labels/icons and hover, focus, disabled/loading states.
- The modern and legacy DOM shapes affected by the change; missing host elements,
  an already-present native action, and SPA rerender/remount without duplication.
- Keyboard operation, accessible names, dialog close/focus restoration where
  applicable, and layout with narrow viewports and longer localized labels.
- That unrelated native GitLab controls keep their styles and behavior.

The PR must name the reused pattern/helper, justify added CSS/fallbacks, include
screenshots for visual changes, and distinguish fixture checks from actual GitLab
versions/themes tested. List untested combinations. Existing API compatibility
tests do not load historical GitLab stylesheets; passing them does not establish
visual compatibility. There is no automatic gate proving that every custom style
is necessary, nor a complete version/theme visual matrix: this remains a review
requirement backed by targeted checks.

## Upstream references

GitLab's [Pajamas button guidance](https://design.gitlab.com/components/button/)
describes control semantics and states. Its [design-token usage guide](https://design.gitlab.com/product-foundations/design-tokens-using/)
and [token documentation](https://docs.gitlab.com/development/fe_guide/design_tokens/)
explain semantic theme values. Use them as design references; the current upstream
component API and token names do not guarantee availability on an older host.
