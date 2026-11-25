# UI localization: design

Status: design only, nothing built. From issue #14: a German interface was asked for, and a contributor offered to
translate and maintain Brazilian Portuguese (pt-BR) once the strings are extracted.

## What we want

- The app in German and pt-BR, then any language a maintainer takes on, without slowing English down or making every UI
  change touch every language.
- English stays the source: code reads as it does today, a missing translation shows English, never a key.
- A translator works on one file per language, sees what's new and what changed, and needs no build to check their work.
- New UI text can't go in untranslatable: a check fails, as for the other code rules.
- Agents, the vault's formats and the docs stay English. Localization is what a person reads in the app.

## What's in scope, and what isn't

Translated: everything the app draws for the user. Its pages, sidebars, menus, the palette, Settings, sheets, toasts,
dialogs, tooltips, empty states, error reasons; what plugin manifests show (names, descriptions, settings' labels and
their values' labels); built-in bundles' names and descriptions; the desktop app's menu bar, tray, dialogs and
notifications; push notifications; iOS permission prompts; the standalone pages (onboarding, vaults, offline).

Never translated: what's data or an agent's.

| Stays as it is | Why |
| --- | --- |
| Paths a plugin writes (`Inbox/`), kinds (`type:`), frontmatter keys, block names, settings keys, enum values (`waiting`) | They're the vault's format: code and agents read them, and a vault moves between languages |
| Command ids, hotkey files, `vau` commands, op names, MCP tools | The API |
| Ops' docs and errors, `vau` output, `/api/render`, `forAgents`, `AGENTS.md`, `core/docs/` | For agents, who read English best and share one set of docs |
| Logs, Errors' details, a bug's text | For whoever debugs, and searchable |
| The user's own notes | Theirs |

Separate from the interface language, and not tied to it: the spell-check language, dictation's language, and the
language agents write in (below). A German interface doesn't mean German notes.

## The language setting

- One setting, **Language**, in Settings > Appearance (found as language, locale): **Automatic** (the default) or one of
  the offered languages, each named in itself (Deutsch, Português (Brasil)).
- It's a vault setting, beside the other appearance settings in `.vaultite/` (the vault is one person's, so a choice
  follows them to every device, and an agent can set it). Automatic resolves per device: the desktop app's OS
  language, the browser's `navigator.languages`, the phone's.
- The default stays in code: a vault that never chose has no `language` written.
- Changing it reloads the app (offered with the toast, as a new build is: `core/unsaved.ts` decides when a reload
  is safe). Module-level text and registered commands then need no re-render plumbing, and the language changes rarely.
- Resolution: the chosen tag, then its base language, then English (`pt-PT` → `pt` → `en`). A language's entry can
  name a stand-in (`pt` → `pt-BR`) until a catalog of its own exists.
- The server needs the language for what it sends without the app (push and Mac notifications, the menu bar): it reads
  the vault setting, and for Automatic its machine's OS language.

## Formats: dates, numbers, lists, sorting

The UI language decides formatting too, with the device's region when it shares the language (`de-CH` on a Swiss Mac
with a German UI; `de-DE` with a German UI on an English Mac). One `appLocale()` gives that tag, and:

- `dateText` / `numberText` (`web/src/core/data.ts`) and the shared `Intl.Collator`s use it instead of `undefined`.
- The hard-coded `Intl.ListFormat("en")` (Welcome, the palette, bundles, vault plugins, dictation's learned words),
  `"en-GB"` (`core/desktop/walks.ts`) and `"en-US"` go through it, where a person reads the result. Text for agents
  (`core/agents.ts`' truncation note) stays English.
- Sorting the file tree and lists by name follows the language's collation (ä with a in German).

## Messages in code

English is written in place, as today, wrapped in `t()`. The English text is the message's key: no names to invent,
the code reads the same, and a translator sees the sentence they're translating.

```tsx
<Button>{t("New note")}</Button>
notify(t("Moved {name} to {folder}", { name, folder }), { action: { label: t("Undo"), run } })
notifyError(e, t("Couldn't rename {name}", { name }))
t.n(count, "Archived # file", "Archived # files")
t("Open", { context: "a file" })   // the same English, worded differently elsewhere
```

- Placeholders are named (`{name}`), never positional or template literals: a translator reorders them, and the check
  sees them.
- Plurals: `t.n(n, one, other)` in English; a language's catalog gives the categories `Intl.PluralRules` has for it
  (German one/other, Portuguese one/many/other). `#` is the number, formatted by `numberText`.
- `context` is part of the key, for English that's ambiguous (Open, the verb or the state; Archive).
- Rich text: `<T msg="Read {guide} first" guide={<Link …>{t("the guide")}</Link>} />`, rare.
- No runtime library: the lookup, interpolation and `Intl.PluralRules` are a few dozen lines in the core, shared by
  the app, the server and the desktop app (a `core/` file with no Node, as `core/plainerror.ts` is). A dependency like
  i18next or Lingui buys features we don't need and would ship in every bundle.

### Whole sentences, never assembled

Text built from translated pieces breaks in other languages (German capitalises nouns, word order differs), so each
message is a whole sentence. The ones to rewrite:

- `notify`'s failure text: `Couldn't ${action.label.toLowerCase()}` (`web/src/core/notify.ts`). An action gives its
  own failure message, or a generic "That didn't work".
- `${trial ? "Trying" : "Applying"} ${b.name}…` and the like: two messages.
- `capitalize()` and `.toLowerCase()` on UI text: gone from translated text.
- Show/Hide pairs already have `nameWhenOn`: each name is its own message.
- Sentence case is the rule in each language as it writes it (German nouns keep their capitals).

### Declared text: keyed by id

Much of the UI text is declared, not written in components: commands, switches, panels, Settings' sections, manifests,
bundles. Those keep their English in place and are translated where they're shown, keyed by the thing's id:

| Declared in | Catalog key |
| --- | --- |
| A command (`core/commands.ts`): `name`, `label`, `nameWhenOn` | `command.<id>.name` … |
| A switch (`core/switches.ts`): `name`, `sub` | `switch.<id>.name` … |
| A panel, a Settings section, a view | `panel.<key>.title` … |
| A plugin manifest: `name`, `description`, each setting's `label`, `description`, `group`, `unset`, `labels.<value>` | `manifest.<path>` in the plugin's catalog |
| A bundle (`bundles/<id>/bundle.json`): `name`, `description` | `bundle.<id>.<field>` |

This keeps `core/appsource.ts` (which reads command ids and names from the source for `electron/cli.json`) and
everything agents see unchanged: a command's English name stays its canonical one.

- The palette and Settings' search find by the translated name and the English one (people follow English guides, and
  an agent names commands in English). `runCommandNamed` (Vim's `:`, links) takes either.
- `words` gets translated words added, never replaced.

## Catalogs

One JSON file per language per owner, beside the code it serves, so a plugin stays one folder:

```
core/locales/de.json            the core's: web/src, core/ text the app shows, electron/
core/locales/languages.json     what's offered: name in itself, stand-ins, whether it's listed
core/locales/de.glossary.md     how each GLOSSARY.md word is translated
plugins/core/<id>/locales/de.json    a plugin's messages and its manifest's text
bundles/<id>/locales/de.json
```

```json
{
  "New note": "Neue Notiz",
  "Moved {name} to {folder}": "{name} nach {folder} verschoben",
  "Archived # file|Archived # files": { "one": "# Datei archiviert", "other": "# Dateien archiviert" },
  "Open|a file": "Öffnen",
  "command.switcher:open.name": "Schnellauswahl öffnen",
  "_stale": { "Moved {name} into {folder}": "{name} in {folder} verschoben" }
}
```

- No committed English catalog: the source is the English. A tool (`npm run strings`) extracts every message from the
  source (TypeScript's parser, `t` / `t.n` / `<T>` calls and declared text) and:
  - `npm run strings -- de`: syncs `de`'s catalogs. New messages come in as `null` (shown in English), messages whose
    English changed or went move to `_stale` with their old translation, so a translator rewords instead of starting
    over. It prints coverage per area.
  - `--pseudo`: writes the pseudo-locale (below).
- The catalogs aren't kept in step by developers: a UI change never has to touch `de.json` or `pt-BR.json` (many agents
  change the UI at once; every change touching every catalog would conflict). A missing translation is English. The
  maintainer syncs when they translate.
- `npm run check` validates catalogs: valid JSON; each translation has exactly its English's placeholders; plural
  entries have the language's categories; manifest keys name a manifest field that exists. Its error names the fix.
- Loading: English loads nothing. Another language is fetched before the first render (`main.tsx` waits on it; a
  preload in `index.html` from the stored choice, so it comes in parallel with the app's own files), split like the
  app's files (`vite.config.ts` `appGroups` and `stableChunks`, per language), so a deploy re-downloads only the
  catalogs that changed. The offline page caches the chosen language's. A language's catalogs run to a few hundred KB
  before compression; if they push past `tools/perf/startup.json`, that's measured, and a budget raise is its own
  commit saying so.
- `t()` at a module's top level is refused by the check (as a plugin API call at top level is): the catalog isn't there
  yet when modules load, and a string frozen at load time wouldn't follow the language. Declared text is translated at
  display, so it needs none.

## The other surfaces

- **Desktop main process** (`electron/`): the menu bar (built from commands, so their keys), the tray, dialogs and
  notifications use the same `t` with the core catalog, read from disk lazily, not at launch (the main process's
  launch budget, `tools/maingate.sh`).
- **Swift helpers** (`electron/*.swift`): take their text from Node, already worded; no Swift localization (the old
  Xcode on CI, and one catalog).
- **iOS**: permission prompts (camera, microphone, speech, health) need `InfoPlist.strings` per language, which the App
  Store reads: generated from the core catalog into `de.lproj` / `pt-BR.lproj`, and `CFBundleLocalizations` lists the
  offered languages. Widgets and the watch take their text from the app.
- **Android**: only the app's name, which stays Vaultite.
- **Server text the user reads**: push and Mac notifications, the menu bar, inbox items the server words. Worded with
  the vault's language (above).
- **Error reasons**: `core/plainerror.ts`' reasons ("the disk is full") become messages, so "Couldn't save: the disk is
  full" reads whole in German. An op's refusal the app shows is English until the op gives a code the app can word;
  that comes per op, after the first pass.
- **Pages a plugin writes once** (`pages/*.md`, `core/pages.ts`): they become the user's files. A plugin may ship
  `pages/<lang>/` copies, written when it's turned on in that language; their paths stay the English ones (code and
  pins name them). Not in the first pass.

## Agents

Vaultite's main writers are agents, and what they write for the user (notes, `vau notify` toasts, `inbox.ask`
questions and their options, reports) isn't in any catalog. So:

- The vault's language reaches agents through the settings ops (`vau settings`), and `core/AGENTS.md` gets one line:
  write what the user reads in the vault's language (`vau settings` names it); ids, paths, kinds and commands stay as
  they are.
- Settings' default prompts (Inbox's voice note prompt) stay English: they're for agents, and an agent answers in the
  language it's told.

## Keeping new text extracted

- An oxlint rule in `tools/oxlint/vaultite.ts`, `vaultite(ui-text)`: JSX text with a letter, and string literals in
  `label`, `title`, `placeholder`, `aria-label`, `data-tip`, `alt` props and as the text of `notify`, `notifyError`,
  `confirmDialog` and menu items, outside `t()`. Its message names `t()`. It joins the lint ratchet (`tools/ratchet.ts`):
  today's few thousand count, and a change can't add to its files' count, so extraction only goes one way.
- Declared text needs no rule: it's translated by id wherever it's shown.
- What lint can't see (text computed elsewhere, a server string) the pseudo-locale finds.

## Testing

- **Pseudo-locale** `en-XA`, generated, offered only in dev: each message accented and 40% longer, in brackets
  (`[Ñéŵ ñöţé ·····]`). A QA script, `web/qa/locale.mjs`, opens the main screens (desktop and phone) in it and fails
  on visible text without the brackets (not extracted) or cut off where it shouldn't be. German runs about 30% longer
  than English: the pseudo-locale is how layouts are checked before a translation exists, with `layout.mjs` and the
  phone's 44px rows.
- Unit tests for `t`: fallback chain, placeholders, plurals for de and pt-BR, `context`.
- `visual.mjs` stays English: a language's screens aren't held as pictures.

## Translators

- A language starts with its glossary (`core/locales/<lang>.glossary.md`): how each `GLOSSARY.md` word is said
  (vault, workspace, inbox, knock, companion, sheet), so the whole app says it one way. That's the first review.
- Then `npm run strings -- <lang>`, translate the `null`s and `_stale`, open a PR. No build needed: the check validates.
- `languages.json` names each language's maintainer and whether it's listed in Settings. A language is listed once its
  maintainer says it's ready (its core catalog and the essential plugins covered); before that it's there in dev.
- A draft from an agent is fine to start from; a native speaker reviews and owns it.
- `CONTRIBUTING.md` gets a Translating section with the above.

## Vault plugins

The same `t` and `locales/` folder through the plugin API (`@vaultite`, documented in `core/docs/vault-plugins.md`),
and the same manifest keys. Vaultite/plugins' plugins get extracted after the core's. A vault plugin with no catalog
shows its English, as any missing translation does.

## Plan

Each step lands on its own and leaves the app working; English users see nothing change until a language is listed.

1. **The runtime.** `t`, `t.n`, `<T>`, `appLocale()`, the Language setting, catalog loading and the reload, locale-aware
   `dateText`, `numberText`, collators and list formats, the declared-text lookup for commands, switches, panels,
   manifests and bundles, the palette finding by both names. The pseudo-locale and `npm run strings`.
2. **The guard.** The `ui-text` lint rule on the ratchet, the catalog checks, `locale.mjs`.
3. **Extraction, by area**, each a PR a reviewer can read: Settings and the palette first (mostly declared text, so
   mostly mechanical, and the area the pt-BR contributor offered to start with), then the sidebars, menus and toasts,
   sheets, then each plugin, most used first. The whole-sentence rewrites go with their area. Agents can do most of
   this; it's mechanical with the lint rule's count as the progress bar.
4. **de and pt-BR.** Glossaries, then catalogs; listed when their maintainers say so. pt-BR has its maintainer from
   #14; German needs one (the issue's author may be).
5. **The rest.** The desktop app's menus and dialogs, iOS permission prompts, server notifications, error reasons,
   op refusals with codes, plugins' pages, Vaultite/plugins.

## Decisions to confirm

- English text as the key (above) rather than named keys (`settings.title`) as #14's comment suggests: named keys make
  the code harder to read and need a name for each of a few thousand strings; the cost is that rewording English
  orphans translations, which `_stale` keeps for the translator.
- Language as a vault setting with Automatic per device, rather than per device only.
- A language listed only when its maintainer says ready, rather than as soon as it has a catalog.
- No i18n library.
