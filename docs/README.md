# GitHub Pages documentation

The checked-in HTML is ready for the repository's existing GitHub Pages deployment from `docs/`. No browser-side Markdown renderer, AI service, external font or remote script is required.

- `index.html`: English/Russian landing page and primary AI review feature.
- `review-guide.html`: English/Russian guide, generated from `AI_REVIEW_GUIDE_EN.md` and `AI_REVIEW_GUIDE_RU.md`.
- `privacy.html`: generated from `../PRIVACY_POLICY.md` and `PRIVACY_POLICY_RU.md`.
- `guide.css` and `guide.js`: local presentation, navigation and language switching.
- `CHANGELOG.md` and `CHANGELOG_RU.md`: generated local copies for the landing page.

Set up the pinned generator once (activate this environment when building docs):

```sh
python3 -m venv .venv-docs
. .venv-docs/bin/activate
python -m pip install --require-hashes -r docs/requirements.txt
```

After editing the source guides, privacy policies, release notes or manifest version, run:

```sh
npm run docs:build
npm run release:check
npm run check
```

The generation step uses the pinned Python `mistune` package (with table support).
It updates version footers and local changelog copies; the landing page's
`SoftwareApplication.softwareVersion` still needs the source update described in
[DELIVERY.md](DELIVERY.md). Generated HTML and local changelogs are checked in;
GitHub Pages itself needs no custom build or dependency installation. All of
`docs/` is excluded from the Chrome extension archive. Preview both languages
when changing visible content. The release check validates metadata, not visual
layout or the accuracy of prose.

Landing-page copy has three surfaces: the static English markup and `LANG.en` /
`LANG.ru` in `index.html`. Keep all three aligned. Welcome-page copy uses all supported
`_locales/*/messages.json` dictionaries plus the English fallback in `../welcome.html`.
Check descriptions against runtime behavior and installation defaults; do not infer
background execution, unlimited data, or universal server support from a feature name.
Published changelog entries and dated audit reports are history, not current usage instructions.

CI builds these outputs with the same hashed requirements and rejects a diff in
the two HTML pages or changelog copies. Dependabot checks generator updates.
