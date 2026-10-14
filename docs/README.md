# GitHub Pages documentation

The checked-in HTML is ready for the repository's existing GitHub Pages deployment from `docs/`. No browser-side Markdown renderer, AI service, external font or remote script is required.

- `index.html`: English/Russian landing page and primary AI review feature.
- `review-guide.html`: English/Russian guide, generated from `AI_REVIEW_GUIDE_EN.md` and `AI_REVIEW_GUIDE_RU.md`.
- `privacy.html`: generated from `../PRIVACY_POLICY.md` and `PRIVACY_POLICY_RU.md`.
- `guide.css` and `guide.js`: local presentation, navigation and language switching.
- `CHANGELOG.md` and `CHANGELOG_RU.md`: generated local copies for the landing page.

After editing the source guides, privacy policies, release notes or manifest version, run:

```sh
python3 docs/build_pages.py
npm test
```

The generation step uses the Python `mistune` package (with table support). Generated HTML and local changelogs are checked in; GitHub Pages itself needs no custom build or dependency installation. All of `docs/` is excluded from the Chrome extension archive.
