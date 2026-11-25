# UI localization: design

Status: design only, nothing built. Asked for in issue #14: German by mwabner, and cassiodeas offered to translate and maintain pt-BR once strings are extracted.

## In short

English stays the source: the English text in the code is the key, so code reads as it does today and English needs no catalog. A tiny helper of our own, `t()`, looks the text up in a per-locale JSON catalog and falls back to English. Plurals, dates, numbers and lists go through `Intl`. Registries (commands, settings, panels, manifests) keep their English names, and the surfaces that draw them translate at the edge, so agents and the server keep seeing English. The language is a vault setting whose default follows each device. A lint rule on the existing ratchet stops new hardcoded UI text, and a pseudo-locale shows what slipped through. A model drafts translations, native speakers review them. It lands in slices: the layer with Settings and the command palette first.

## What there is to translate

Counted on main (aa9c295) with a script over string literals and JSX text, skipping tests, QA, op files and plugins' backends. It is a heuristic: about 85% of a random sample was real UI text, so read each number as plus or minus 20%. cassiodeas' "2,000+" was low: there are about 5,300 unique strings, some 20,000 words, plus the manifests.

| Area | Unique strings | Notes |
| --- | --- | --- |
| `web/src/components` | ~920 | Sheets, menus, toasts, Welcome, the palette |
| `web/src/core` | ~550 | Command and setting names (`choices.ts`), notices, menus built in code |
| `web/src/pages` | ~320 | Settings, Plugins, Hotkeys, Search, Files, Setup |
| `web/src` other (phone, screen, onboarding, vaults, editor, screendraw) | ~300 | |
| App plugins (81, `plugins/core`) | ~3,400 | web-viewer ~730, companion ~370, claude-code ~270, mcp ~210, inbox ~200, query ~160, activity ~150, vim ~120, terminal ~115, references ~115, canvas ~100, machines ~95; the other 69 under 90 each, about 1,000 together |
| Manifests (`plugins/core/*/manifest.json`) | ~680 fields | 81 names and descriptions (about 4,000 words, the biggest single chunk), ~190 setting labels, choices, `unset` texts |
| Desktop shell (`electron/`, `core/desktop/`) | ~470 | The menu bar's own labels are only ~60; most is the helper's overlays, dictation and Talk notices, Set up Vaultite, dialogs |

What the formatting layer has to absorb: 110 calls to `plural()` (`web/src/lib/utils.ts`, English-only) and about 270 hand-made `n === 1 ?` plurals, ~550 strings with interpolation, 6 `Intl.ListFormat("en")`, 14 `toLocale*String` calls, collators built with `undefined` (the browser's locale, not the app's), and `dateText` / `numberText` (`web/src/core/data.ts`), which already centralise dates and numbers.

## What gets translated, and what doesn't

Translated: what a person sees in the app. The web app (desktop, phone, the Screen and island pages, onboarding, the vaults window), every app plugin's UI and the manifest text Settings and Plugins show (names, descriptions, setting labels, choices), the desktop shell's own labels (menu bar, Set up Vaultite, dialogs, the helper's overlays and tray menu), tooltips and `aria-label`s, the error page in `index.html`, and later the OS usage strings (Info.plist's microphone and camera reasons) through each platform's own localization.

Not translated: what agents read and what is a format.

- `vau` docs, op names and descriptions, `AGENTS.md`, `forAgents`, block descriptions and options, `core/docs/`, MCP tool text: agents read English and the docs are made from them.
- File formats: frontmatter keys, `type:` values, daily notes' file names, dates in paths, the query language, `.vaultite/*.json` keys, command ids, `hotkeys.json`. `core/dates.ts`' English month and day names stay: they name files.
- The user's vault content, and what an AI writes into it. A plugin's `pages/*.md` are the user's files once written (see open questions).
- Logs, the server's console, a bug's text behind Details and in Errors, the CLI's output.

Server-made text the app shows (a notice from an op, an error's plain reason) is UI and is translated in a later slice: the server sends its English template and values apart (`{ text: "Couldn't move {name}", vars }`) and the app runs it through `t()`. Until then it shows in English.

## The layer

One pure module, `core/i18n.ts` (no Node, so the app, the desktop main process and the server can all import it), and the app's side in `web/src/core/i18n.ts` (loading, the setting, the pseudo-locale). About 200 lines in all.

### Keys: the English text

`t("Move to trash")` looks up `"Move to trash"` in the active catalog and returns it unchanged when there's none. Why English as the key, not `settings.trash.title`:

- Most commits here are by agents: no key to invent, name and keep in sync, no second file to edit for English, and the code still says what the user sees.
- Fallback is free and exact: a missing translation is the English, never a key.
- Extraction is a scan for `t("...")` literals, which is also what the check reads.
- A change to the English is a new key: the old translation goes stale, which is right (the meaning changed), and the check lists it for the translator beside the new one.

The cost is the same English with two meanings ("Open" the verb and the state, "Back"). For those, a context: `tc("state", "Open")`, keyed `state\u0004Open` as gettext does. The check reports a key that two catalogs translate differently, so a context gets added only where needed.

### Interpolation and plurals

- Values by name: `t("Moved {name} to trash", { name })`. Names, not positions, because word order changes (German verbs go last). Values are inserted as text, never HTML; a React node in a message is `tx("Open {link} in a tab", { link: <a>…</a> })`, which returns parts.
- Plurals: `t.plural(n, "{n} file", "{n} files", vars)`. English's two forms are in the code; the key is the `other` form. A catalog's entry is then an object of CLDR categories, `{ "one": "{n} Datei", "other": "{n} Dateien" }`, and `Intl.PluralRules(locale).select(n)` picks one. `{n}` is formatted with `Intl.NumberFormat` (`1.234` in German). Replaces `plural()` and every `n === 1 ?`.
- No select or nested plurals (no ICU MessageFormat). `copy ? "Copied" : "Moved"` becomes two messages: whole sentences translate, fragments don't. A sentence with two counts becomes two sentences.

### Formatting through Intl

The app's resolved locale goes to every `Intl` object: `dateText`, `numberText`, a new `listText()` (for the six `ListFormat("en")`), `relativeText()` on `Intl.RelativeTimeFormat` (for "3 min ago" and its kin, today built by hand), one collator per locale (sorting, `localeCompare`), and `Intl.DisplayNames` for the language list itself (each language in its own name: Deutsch, Português (Brasil)). Key names from `keyHint` follow the locale off a Mac (Strg, Umschalt, Entf in German); a Mac keeps its symbols. `<html lang>` follows too, so hyphenation and screen readers do.

### Fallback

A locale's chain is itself, then its language, then English: `pt-BR` → `pt` → `en`, `de-AT` → `de` → `en`. A message missing anywhere shows in English, so a half-translated locale is usable from its first string. Placeholders a translation lost are filled with the English's (the check stops that from landing anyway).

### Why our own helper, not a library

- i18next with react-i18next is about 40 KB with namespaces, backends and options we'd not use; FormatJS (react-intl) brings a full ICU parser; both weigh on the launch budget (`tools/perf/startup.json`) and the phone's cold start, for features (select, nested plurals, ICU dates) we'd rather not allow.
- Lingui fits best on paper (English source, extraction), but its macros need a compile step: the server and the desktop main process run on Node's type stripping with no transform, and the core's `t()` has to run there too.
- What we need is in the platform (`Intl.PluralRules`, `DateTimeFormat`, `NumberFormat`, `RelativeTimeFormat`, `ListFormat`, `DisplayNames`), and the rest is a lookup and a replace.

### Loading and the launch budget

English loads nothing: the code is the English. Another locale's catalog is JSON split like the code it translates (vite.config's `appGroups` and `cut`, each with a lasting key), so a deploy re-downloads only what changed and only enabled plugins' parts load. It is fetched in parallel with the app's chunks, the locale known before the app starts from the cached prefs in localStorage. `tools/perf/startup.ts` gets a German run.

No `t()` at a module's top level: a module evaluates once, before a change of language, and app plugins load eagerly (the same reason they use no plugin API while loading). The lint rule flags it; a table of labels becomes a function, or keeps English and is translated where drawn.

### Changing language

A change reloads the app the way a new build does (`core/builds.ts`, `core/unsaved.ts`): at once when nothing would be lost, else offered with Reload. Re-rendering every memoised component live would need a context through the whole tree for something set once; a reload is correct, cheap and already a primitive. Another device sees the change through live config and does the same.

## Translating at the edge

Registries keep English, and what draws them translates:

- Commands (`core/commands.ts`, `choices.ts`, plugins' `commands`): the palette, menus and the menu bar show `t(name)`. `core/appsource.ts` reads command ids and names from the source as literals, and the server and agents see those English names: both keep working unchanged.
- Settings: Settings, plugin settings sheets and Settings' search show `t(label)`, `t(brief)`, `t(choice.label)`, with the manifest's text as the key.
- Panels, views, sidebar headings, sections, tab titles from `title()`: drawn through `t()`.
- Search in the palette and Settings matches the translated name and the English one (people follow English docs and agents' advice), plus the English `words`; a catalog can add words of its own (`"setting:theme#words": "dunkel hell"`).

So the strings that need `t()` at the call site are what's typed in components: JSX text, `notify()` and `notifyError()` texts, `confirmDialog()`, tooltips, `aria-label`s, placeholders.

Anything that finds UI by its visible text must move to ids or the English source: QA scripts (`menu("Rename")`), the desktop's UI model and overlay marks (`core/desktop/`), panel names agents use (`PanelDef.names`). QA runs in English, so its scripts keep working; the rule is for code.

## Plugins

The core's catalogs (for `web/src`, `electron` and `core/desktop`) are `locales/<locale>.json` at the repo's root. Every plugin ships its strings in its own folder the same way, `locales/<locale>.json`, keyed by English as the core's are: `plugins/core/tags/locales/de.json`, and the same for a vault plugin. The core finds them by glob as it finds plugins, so it imports none.

Plugins import `t`, `tc`, `tx`, `t.plural`, `useLocale()`, `dateText`, `numberText`, `listText` and `relativeText` from `@vaultite`, as they import everything else; no plugin id to pass. All catalogs of a locale merge into one table, with one precedence rule: the core and app plugins first, then vault plugins, which can add keys but never change one already there. So a third-party plugin can't restyle the core's words, and a vault plugin's "Open" reads as the core's does. The check reports app plugins whose catalogs disagree on a key: one needs a context.

Manifests stay English JSON (agents read them); the plugin's catalog holds their translations under the same English keys. A plugin backend's text shown in the UI is the server-made case above.

For vault plugin authors: `core/docs/vault-plugins.md` and `plugin-api.md` get a short section, and `tools/i18n.ts` works on any plugin folder, including Vaultite/plugins' (`node tools/i18n.ts missing de --dir ../vaultite-plugins/<id>`).

## The language setting

One key, `language`, in `.vaultite/language.json`: a BCP 47 tag from the locales we ship, or absent. Absent, each device follows its own language: `navigator.languages` in the app, `app.getPreferredSystemLanguages()` in the desktop shell, matched through the fallback chain. A vault value is the user's choice everywhere; per device stays the default, so a vault opened from a German Mac and an English phone shows each in its own until the user picks. Not in `appearance.json`: a look bundle restyles (`core/look.ts`) and must never change the language. An agent can change it like any setting, and the app follows live (reloading, above).

In Settings under Appearance: Language, its value "Match this device (Deutsch)" or a language in its own name, plus a link to how to help translate. In the palette as a choice, like Theme. The desktop shell takes the resolved locale from its page (it already tells the menu bar its commands), and Set up Vaultite, before any vault, uses the system's.

The desktop shell: the menu bar's own labels (File, Open vault, Keep window on top...) go through the core's `t()` in the main process. Electron's role items (Undo, Copy, Hide, Quit, Services) are named by macOS and Chromium for the app's locale; on a Mac they're localized only when the bundle declares that language (`electronLanguages` and the `.lproj` folders): check on a German Mac in the shell slice, and give labels ourselves where that fails.

## Keeping it from rotting

- A lint rule, `vaultite/ui-text`, in `tools/oxlint/vaultite.ts` and so on the ratchet (`tools/ratchet.ts`): it flags JSX text, UI attributes (`aria-label`, `placeholder`, `data-tip`, `label`), the text arguments of `notify`, `notifyError`, `confirmDialog`, menus and toasts, and `t()` at a module's top level. Today's ~5,000 hits are the baseline: a change can't add one, and each slice lowers it. Its message names the fix: "UI text: t() from @vaultite (a count: t.plural)". Text that isn't UI (a font name, a brand) says so with a reason, as other disables do. As a check whose error names the fix, it teaches agents better than a CLAUDE.md line, which gets one line only: translations of new strings aren't the change's job.
- A catalog check in `npm run check`: every catalog parses; placeholders in a translation match the English's; a plural entry has exactly its locale's categories (`Intl.PluralRules(...).resolvedOptions().pluralCategories`); keys no longer in the source are reported as stale (a warning, never a failure, with the nearest new key for the translator); app plugins don't disagree on a key. Missing translations never fail anything.
- A pseudo-locale, `en-XA`, made at runtime from the English, never stored: "[Ŝéţţîñĝš ~~~~]", accented, 40% longer, bracketed. Text that didn't go through `t()` stays plain; text that clips loses its closing bracket. Pick it in Settings (only in Vaultite Dev and with `?locale=en-XA`). A QA script (`web/qa/locale.mjs`) opens the main screens in it and fails on chrome text with no accents (content is told apart already: editors, `<Markdown>`, `select-text`, `data-chrome`), and runs `layout.mjs`'s checks for overflow.
- `node tools/i18n.ts`: `missing <locale>` (untranslated keys with their places), `stale <locale>`, `stats` (coverage per locale and area), `draft <locale>` (below).

## Translations

### First locales

German (`de`) and Brazilian Portuguese (`pt-BR`). Each has a voice guide beside its catalog, `locales/<locale>.md`: the register (du or Sie in German, você in pt-BR), the glossary (each term of `GLOSSARY.md` and its word in the language, and what to avoid, as GLOSSARY.md does), the rules carried over (sentence case, which in German still capitalises nouns; no all caps, no emojis; "Turn on" only for plugins; quotes „…“ in German, “…” in pt-BR; the ellipsis), and a few of the app's own sentences translated as the model of its voice.

### Who writes them

A model with a good ear, Gemini 4 Neon, drafts. `node tools/i18n.ts draft <locale> [area]` sends the missing keys with what it needs to choose well: the place (file, the component around the string, whether it's a button, a title, a toast), the English and its plural forms, the voice guide and glossary, and the catalog's nearby entries for consistency. It writes the catalog and lists what it drafted in `locales/<locale>.drafts.json`. Only the app's source text is sent, never anything from a vault. The API key is a developer's or CI's secret, not the app's.

Native speakers review. A draft lands at once (better than English for most people) and stays in the drafts list until a reviewer takes it off, by area, in a PR of their own. cassiodeas reviews and maintains pt-BR. German has no reviewer yet (open questions).

New strings: agents only wrap them in `t()`. A scheduled job drafts the missing ones per locale (once a day or per release), so a new string is in English for a day at most, and reviewers see a short drafts list rather than a backlog.

### Adding a language

A contributor copies the voice guide's outline into `<locale>.md` and fills the glossary and register first, runs `draft` for the locale, reviews area by area, and adds the locale to the shipped list (one line). A locale shows in Settings once its core catalog is 80% done (`stats` says), so a language never appears mostly in English. Right-to-left languages need logical CSS properties throughout: not now, and said so in the guide.

## Rollout

Each slice lands alone, the app working in English all along, and lowers the ratchet's count for its files.

1. The layer and its first area: `core/i18n.ts` and `web/src/core/i18n.ts`, the setting and the reload, the locale passed to every `Intl` and `plural()` gone, the lint rule (baseline only), the catalog check, the pseudo-locale and its QA, `tools/i18n.ts`, the voice guides; then Settings, the command palette and the edge translation of commands, choices and settings; de and pt-BR drafted for it.
2. The shell: sidebars, tab bar, status bar, file tree, menus, toasts, confirmations, DetailSheet's chrome, and the first run (onboarding, Welcome, Set up), as a new German user sees it first.
3. Plugins page and every manifest: names, descriptions, setting labels and choices; plugin settings sheets.
4. The editor and the essential plugins (files, search, daily notes, tags, backlinks, properties, inbox, templates).
5. The desktop shell: menu bar, roles, vaults window, dialogs, the helper's overlays and tray; Info.plist strings.
6. The other app plugins, a slice each or a few small ones together, by how many people use them (the big ones, web-viewer, companion, claude-code, mcp, are a slice each).
7. Server-made UI text (notices, plain error reasons) as template and values.
8. Vault plugins: the docs, and catalogs for Vaultite/plugins.

Slices 2 to 8 can run in parallel once 1 has landed; each needs its drafts and then review.

## What cassiodeas can start on

- Now, before any code: the pt-BR voice guide, its register and the glossary of GLOSSARY.md's terms in pt-BR (cofre or vault, nota, aba, painel, plugin...). It needs nothing built, and it's what the drafts follow.
- Once slice 1 lands: review the pt-BR drafts for Settings and the palette, in the app (Settings > Language) and in the catalog.
- From then on, review each slice's pt-BR as it lands. Extraction PRs for an area are welcome too, once slice 1 shows the pattern: say which area in the issue first, as agents work through them as well.

## Open questions

1. Vault-wide or per device? Recommendation: vault-wide setting whose default is "match this device", as above, and no per-device override until someone asks.
2. Reload on change, or re-render live? Recommendation: reload (through `core/unsaved.ts`). A language changes rarely; live re-rendering costs a context through every memoised component.
3. German register, du or Sie? Recommendation: du. Vaultite's voice is plain and direct, and a personal app on a private network speaks to one person; the reviewer can overrule.
4. Translate "vault"? Recommendation: let each locale's glossary decide with its reviewer; propose "Vault" kept in German and "cofre" in pt-BR, for mwabner and cassiodeas to confirm.
5. Who reviews German? Recommendation: ask mwabner in the issue whether they'd review de, the way cassiodeas does pt-BR; until then de ships as drafts, marked as such on the Language setting's line.
6. Pages a plugin writes into the vault (`pages/*.md`) when turned on: in English, or in the user's language? Recommendation: in the user's language from slice 6 on (the plugin's `pages/<locale>/` beside its English ones), as they're written once and then the user's; until then English.
7. Should agents be told the UI language, so the companion and coding agents answer and write notes in it? Recommendation: yes, one line in the context agents already get (the vault's language), in its own change after slice 1; it isn't UI localization, but German users will expect it right after.
8. Should pt-PT and other Portuguese fall back to pt-BR rather than English? Recommendation: yes; most pt-PT readers prefer pt-BR to English, and a pt-PT catalog would take over when one exists.
