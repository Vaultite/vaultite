import { useEffect, type ComponentType } from "react"
import { patch } from "@/core/http"
import { noteActivity } from "@/core/activity"
import { isDesktop, isMac as MAC } from "@/core/platform"
import { noticesSince, notifyError, type Notice } from "@/core/notify"
import { signal } from "@/core/signal"
import { trackSoon } from "@/core/unsaved"
import { guestCommand } from "@/core/share"
import { confirmDialog } from "@/components/ConfirmDialog"

export type Command = {
  id: string
  /** Sentence case, a verb first ("Open quick switcher"), never "Toggle": a setting is named as Settings names it, and
   *  what switches something else says what it does now (`on`, `nameWhenOn`). */
  name: string
  /** Shortcuts, first shown: "Mod+K" (⌘ on a Mac, Ctrl elsewhere), "Mod+Shift+F", "Mod+\\", or a sequence ("G G"). */
  keys?: string[]
  run: () => unknown
  /** It only opens or shows something: a link (in a note, or vaultite://command/<id> from another app) runs it without
   *  asking. Any other command a link names asks first. */
  fromLink?: boolean
  /** Offered only while this holds (a file is open...). */
  when?: () => boolean
  /** Its keys act only while this holds too: where the keyboard is (a note's keys only in that note), which the
   *  palette's own field would fail. */
  keysWhen?: () => boolean
  /** Only on computers (splits, the sidebar: phones have neither). */
  desktop?: boolean
  /** Its icon: a component or a name (`mic`); else its plugin's. Keep `icon` and `label` after `run`: the server reads
   *  ids, names and keys up to the first `when` or `run` (core/appsource.ts). */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }> | string
  /** Its name on a button, shorter than `name` ("New note" for "Create new note"); `name` when left out. */
  label?: string
  /** Other words the palette finds it by ("font" for a text size), each typed word starting one of them or the name's. */
  words?: string
  /** On now. Alone: a setting, named as Settings names it, drawn with a switch or a check (core/switches.ts). With
   *  `nameWhenOn`: it says what it does now, `name` while off ("Show left sidebar"), `nameWhenOn` while on. */
  on?: () => boolean
  nameWhenOn?: string
  /** A setting's place in Settings: its section's name ("Appearance") and how to go to it. */
  place?: { name: string; open: () => void }
  /** A setting of a few values (core/choices.ts): the one in use, at its row's end; running it offers the others. */
  value?: () => string
  /** Left out of the palette, where a picker offers it ("Theme…"): one value of a setting, for the menu bar, hotkeys
   *  and `vau command`. */
  unlisted?: boolean
}

export const isSetting = (c: Pick<Command, "on" | "nameWhenOn">) => !!c.on && !c.nameWhenOn
export const isOn = (c: Pick<Command, "on">) => { try { return !!c.on?.() } catch { return false } }
export const commandName = (c: Pick<Command, "name" | "on" | "nameWhenOn">) => (c.nameWhenOn && isOn(c) ? c.nameWhenOn : c.name)

const reg = new Map<string, Command>()
type Known = { id: string; name: string; keys?: string[]; nameWhenOn?: string; where?: string; icon?: Command["icon"] }
const known = new Map<string, Known>()
const commandsChanged = signal()
let list: Command[] = []
let knownList: Known[] = []
let firstSeen = new Map<string, number>()
const changed = () => { list = [...reg.values()]; knownList = [...known.values()]; firstSeen = new Map(knownList.map((k, i) => [k.id, i])); byKeys = null; commandsChanged.notify() }

export function registerCommands(cs: Command[]) {
  cs = cs.filter((c) => guestCommand(c.id))
  if (!cs.length) return () => {}
  for (const c of cs) { reg.set(c.id, c); known.set(c.id, { id: c.id, name: c.name, keys: c.keys, nameWhenOn: c.nameWhenOn, where: c.place?.name, icon: c.icon }) }
  changed()
  return () => { for (const c of cs) if (reg.get(c.id) === c) reg.delete(c.id); changed() }
}

/** Register commands while a component is mounted (again whenever `deps` change). */
export function useCommands(make: () => Command[], deps: unknown[]) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller passes the deps
  useEffect(() => registerCommands(make()), deps)
}

/** Run a command that's available now by its id ("switcher:open") or its name as the palette lists it ("Open quick
 *  switcher", any case): false if there's none (Vim's :cmd). */
export function runCommandNamed(text: string) {
  const want = text.trim().toLowerCase()
  const c = available(list).find((x) => x.id.toLowerCase() === want) ??
    available(list).find((x) => x.name.toLowerCase() === want || x.nameWhenOn?.toLowerCase() === want)
  if (c) runCommand(c)
  return !!c
}

export function runOrSay(run: () => unknown, name: string): Promise<void> {
  const failed = (e: unknown) => { console.error(e); notifyError(e, `Couldn't ${name.replace(/…$/, "").replace(/^\w/, (c) => c.toLowerCase())}`) }
  try {
    const r = run()
    if (r && typeof (r as Promise<unknown>).then === "function") return (r as Promise<unknown>).then(() => {}, failed)
  } catch (e) { failed(e) }
  return Promise.resolve()
}

/** Run a registered command by its id ("switcher:open"), if it's there and available now (`when`: editor:undo only
 *  while the keyboard isn't in a text field); whether it ran. */
export function runCommandById(id: string) {
  const c = reg.get(id)
  if (!c || !available([c]).length) return false
  runOrSay(c.run, commandName(c))
  return true
}

/** A command by its id, if it's registered and offered now (a menu made of commands: the editor's). */
export function offeredCommand(id: string): Command | null {
  const c = reg.get(id)
  return c && available([c]).length ? c : null
}

/** Call `fn` whenever commands or hotkeys change (the desktop app's menu bar follows them); returns how to stop. */
export const onCommandsChanged = commandsChanged.subscribe
/** Every command registered now, available or not (`available` says which can run). */
export const commandList = () => list

export const useCommandList = () => commandsChanged.use(() => list)
export const useKnownCommands = () => commandsChanged.use(() => knownList)
export const available = (cs: Command[]) => cs.filter((c) => {
  if (c.desktop && !isDesktop()) return false
  try { return !c.when || c.when() } catch { return false }
})

const GLYPH: Record<string, string> = MAC
  ? { Mod: "⌘", Shift: "⇧", Alt: "⌥", Ctrl: "⌃", Enter: "↵", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "esc", Backspace: "⌫" }
  : { Mod: "Ctrl", Shift: "Shift", Alt: "Alt", Ctrl: "Ctrl", Enter: "Enter", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc" }
const SHIFTED: Record<string, string> = {
  "/": "?", ";": ":", "'": "\"", ",": "<", ".": ">", "[": "{", "]": "}", "\\": "|", "`": "~", "-": "_", "=": "+",
}
/** A shortcut as the keycaps to draw: "Mod+Shift+F" -> ["⌘", "⇧", "F"]. A step without ⌘, ⌃ or ⌥ is drawn as what it
 *  types, like Vim writes it: "G G" -> ["g", "g"], "Shift+G" -> ["G"], "Shift+/" -> ["?"]; "Shift+1" -> ["⇧", "1"]. */
export const keyCaps = (keys: string) => stepsOf(canonical(keys)).flatMap((step) => {
  const parts = step.split(/\+(?!$)/)
  const key = parts[parts.length - 1]
  if (!parts.some((m) => m === "Mod" || m === "Ctrl" || m === "Alt")) {
    const shift = parts.includes("Shift")
    if (/^[A-Z]$/.test(key)) return [shift ? key : key.toLowerCase()]
    if (shift && SHIFTED[key]) return [SHIFTED[key]]
  }
  return parts.map((k) => GLYPH[k] ?? (k.length === 1 ? k.toUpperCase() : k))
})
/** Keys as text: ⌘⇧F on a Mac, Ctrl+Shift+F elsewhere (caps run together would read "CtrlO"); a sequence's steps
 *  apart ("g g"). */
export const keyHint = (keys: string) => stepsOf(canonical(keys)).map((step) => keyCaps(step).join(MAC ? "" : "+")).join(" ")
export const firstKeys = (id: string) => { const c = reg.get(id) ?? known.get(id); return c ? keysOf(c)[0] : undefined }
/** Those keys as `keyHint` writes them, "" without any: for a button's tooltip, so it never names keys of its own. */
export const commandKeys = (id: string) => { const k = firstKeys(id); return k ? keyHint(k) : "" }
/** `commandKeys`, kept up to date as commands and hotkeys change; " (⌘O)" with `paren`, "" without keys. */
export function useCommandKeys(id: string, paren = false) {
  const k = commandsChanged.use(() => commandKeys(id))
  return paren && k ? ` (${k})` : k
}

let hotkeys: Record<string, string[]> = {}
let hotkeysJson = "[{},{}]"

let seeded: Record<string, string[]> = {}

const keyMap = (saved: unknown) => {
  const out: Record<string, string[]> = {}
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    for (const [id, v] of Object.entries(saved)) if (Array.isArray(v)) out[id] = v.filter((k): k is string => typeof k === "string" && !!k)
  }
  return out
}

export function hydrateHotkeys(saved: unknown, seeds?: unknown) {
  const next = keyMap(saved), nextSeeds = keyMap(seeds)
  const json = JSON.stringify([next, nextSeeds])
  if (json === hotkeysJson) return
  hotkeys = next
  seeded = nextSeeds
  hotkeysJson = json
  changed()
}

/** A command's keys in effect: the vault's hotkeys.json if it names the command, else another app's (`seeded`), else its
 *  own defaults and the keys plugins add to it (`addKeys`). */
export const keysOf = (c: { id: string; keys?: string[] }) => hotkeys[c.id] ?? seeded[c.id] ?? (extra.has(c.id) ? [...(c.keys ?? []), ...extra.get(c.id)!] : c.keys ?? [])

let extra = new Map<string, string[]>()
const adders = new Map<string, Record<string, string[]>>()
/** Give commands more default keys, by command id, under `owner` (a plugin's id); null takes them away. The vault's
 *  hotkeys.json still wins for a command it names. */
export function addKeys(owner: string, keys: Record<string, string[]> | null) {
  if (keys) adders.set(owner, keys)
  else if (!adders.delete(owner)) return
  const next = new Map<string, string[]>()
  for (const m of adders.values()) for (const [id, ks] of Object.entries(m)) next.set(id, [...(next.get(id) ?? []), ...ks])
  extra = next
  changed()
}
export const isCustom = (id: string) => id in hotkeys
export const isSeeded = (id: string) => !(id in hotkeys) && id in seeded

export function setHotkeys(id: string, keys: string[] | null) {
  const next = { ...hotkeys }
  if (keys === null) delete next[id]
  else next[id] = keys
  hotkeys = next
  hotkeysJson = JSON.stringify([next, seeded])
  changed()
  return patch("config/hotkeys", { [id]: keys }).then(() => {}, () => { /* offline: it applies here meanwhile */ })
}

// What a key types changes with ⌥ (⌥N is ˜) and ⇧ (⇧/ is ?), so those name the physical key instead.
const CODES: Record<string, string> = {
  Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'",
  Comma: ",", Period: ".", Slash: "/",
}
const codeKey = (code: string) => (/^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : CODES[code])
const MODIFIERS = new Set(["Meta", "Control", "Alt", "Shift", "CapsLock", "Fn", "OS"])

function keyName(e: KeyboardEvent) {
  if (MODIFIERS.has(e.key)) return ""
  if (e.key === " " || e.code === "Space") return "Space"
  const byCode = codeKey(e.code)
  if (byCode && (e.altKey || (e.shiftKey && !/^[a-z]$/i.test(e.key)))) return byCode
  return e.key.length === 1 ? e.key.toUpperCase() : e.key
}

const ALIASES: Record<string, string> = { cmd: "Mod", command: "Mod", meta: "Mod", mod: "Mod", ctrl: "Ctrl", control: "Ctrl", alt: "Alt", option: "Alt", opt: "Alt", shift: "Shift" }

export function canonical(keys: string) {
  return stepsOf(keys).map(canonicalStep).join(" ")
}
const stepsOf = (keys: string) => keys.trim().split(/ +/).filter(Boolean)
const NAMED = new Map(["Space", "Enter", "Escape", "Tab", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].map((k) => [k.toLowerCase(), k]))
function canonicalStep(keys: string) {
  const parts = keys.split(/\+(?!$)/)
  const key = parts.pop() ?? ""
  const mods = new Set(parts.map((m) => ALIASES[m.toLowerCase()] ?? m).map((m) => (!MAC && m === "Ctrl" ? "Mod" : m)))
  return [...["Mod", "Ctrl", "Alt", "Shift"].filter((m) => mods.has(m)), key.length === 1 ? key.toUpperCase() : NAMED.get(key.toLowerCase()) ?? key].join("+")
}
export const sameKeys = (a: string, b: string) => canonical(a).toLowerCase() === canonical(b).toLowerCase()

export function shortcutOf(e: KeyboardEvent) {
  const key = keyName(e)
  // AltGr types (⌃⌥7 is "{" on a German layout): never a shortcut.
  if (!key || (!MAC && e.getModifierState?.("AltGraph"))) return ""
  const mods = [(MAC ? e.metaKey : e.ctrlKey) && "Mod", MAC && e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean)
  return [...mods, key].join("+")
}

let byKeys: Map<string, { c: Command; steps: string[] }[]> | null = null
function table() {
  if (!byKeys) {
    byKeys = new Map()
    const missing = Object.keys(hotkeys).filter((id) => !reg.has(id)).map(standIn)
    for (const c of [...list, ...missing]) for (const keys of new Set(keysOf(c).map((x) => canonical(x).toLowerCase()))) {
      const steps = stepsOf(keys)
      if (steps.length) byKeys.set(steps[0], [...(byKeys.get(steps[0]) ?? []), { c, steps }])
    }
  }
  return byKeys
}

let whyMissing: ((id: string) => (() => void) | null) | null = null
export const setMissingCommand = (fn: typeof whyMissing) => { whyMissing = fn; byKeys = null }
const standIns = new WeakSet<Command>()
function standIn(id: string): Command {
  const c: Command = { id, name: known.get(id)?.name ?? id, run: () => whyMissing?.(id)?.(), when: () => !!whyMissing?.(id) }
  standIns.add(c)
  return c
}

const keysReach = (c: Command) => { try { return !c.keysWhen || c.keysWhen() } catch { return false } }

function matching(steps: string[]) {
  const exact: Command[] = [], longer: { c: Command; steps: string[] }[] = []
  for (const b of table().get(steps[0]) ?? []) {
    if (b.steps.length < steps.length || steps.some((s, i) => b.steps[i] !== s)) continue
    if (!available([b.c]).length || !keysReach(b.c)) continue
    if (b.steps.length === steps.length) exact.push(b.c)
    else longer.push(b)
  }
  const seen = (c: Command) => firstSeen.get(c.id) ?? Infinity
  exact.sort((a, b) => Number(!a.when) - Number(!b.when) || seen(a) - seen(b))
  return { exact, longer }
}

/** Where keys type: a text field, an editor, a terminal (contenteditable, or a field you type text in), or a widget
 *  that keeps its keys, marked `data-keeps-keys` (a remote screen takes every key, a drawing its tools' letters). */
export function typingIn(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.closest("[data-keeps-keys]")) return true
  return el.tagName === "INPUT" && !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/i.test((el as HTMLInputElement).type)
}
const typed = (step: string) => (!/(^|\+)(mod|ctrl|alt)\+/.test(step) && !/(^|\+)f\d\d?$/.test(step)) || (MAC && /^ctrl\+(shift\+)?[a-z]$/.test(step))
const FIELD_KEYS = new Set(["mod+a", "mod+backspace", "alt+backspace", "mod+delete", "alt+delete"])

type Pending = { steps: string[]; exact: Command | null }
let pending: Pending | null = null
let pendingTimer = 0
const pendingSubs = signal()
const WAIT = 1000
trackSoon("key sequence", () => !!pending?.exact)
function setPending(p: Pending | null) {
  clearTimeout(pendingTimer)
  pending = p
  if (p?.exact) { const c = p.exact; pendingTimer = window.setTimeout(() => { setPending(null); ran(c); c.run() }, WAIT) }
  pendingSubs.notify()
}
/** The sequence under way (its steps so far), or null: for the keys hint. */
export const usePendingKeys = () => pendingSubs.use(() => pending?.steps ?? null)
/** Stop the sequence under way. */
export const cancelKeys = () => { if (pending) setPending(null) }
/** Start a sequence from code, as if its first steps were pressed: an editor that keeps its keys (Vim's Space in normal
 *  mode) hands the rest to the app. Answers whether any command goes on from them. */
export function beginKeys(keys: string) {
  const steps = stepsOf(canonical(keys).toLowerCase())
  const { exact, longer } = matching(steps)
  if (!longer.length) { setPending(null); if (exact[0]) { ran(exact[0]); exact[0].run() } return !!exact[0] }
  setPending({ steps, exact: exact[0] ?? null })
  return true
}
export function nextKeys(steps: string[]) {
  const out = new Map<string, Command[]>()
  for (const { c, steps: s } of matching(steps).longer) {
    const next = s[steps.length]
    out.set(next, [...(out.get(next) ?? []), c])
  }
  return [...out].map(([step, cs]) => ({ step, commands: cs, last: cs.every((c) => keysOf(c).some((k) => stepsOf(canonical(k).toLowerCase()).length === steps.length + 1)) }))
}

function intent(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return null
  const step = shortcutOf(e)
  if (!step) return null
  const k = canonical(step).toLowerCase()
  if (!pending && (typed(k) || FIELD_KEYS.has(k)) && typingIn(e.target)) return null
  const steps = pending ? [...pending.steps, k] : [k]
  const { exact, longer } = matching(steps)
  if (!exact.length && !longer.length) return pending ? { steps, cancel: true as const } : null
  return { steps, exact: exact[0] ?? null, longer: longer.length > 0 }
}

/** The first steps of the commands' keys that hold ⌘, ⌃ or ⌥: what a widget keeping the keyboard outside the page (the
 *  desktop Browser) hands back as keydowns for `runShortcut`. */
export const modifiedSteps = () => [...table().keys()].filter((s) => /(^|\+)(mod|ctrl|alt)\+/.test(s))

/** A command that's available now has these keys, or a sequence goes on with them: a key the app would take (a
 *  terminal lets these through to it). */
export const appShortcut = (e: KeyboardEvent) => !!intent(e)
export const runsCommand = (e: KeyboardEvent) => { const it = intent(e); return !!it && !("cancel" in it) && !!it.exact && !it.longer && !pending }

/** Take a keydown if the app's keys have it (a command, or a sequence step): true if taken. Widgets that stop keys from
 *  reaching the app (Excalidraw) call it first in capture and stop the event when true. */
export function runShortcut(e: KeyboardEvent) {
  if (pending && !e.defaultPrevented && e.key === "Backspace") {
    e.preventDefault(); e.stopPropagation()
    setPending(pending.steps.length > 1 ? { steps: pending.steps.slice(0, -1), exact: null } : null)
    return true
  }
  const it = intent(e)
  if (!it) return false
  e.preventDefault()
  if (pending) e.stopPropagation()
  if ("cancel" in it) { setPending(null); return true }
  if (it.exact && !it.longer) { setPending(null); ran(it.exact); it.exact.run(); return true }
  setPending({ steps: it.steps, exact: it.exact })
  return true
}

addEventListener("keydown", (e) => { if (pending) runShortcut(e) }, true)
addEventListener("keydown", (e) => { runShortcut(e) })
addEventListener("pointerdown", () => cancelKeys(), true)

const ran = (c: Command) => { if (!QUIET.has(c.id) && !standIns.has(c)) noteActivity("command", `Ran ${commandName(c)}`) }
const QUIET = new Set(["palette:open", "switcher:open", "tab:search"])

const RECENT = "vaultite.recentCommands"
export function recentCommands(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] }
}
export function runCommand(c: Command) {
  try { localStorage.setItem(RECENT, JSON.stringify([c.id, ...recentCommands().filter((x) => x !== c.id)].slice(0, 5))) } catch { /* private mode */ }
  ran(c)
  runOrSay(c.run, commandName(c))
}

export async function runCommandAsked(id: string, ms = 1500): Promise<false | { notices: Notice[] }> {
  const c = available(list).find((x) => x.id === id)
  if (!c) return false
  const from = Date.now()
  await Promise.race([runOrSay(c.run, commandName(c)), new Promise((done) => setTimeout(done, ms))])
  await new Promise((done) => setTimeout(done, 150))
  return { notices: noticesSince(from) }
}

export function runCommandId(id: string) {
  const c = available(list).find((x) => x.id === id)
  if (c) runOrSay(c.run, commandName(c))
  return !!c
}

export function runCommandLink(id: string) {
  const c = available(list).find((x) => x.id === id)
  if (!c) return false
  const name = commandName(c)
  if (c.fromLink) runOrSay(c.run, name)
  else void confirmDialog({ title: `${name.replace(/…$/, "")}?`, body: "A link asks to run this command.", confirm: "Run" }).then((ok) => { if (ok) runOrSay(c.run, name) })
  return true
}
