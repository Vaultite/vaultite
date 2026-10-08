// A new tab's sections and buttons (core/newtab.ts). Each change writes only its own key, so the others stay as they
// are on disk.
import type { App } from "../app.ts"
import { commandList, type CommandDef, panelsOf, sectionsOf } from "../appsource.ts"
import { CORE_SECTIONS, readNewTab, type SectionInfo, shownActions, shownSections, withIcon, withPanels } from "../newtab.ts"
import { type Op, OpError, type Param } from "../ops.ts"
import { anchorFor, placeKey } from "../slots.ts"
import { type Any, lines } from "./common.ts"
import { onOff, pluginList } from "./plugins.ts"

export type Section = SectionInfo & { plugin: string; on: boolean
  /** Its place on the page (from 1), or null: hidden. */
  place: number | null }
export type Button = { id: string; name: string; place: number
  /** In the app's source (`vau hotkeys --all`): one that isn't (a made-up id, a plugin's gone) isn't drawn. */
  known: boolean
  /** The icon newtab.json gives it, over its command's. */
  icon?: string }

/** Every section there is (the app's, then the plugins', on or off), the shown ones first in their order. */
export function sectionList(app: App): { setup: ReturnType<typeof readNewTab>; sections: Section[]; buttons: Button[] } {
  const plugins = pluginList(app)
  const { on } = onOff(plugins, app.vault.config("plugins"))
  const defs: Section[] = withPanels([
    ...CORE_SECTIONS.map((s) => ({ ...s, plugin: "core", on: true, place: null })),
    ...plugins.flatMap(sectionsOf).map((d) => ({ key: d.key, title: d.title, sort: d.sort, hidden: d.hidden, ...(d.only ? { only: d.only } : {}), plugin: d.plugin, on: on(d.plugin), place: null })),
  ], plugins.flatMap(panelsOf).map((d) => ({ key: d.key, title: d.title, plugin: d.plugin, on: on(d.plugin), place: null })))
  const setup = readNewTab(app.vault.config("newtab"))
  const shown = shownSections(setup, defs)
  const byKey = new Map(defs.map((d) => [d.key, d]))
  const first = shown.flatMap((k, i) => (byKey.has(k) ? [{ ...byKey.get(k)!, place: i + 1 }] : []))
  const rest = defs.filter((d) => !shown.includes(d.key)).sort((a, b) => (a.sort ?? 100) - (b.sort ?? 100))
  const cmds = new Map(commandList(plugins.filter((p) => p.tier === "vault")).map((c) => [c.id, c]))
  const buttons = shownActions(setup).map((id, i) => ({ id, name: cmds.get(id)?.name ?? id, place: i + 1, known: cmds.has(id), ...(setup.icons?.[id] ? { icon: setup.icons[id] } : {}) }))
  return { setup, sections: [...first, ...rest], buttons }
}

function showList(r: { sections: Section[]; buttons: Button[] }) {
  const note = (s: Section) => [s.panel && "a sidebar panel", s.only && `${s.only === "phone" ? "phones" : "computers"} only`, !s.on && "plugin off"].filter(Boolean).join(", ")
  const row = (s: Section) => `${s.key} (${s.title})${note(s) ? `  (${note(s)})` : ""}`
  const shown = r.sections.filter((s) => s.place)
  const hidden = r.sections.filter((s) => !s.place)
  return [
    "Sections, top to bottom:", lines(shown.map((s) => `  ${s.place}. ${row(s)}`), "  (none: an empty page)"),
    `Hidden: ${hidden.map(row).join(", ") || "none"}`,
    "Buttons (core:actions):", lines(r.buttons.map((b) => `  ${b.place}. ${b.id} (${b.name})${b.icon ? `  (icon: ${b.icon})` : ""}${b.known ? "" : "  (not in the app's source)"}`), "  (none)"),
  ].join("\n")
}

const norm = (s: string | undefined) => (s ?? "").toLowerCase().trim().replace(/[\s_-]+/g, " ")

/** A section by its key, title, its name in its plugin, or its plugin's id when that has one ("buttons", "terminals"). */
function namedSection(list: Section[], q: string) {
  const low = norm(q)
  const hit = list.find((s) => s.key === q) ?? list.find((s) => norm(s.title) === low) ?? list.find((s) => norm(s.key.split(":")[1]) === low) ??
    list.find((s) => s.plugin === low && list.filter((x) => x.plugin === low).length === 1)
  if (!hit) throw new OpError(`no new tab section '${q}'. Sections: ${list.map((s) => `${s.key} (${s.title})`).join(", ")}`, 404)
  return hit
}

/** A command by its id or its name as the palette lists it; an id that isn't in the source is taken as it is. */
function namedCommand(cmds: CommandDef[], q: string) {
  const hit = cmds.find((c) => c.id === q) ?? cmds.find((c) => norm(c.name) === norm(q))
  if (hit) return hit.id
  if (/^[\w-]+:[\w:-]+$/.test(q)) return q
  throw new OpError(`no command '${q}': give its id or its name (vau hotkeys --all lists them)`, 404)
}

const SECTION: Param = { type: "string", required: true, description: "the section: its key (core:actions), title or a plain name (buttons, terminals)" }
const COMMAND: Param = { type: "string", required: true, description: "the command: its id (file:new) or its name in the palette (Create new note)" }
const TO: Param = { type: "string", description: "where: a position from 1, up, down, top or bottom (left out: the end)" }

const HELP = `A blank tab (a new tab, ⌘T) shows sections, top to bottom, kept in .vaultite/newtab.json:
{"sections": [keys], "actions": [command ids]}. A section is the app's (core:actions the buttons, core:opened the files
opened lately in the workspace, core:changed the vault's recently changed files) or a plugin's (terminal:sessions the
running terminals and agents, pages:tiles the pinned pages on phones) or any sidebar panel by its key (files:files,
recent:recent, activity:feed: vau panels lists them), drawn as in the sidebar; one left out is hidden. Each button of
core:actions is a palette command: its name, icon and shortcut are the command's (vau hotkeys --all lists them; a
button whose command isn't there now, its plugin off, isn't drawn). "icons": {command id: name} gives a button another
icon (a Lucide name, lucide.dev/icons, or an emoji; vau newtab button icon, or right-click it in the app). Unset, the page is every section not hidden by
default, by its place, and the buttons are New note, Open a file and the command palette (vau settings set newtab
'{"sections": null}' goes back to that). Positions count from 1.

  vau newtab
  vau newtab show terminals top
  vau newtab show "recent files"
  vau newtab hide "recently changed"
  vau newtab move buttons 2
  vau newtab button add terminal:claude top
  vau newtab button add "Open Claude Code"
  vau newtab button remove palette:open
  vau newtab button move file:new up
  vau newtab button icon audio-recorder:voice-note mic
  vau newtab button icon audio-recorder:voice-note ""   (its command's icon again)`

export function newTabOps(app: App): Op[] {
  const cmds = () => commandList(pluginList(app).filter((p) => p.tier === "vault"))
  /** Write one key (`sections`, `actions` or `icons`) and answer with the page after. */
  const write = (key: "sections" | "actions" | "icons", list: string[] | Record<string, string> | null) => {
    app.vault.patchConfig("newtab", { [key]: list })
    return sectionList(app)
  }
  const result = { text: (r: Any) => showList(r) }
  const section = (id: string, cli: string, summary: string, args: string[], params: Record<string, Param>, fn: (shown: string[], s: Section, given: Any) => string[]): Op => ({
    id, cli, summary, help: `${summary} See vau newtab --help.`, kind: "write", params: { section: SECTION, ...params }, args: ["section", ...args],
    run: (given) => {
      const { sections } = sectionList(app)
      const shown = sections.filter((s) => s.place).map((s) => s.key)
      return write("sections", fn(shown, namedSection(sections, given.section), given))
    },
    ...result,
  })
  const button = (id: string, cli: string, summary: string, args: string[], params: Record<string, Param>, fn: (list: string[], cmd: string, given: Any) => string[]): Op => ({
    id, cli, summary, help: `${summary} See vau newtab --help.`, kind: "write", params: { command: COMMAND, ...params }, args: ["command", ...args],
    run: (given) => write("actions", fn(sectionList(app).buttons.map((b) => b.id), namedCommand(cmds(), given.command), given)),
    ...result,
  })
  /** `key` put at `where` in `list` (left out: the end). */
  const at = (list: string[], key: string, where: string | undefined) => {
    const before = where === undefined ? null : anchorFor(list, key, where)
    if (before === undefined) throw new OpError(`'${where}' isn't a position (a number from 1, up, down, top or bottom)`)
    return placeKey(list, key, before)
  }
  const shownOnly = (list: string[], key: string, what: string) => {
    if (!list.includes(key)) throw new OpError(`${what} isn't on the page: show or add it first`)
  }

  return [{
    id: "newtab.list",
    cli: "newtab",
    summary: "A new tab's page: its sections in order, the hidden ones, and its buttons.",
    help: HELP,
    kind: "read",
    params: {},
    run: () => sectionList(app),
    ...result,
  },
  section("newtab.show", "newtab show", "Show a section on a new tab's page (at the end, or at a position).", ["to"], { to: TO },
    (shown, s, { to }) => (shown.includes(s.key) && to === undefined ? shown : at(shown, s.key, to))),
  section("newtab.hide", "newtab hide", "Hide a section of a new tab's page.", [], {}, (shown, s) => shown.filter((k) => k !== s.key)),
  section("newtab.move", "newtab move", "Move a section of a new tab's page: to a position (from 1), up, down, top or bottom.", ["to"], { to: { ...TO, required: true } },
    (shown, s, { to }) => { shownOnly(shown, s.key, s.title); return at(shown, s.key, to) }),
  button("newtab.button.add", "newtab button add", "Add a button (a palette command) to a new tab's page (at the end, or at a position).", ["to"], { to: TO },
    (list, cmd, { to }) => (list.includes(cmd) && to === undefined ? list : at(list, cmd, to))),
  {
    id: "newtab.button.icon", cli: "newtab button icon", kind: "write",
    summary: "Give a button of a new tab's page an icon of its own (a Lucide name or an emoji; empty: its command's again).",
    help: "Give a button of a new tab's page an icon of its own, kept in newtab.json's icons. See vau newtab --help.",
    params: { command: COMMAND, icon: { type: "string", required: true, description: "a Lucide icon's name (mic, lucide.dev/icons) or an emoji; empty for the command's own" } },
    args: ["command", "icon"],
    run: (given) => {
      const name = String(given.icon ?? "").trim()
      if (name && !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name) && !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(name))
        throw new OpError(`'${name}' isn't an icon's name: a Lucide name in lowercase with dashes (mic, file-text) or an emoji`)
      const { setup, buttons } = sectionList(app)
      const cmd = namedCommand(cmds(), given.command)
      if (name) shownOnly(buttons.map((b) => b.id), cmd, cmd)
      return write("icons", withIcon(setup.icons, cmd, name))
    },
    ...result,
  },
  button("newtab.button.remove", "newtab button remove", "Remove a button from a new tab's page.", [], {}, (list, cmd) => list.filter((k) => k !== cmd)),
  button("newtab.button.move", "newtab button move", "Move a button of a new tab's page: to a position (from 1), up, down, top or bottom.", ["to"], { to: { ...TO, required: true } },
    (list, cmd, { to }) => { shownOnly(list, cmd, cmd); return at(list, cmd, to) })]
}
