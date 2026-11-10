# Localization

The extension provides 27 interface locales. The shared catalogue in
`src/shared/i18n/index.ts` drives both settings selectors, settings-import validation
and AI response-language instructions. Chrome locale identifiers use underscores
(`pt_BR`, `zh_CN`). Automatic UI language uses Chrome's locale resolution;
Automatic AI response language follows the conversation independently.
The settings, popup and welcome pages share the selected interface language.
Welcome updates when that preference changes in an open settings tab.

Supported locales: `en`, `ru`, `de`, `es`, `fr`, `ja`, `zh_CN`, `pt_BR`, `it`, `pl`, `ko`, `tr`, `nl`, `id`, `vi`, `cs`, `sv`, `ro`, `hi`, `fi`, `da`, `hu`, `el`, `sk`, `th`, `bg`, `ms`.

## Adding or changing translations

1. Add user-facing keys to every `_locales/*/messages.json`. Preserve `$1` parameters,
   named placeholders, `{version}` and other template tokens, URLs and technical identifiers.
2. A new locale also needs a catalogue entry, a complete messages file and a
   `store-listing/<locale>.txt` with a Russian language label on its first line.
3. Update README, site language counts, both Unreleased changelog sections and
   store descriptions. Keep published release history intact. Run `npm run docs:build`.
4. Run `npm run check`, `npm run test:browser` and package checks. Exercise language
   selection, reload and settings export/import; inspect long labels in popup/full settings.
5. Review translations for meaning, not just key parity. The 20 newly added locales
   start from machine translations with protected substitutions and targeted editorial fixes.
   Store texts were translated separately with AI assistance.
   Native-speaker review remains recommended before store publication.

All locales are packaged; each page loads only its selected locale, with no remote
translation requests or new permissions/dependencies. English defaults for editable
AI prompts stay editable instructions, not translated program/schema fields.
The marketing site and long-form guides remain EN/RU. Store translations are
[separate publishing artifacts](../store-listing/README.md), not extension resources.

See [Chrome i18n documentation](https://developer.chrome.com/docs/extensions/reference/api/i18n)
for supported locale codes and fallback behavior.
