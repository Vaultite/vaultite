// The app's settings files (core/docs/app.md) read and changed key by key (Vault.patchConfig; the app follows live),
// and what they can name: commands and keys, blocks, icons.
import { listSnippets, listThemes } from "../appearance.ts"
import type { App } from "../app.ts"
import { commandList, pageIcons, schemes } from "../appsource.ts"
import { closest, COMMON, optionText } from "../blocks.ts"
import { jsonBlock, type Op, OpError } from "../ops.ts"
import { type Any, lines } from "./common.ts"
import { strings } from "../values.ts"
import { pluginList } from "./plugins.ts"


/** A text read as JSON when it is (numbers, true, lists), else the text. */
const value = (s: string): unknown => {
  try { return JSON.parse(s) } catch { return s }
}

// ---------- appearance ----------

type Setting = { about: string; parse: (v: string) => unknown }
const oneOf = (...xs: string[]) => (v: string) => {
  if (!xs.includes(v)) throw new OpError(`'${v}' isn't one of ${xs.join(", ")}`)
  return v
}
const bool = (key: string) => (v: string) => {
  if (!["true", "false", "on", "off"].includes(v)) throw new OpError(`${key} is true or false`)
  return v === "true" || v === "on"
}
/** A JSON list, or names separated by commas. */
const names = (v: string) => {
  const j = value(v)
  return Array.isArray(j) ? j : v.split(",").map((s) => s.trim()).filter(Boolean)
}
/** appearance.json's keys (web/src/core/prefs.ts reads them), what each takes, and how a value given as text reads. */
const APPEARANCE: Record<string, Setting> = {
  theme: { about: "light, dark or system (follows the device)", parse: oneOf("light", "dark", "system") },
  scheme: {
    about: "colour scheme: gruvbox (the default), default (Classic, Apple's colours), one in web/src/themes (nord, catppuccin...), or theme:<Name> for a downloaded theme in .vaultite/themes",
    parse: (v) => {
      if (/^theme:[^/\\.][^/\\]*$/.test(v)) return v // checked against the vault in run
      if (!schemes().includes(v)) throw new OpError(`'${v}' isn't one of ${schemes().join(", ")}, or theme:<Name> (a downloaded theme in .vaultite/themes)`)
      return v
    },
  },
  density: { about: "compact or comfortable (row heights and spacing)", parse: oneOf("compact", "comfortable") },
  sidebarScroll: { about: "panels (each sidebar panel scrolls in its own box, dividers set heights; the default) or sidebar (the whole sidebar scrolls as one)", parse: oneOf("panels", "sidebar") },
  panelDividers: { about: "true or false (default): a line between the sidebars' panels", parse: bool("panelDividers") },
  quickTextSize: { about: "true or false (default): ⌘/⌃ and the wheel, or a pinch, over a note or a terminal changes its text size", parse: bool("quickTextSize") },
  interfaceFont: { about: "the interface's font family (a font installed on the device; Settings lists them)", parse: (v) => v },
  textFont: { about: "the font of notes' text", parse: (v) => v },
  monoFont: { about: "the font of code and source mode", parse: (v) => v },
  snippets: {
    about: "CSS snippets turned on, by name (a JSON list, or names separated by commas)", parse: names },
  fileIcons: { about: "true or false: icons before file names: the tree, tabs, search and the quick switcher", parse: bool("fileIcons") },
  tabBar: { about: "true (default) or false: the tabs above each pane on desktop; off, each pane's bar shows only the tab on screen (switch with the Tabs panel or the keyboard)", parse: bool("tabBar") },
  paneTitles: { about: "false (default) or true: with tabBar off, a strip above each pane naming the tab on screen (tells splits apart); off, nothing above the pane", parse: bool("paneTitles") },
  tabTint: { about: "true or false (default): the active tab takes a light wash of its colour (a web page's container)", parse: bool("tabTint") },
  rails: { about: "true (default) or false: a hidden sidebar folds to its icon rail on desktop; off, it's gone, sliding back over the page while the pointer is at that edge of the window", parse: bool("rails") },
  peekShade: { about: "true or false (default): with rails off, the page dims a little behind a hidden sidebar slid in", parse: bool("peekShade") },
  typingFade: { about: "true or false (default): on desktop, the bars above files (the path, the file's items) fade while typing in a file, back when the pointer moves or at Escape", parse: bool("typingFade") },
  translucent: { about: "true or false (default): in the Mac and Windows 11 apps, the desktop shows blurred through the sidebars, the tab bar and the status bar; solid with Reduce transparency, elsewhere and while an app window shows", parse: bool("translucent") },
  translucentPages: { about: "true or false (default): with translucent, pages too (notes, terminals, canvases, the app's own pages) show the desktop, less than the chrome; web pages, PDFs, images and video stay solid", parse: bool("translucentPages") },
  statusBar: {
    about: "the desktop status bar's items, in order: the app's own (core:view, core:words, core:characters) and plugins' as <plugin>:<name> (inbox:new, terminal:agents, vim:mode, token-count:tokens): a JSON list or names separated by commas; [] for none (an empty corner, right-click to bring them back)", parse: names },
  statusBarMore: {
    about: "those of statusBar's items kept in the status bar's tray (its more button) whatever room there is: a JSON list or names separated by commas", parse: names },
  fileBar: {
    about: "the plugins' items in a file's top bar, in order, as <plugin>:<name> (companion:presence, provenance:origin): a JSON list or names separated by commas; ones left out follow by their default place", parse: names },
  sidebarHeader: {
    about: "the plugins' items in the left sidebar's header, in order, as <plugin>:<name> (workspaces:numbers, inbox:inbox): a JSON list or names separated by commas; [] for none; unset: every one", parse: names },
  pullActions: {
    about: "the commands a page pulled down on a phone offers, left, straight down, right, by command id (default file:new, switcher:open, tab:close): a JSON list or ids separated by commas", parse: names },
  lineNumbers: { about: "true or false: line numbers beside a file's text while editing it (code files always have them)", parse: bool("lineNumbers") },
}

const showLook = (o: Any) => lines(Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), "(all defaults)")

// ---------- hotkeys ----------

const MODS: Record<string, string> = {
  mod: "Mod", cmd: "Mod", command: "Mod", meta: "Mod", "⌘": "Mod", shift: "Shift", "⇧": "Shift", alt: "Alt", option: "Alt",
  opt: "Alt", "⌥": "Alt", ctrl: "Ctrl", control: "Ctrl", "⌃": "Ctrl",
}
const NAMED: Record<string, string> = {
  enter: "Enter", return: "Enter", esc: "Escape", escape: "Escape", tab: "Tab", space: " ", backspace: "Backspace", delete: "Delete",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", arrowup: "ArrowUp", arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft", arrowright: "ArrowRight", home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown",
}

/** "cmd+shift+t" -> "Mod+Shift+T": the app's form (web/src/core/commands.ts: Mod is ⌘ on a Mac, Ctrl elsewhere). */
export function normalizeKeys(s: string) {
  const parts = s.trim().split(/\+(?!$)/)
  const key = parts.pop()!
  const mods = parts.map((m) => {
    const x = MODS[m.toLowerCase()]
    if (!x) throw new OpError(`'${m}' in '${s}' isn't a modifier (Mod, Shift, Alt, Ctrl)`)
    return x
  })
  if (!key || MODS[key.toLowerCase()]) throw new OpError(`'${s}' has no key after its modifiers`)
  const k = NAMED[key.toLowerCase()] ?? (/^f\d{1,2}$/i.test(key) ? key.toUpperCase() : key.length === 1 ? key.toUpperCase() : key)
  return [...["Mod", "Ctrl", "Alt", "Shift"].filter((m) => mods.includes(m)), k].join("+")
}

// ---------- the ops ----------

/** The app's own settings files, .vaultite/<name>.json: what the app's state holds and its routes and ops may change
 *  (a plugin's data.json is plugin/<id>). */
export const SETTINGS = ["appearance", "editor", "plugins", "sidebars", "newtab", "files", "folders", "pages", "hotkeys"]
/** The route of a settings file: config/<name>, or config/plugin/<id> (whose route keeps its `local` keys this machine's). */
function settingsRoute(name: string) {
  const n = name.trim().replace(/^\.vaultite\//, "").replace(/\.json$/, "")
  const plugin = /^plugins?\/([a-z0-9][a-z0-9-]*)(\/data)?$/.exec(n)
  if (plugin) return `config/plugin/${plugin[1]}`
  if (!SETTINGS.includes(n)) throw new OpError(`no settings '${name}': ${SETTINGS.join(", ")}, or plugin/<id> (a plugin's data.json)`, 404)
  return `config/${n}`
}

export function settingsOps(app: App): Op[] {
  const vaultPlugins = () => pluginList(app).filter((p) => p.tier === "vault")
  return [{
    id: "settings.get",
    cli: "settings",
    summary: "A settings file of the app (appearance, editor, plugins, sidebars, newtab, files, folders, pages, hotkeys) or a plugin's (plugin/<id>), as JSON.",
    help: `The app's settings are files in the vault's .vaultite/ (vau docs app has every key); a plugin's are its
.vaultite/plugins/<id>/data.json (vau docs <id> lists them). Unset keys are the app's defaults.

  vau settings appearance
  vau settings plugin/workspaces`,
    kind: "read",
    params: { name: { type: "string", required: true, description: "appearance, editor, plugins, sidebars, newtab, files, folders, pages, hotkeys, or plugin/<id>" } },
    args: ["name"],
    run: ({ name }, ctx) => ctx.api("GET", settingsRoute(name)),
    text: jsonBlock,
  }, {
    id: "settings.set",
    cli: "settings set",
    summary: "Change some keys of a settings file (the others stay; null removes one, back to the default).",
    help: `Writes only the keys given into .vaultite/<name>.json (or plugin/<id>: its data.json), the file as it is now,
so nothing another device or app version wrote is lost; null removes a key. The app follows live. Values aren't
checked here: vau appearance and vau hotkey check theirs.

  vau settings set files '{"showHidden": true}'
  vau settings set plugin/today '{"week_starts": "monday"}'`,
    kind: "write",
    params: {
      name: { type: "string", required: true, description: "appearance, editor, plugins, sidebars, newtab, files, folders, pages, hotkeys, or plugin/<id>" },
      values: { type: "object", required: true, description: "the keys to change and their new values (null removes one)" },
    },
    args: ["name", "values"],
    run: ({ name, values }, ctx) => ctx.api("PATCH", settingsRoute(name), values),
    text: jsonBlock,
  }, {
    id: "appearance.get",
    summary: "The appearance settings (theme, scheme, density, fonts, snippets...): appearance.json, unset keys default.",
    kind: "read",
    params: { key: { type: "string", description: "one setting (theme, scheme...); all of them when left out" } },
    args: ["key"],
    run: ({ key }) => {
      const cur = app.vault.configWithDefaults("appearance")
      return key ? { [key]: cur[key] ?? null } : cur
    },
    text: (r, p) => (p.key ? (r[p.key] === null ? `${p.key}: (default)` : `${p.key}: ${JSON.stringify(r[p.key])}`) : showLook(r)),
  }, {
    id: "appearance.set",
    cli: "appearance",
    summary: "Get or set appearance settings: theme, scheme, density, fonts, snippets, file icons, the tab bar.",
    help: `.vaultite/appearance.json, key by key (the app follows live). Without a value, the key's value (without a key, all
of them). Keys:
${Object.entries(APPEARANCE).map(([k, s]) => `  ${k.padEnd(14)} ${s.about}`).join("\n")}
\`reset\` removes the key (the app's default). --force sets a key this list doesn't know (the value as JSON when it
parses, else text). There's no font size setting: ⌘+ and ⌘- (Ctrl off a Mac) zoom the app (the browser's zoom, or the desktop app's).

  vau appearance
  vau appearance theme dark
  vau appearance scheme gruvbox
  vau appearance density comfortable
  vau appearance textFont "iA Writer Quattro"
  vau appearance snippets "wide-tables, big-headings"
  vau appearance textFont reset`,
    kind: "write",
    params: {
      key: { type: "string", description: "the setting (theme, scheme, density...); all of them when left out" },
      value: { type: "string", description: "its new value as text (dark, \"a, b\" for a list, true), or reset; left out: its value now" },
      force: { type: "boolean", description: "set a key the app doesn't list" },
    },
    args: ["key", "value"],
    run: ({ key, value: raw, force }) => {
      if (!key) return { appearance: app.vault.configWithDefaults("appearance") }
      const s = APPEARANCE[key]
      if (!s && !force) throw new OpError(`no appearance setting '${key}'. Keys: ${Object.keys(APPEARANCE).join(", ")} (force for another)`, 404)
      if (raw === undefined) return { key, value: app.vault.configWithDefaults("appearance")[key] ?? null }
      const reset = raw === "reset" || (raw === "default" && key !== "scheme")
      const parsed = reset ? null : s ? s.parse(raw) : value(raw)
      // Themes and snippets are files in the vault (.vaultite/, or an Obsidian vault's .obsidian/): they must be there.
      if (key === "scheme" && typeof parsed === "string" && parsed.startsWith("theme:") && !listThemes(app.vault).some((t) => t.name === parsed.slice(6) && !t.problem)) {
        throw new OpError(`no theme '${parsed.slice(6)}': put its folder (manifest.json and theme.css) in .vaultite/themes/`, 404)
      }
      if (key === "snippets" && Array.isArray(parsed)) {
        const have = listSnippets(app.vault).map((x) => x.name)
        for (const n of parsed) if (!have.includes(n)) throw new OpError(`no snippet '${n}': .vaultite/snippets/${n}.css isn't there`, 404)
      }
      return { appearance: app.vault.patchConfig("appearance", { [key]: parsed }) }
    },
    text: (r) => ("appearance" in r ? showLook(r.appearance) : r.value === null ? `${r.key}: (default)` : `${r.key}: ${JSON.stringify(r.value)}`),
  }, {
    id: "hotkey.list",
    cli: "hotkeys",
    summary: "The app's commands with their shortcuts (changed ones from .vaultite/hotkeys.json).",
    help: `Lists the command palette's commands and their keys: the app's defaults, and the ones changed in
.vaultite/hotkeys.json ({"<command id>": ["Mod+Shift+T"]}; [] = no shortcut). The list is read from the app's source,
so commands made while it runs (one per view) aren't in it. Without all, only commands that have keys.

  vau hotkeys
  vau hotkeys --all`,
    kind: "read",
    params: { all: { type: "boolean", description: "every command, also those without keys" } },
    run: () => {
      const cmds = commandList(vaultPlugins())
      const over = app.vault.config("hotkeys")
      const rows: Any[] = cmds.map((x) => ({ ...x, keys: x.id in over ? strings(over[x.id]) : x.keys, changed: x.id in over, defaults: x.keys }))
      for (const id of Object.keys(over)) if (!cmds.some((x) => x.id === id)) rows.push({ id, name: "(not in the app's source)", keys: strings(over[id]), changed: true, defaults: [] })
      return rows
    },
    text: (rows: Any[], p) => (p.all ? rows : rows.filter((r) => r.keys.length || r.changed))
      .map((r) => `${r.id.padEnd(24)} ${(r.keys.join(", ") || "-").padEnd(22)} ${r.name}${r.changed ? "  (changed)" : ""}${r.note ? `  (${r.note})` : ""}`).join("\n") +
      (p.all ? "" : "\n(vau hotkeys --all lists every command)"),
  }, {
    id: "hotkey.set",
    cli: "hotkey",
    summary: "Set a command's shortcut(s), remove it (none), or go back to the default (reset).",
    help: `Writes .vaultite/hotkeys.json. Keys are written like "Mod+Shift+T" (Mod is ⌘ on a Mac, Ctrl elsewhere; cmd,
option, ctrl and shift are understood). Several keys: several arguments. \`none\` leaves the command without a
shortcut; \`reset\` brings back the app's own. Browsers keep some keys (⌘N, ⌘T, ⌘W) for themselves outside the desktop app.
Ids: vau hotkeys --all.

  vau hotkey terminal:open Mod+Shift+T
  vau hotkey switcher:open Mod+O Mod+Shift+O
  vau hotkey palette:open none
  vau hotkey palette:open reset`,
    kind: "write",
    params: {
      id: { type: "string", required: true, description: "the command's id (terminal:open)" },
      keys: { type: "array", items: { type: "string" }, required: true, description: "its keys (Mod+Shift+T), or none, or reset" },
    },
    args: ["id", "keys"],
    run: ({ id, keys }) => {
      if (!keys.length) throw new OpError("give the keys (Mod+Shift+T), none, or reset")
      const known = commandList(vaultPlugins()).find((x) => x.id === id)
      const reset = keys.length === 1 && keys[0] === "reset"
      const set = keys.length === 1 && keys[0] === "none" ? [] : reset ? null : keys.map(normalizeKeys)
      const hotkeys = app.vault.patchConfig("hotkeys", { [id]: set })
      return { id, keys: set ?? known?.keys ?? [], reset, known: !!known, hotkeys }
    },
    text: (r) => (r.reset ? `${r.id}: back to the default (${r.keys.join(", ") || "none"})` : `${r.id}: ${r.keys.join(", ") || "no shortcut"}`) +
      (r.known ? "" : `\n(no command '${r.id}' in the app's source: check vau hotkeys --all)`),
  }, {
    id: "block.list",
    cli: "blocks",
    summary: "Every block a page can be made of, with what it shows and its options; or one block's options.",
    help: `Lists the blocks, by plugin, as each plugin declares them (its manifest.json; GET /api/blocks), plugins that
are off marked. With a name: that block's options, what each takes and does. Put one in any file as a fence,
\`\`\`block-<name>, options inside as YAML. Every block also takes \`wide: true\` (the whole row), \`stack: true\`
(under the one before; a fence a plugin draws keeps them after its language, \`\`\`tasks wide) and \`file: <name>\`
(drawn for another file). An option a block doesn't take, or of the wrong type, shows as a note under it while editing
and after its text in vau render. See them all, written as a page: vau docs design.

  vau blocks
  vau blocks query`,
    kind: "read",
    params: { name: { type: "string", description: "one block's name (query): its options" } },
    args: ["name"],
    run: ({ name }) => {
      const bs = app.blocks().blocks as Any[]
      if (!name) return bs
      const b = bs.find((x) => x.name === name)
      if (!b) {
        const near = closest(name, bs.map((x) => x.name))
        throw new OpError(`no block '${name}'${near ? `: did you mean ${near}?` : ""}. See them all: vau blocks`, 404)
      }
      return { ...b, common: COMMON }
    },
    text: (r: Any) => {
      if (!Array.isArray(r)) {
        const opts = Object.entries(r.options as Record<string, Any>)
        return [`${r.name} (${r.pluginName}${r.on ? "" : ", off"}): ${r.description || "not declared in its manifest.json"}`,
          opts.length ? `Options:\n${opts.map(([k, d]) => `  ${optionText(k, d).replace(/`/g, "")}`).join("\n")}` : "No options of its own.",
          `Every block also takes: ${Object.keys(COMMON).join(", ")}.`].join("\n")
      }
      const out: string[] = []
      let at = ""
      for (const b of r) {
        if (b.plugin !== at) { at = b.plugin; out.push(`${out.length ? "\n" : ""}${b.pluginName}${b.on ? "" : " (off)"}`) }
        const opts = Object.keys(b.options)
        out.push(`  ${b.name.padEnd(18)} ${b.description || "(not declared)"}${opts.length ? `  [${opts.join(", ")}]` : ""}`)
      }
      return out.join("\n")
    },
  }, {
    id: "icon.list",
    summary: "The icons a page's `icon:` can name (lucide names: the app's and its plugins').",
    kind: "read",
    run: () => pageIcons(vaultPlugins()),
    text: (r: string[]) => r.join(", ") || "(the app's list isn't known here: any lucide name may work)",
  }]
}
