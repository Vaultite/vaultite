// Commands, listed in the palette with their keys; a command's `keys` also bind it, so shortcut and entry can't drift.
// Sequences ("Space F F") go first in capture; unmodified steps never start one while typing (`typingIn`).
import { useEffect, useSyncExternalStore, type ComponentType } from "react"
import { patch } from "@/core/http"
import { noteActivity } from "@/core/activity"
import { isMac as MAC } from "@/core/platform"
import { notifyError } from "@/core/notify"
import { signal } from "@/core/signal"

export type Command = {
  id: string
  /** Sentence case, a verb first: "Toggle reading view". */
  name: string
  /** Shortcuts, first shown: "Mod+K" (⌘ on a Mac, Ctrl elsewhere), "Mod+Shift+F", "Mod+\\", or a sequence ("G G"). */
  keys?: string[]
  run: () => unknown
  /** Offered only while this holds (a file is open...). */
  when?: () => boolean
  /** Only on computers (splits, the sidebar: phones have neither). */
  desktop?: boolean
  /** Its icon: a component or a name (`mic`); else its plugin's. Keep `icon` and `label` after `run`: the server reads
   *  ids, names and keys up to the first `when` or `run` (core/appsource.ts). */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }> | string
  /** Its name on a button, shorter than `name` ("New note" for "Create new note"); `name` when left out. */
  label?: string
}

const reg = new Map<string, Command>()
/** Every command registered since the page loaded, still there or not (Settings > Hotkeys lists them all: a file's
 *  commands come and go with its tab). */
const known = new Map<string, { id: string; name: string; keys?: string[] }>()
const subs = new Set<() => void>()
let list: Command[] = []
let knownList: { id: string; name: string; keys?: string[] }[] = []
const changed = () => { list = [...reg.values()]; knownList = [...known.values()]; byKeys = null; subs.forEach((f) => f()) }

/** Add commands (the same id replaces the older one); returns how to take them away again. */
export function registerCommands(cs: Command[]) {
  for (const c of cs) { reg.set(c.id, c); known.set(c.id, { id: c.id, name: c.name, keys: c.keys }) }
  changed()
  return () => { for (const c of cs) if (reg.get(c.id) === c) reg.delete(c.id); changed() }
}

/** Register commands while a component is mounted (again whenever `deps` change). */
export function useCommands(make: () => Command[], deps: unknown[]) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => registerCommands(make()), deps)
}

/** Run a command that's available now by its id ("switcher:open") or its name as the palette lists it ("Open quick
 *  switcher", any case): false if there's none (Vim's :cmd). */
export function runCommandNamed(text: string) {
  const want = text.trim().toLowerCase()
  const c = available(list).find((x) => x.id.toLowerCase() === want) ?? available(list).find((x) => x.name.toLowerCase() === want)
  if (c) runCommand(c)
  return !!c
}

/** Run what a command or a menu item does, at once (it may need the click's user activation): one that throws or
 *  rejects says so in a toast rather than doing nothing (its error still reaches Errors through the console). */
export function runOrSay(run: () => unknown, name: string) {
  const failed = (e: unknown) => { console.error(e); notifyError(e, `Couldn't ${name.replace(/…$/, "").replace(/^\w/, (c) => c.toLowerCase())}`) }
  try {
    const r = run()
    if (r && typeof (r as Promise<unknown>).then === "function") (r as Promise<unknown>).then(undefined, failed)
  } catch (e) { failed(e) }
}

/** Run a registered command by its id ("switcher:open"), if it's there and available now (`when`: editor:undo only
 *  while the keyboard isn't in a text field); whether it ran. */
export function runCommandById(id: string) {
  const c = reg.get(id)
  if (!c || !available([c]).length) return false
  runOrSay(c.run, c.name)
  return true
}

/** A command by its id, if it's registered and offered now (a menu made of commands: the editor's). */
export function offeredCommand(id: string): Command | null {
  const c = reg.get(id)
  return c && available([c]).length ? c : null
}

/** Call `fn` whenever commands or hotkeys change (the desktop app's menu bar follows them); returns how to stop. */
export const onCommandsChanged = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } }
/** Every command registered now, available or not (`available` says which can run). */
export const commandList = () => list

export const useCommandList = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => list)
/** Every command seen since the page loaded (for Settings > Hotkeys). */
export const useKnownCommands = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => knownList)
export const available = (cs: Command[]) => cs.filter((c) => {
  if (c.desktop && !matchMedia("(min-width: 768px)").matches) return false
  try { return !c.when || c.when() } catch { return false }
})

const GLYPH: Record<string, string> = MAC
  ? { Mod: "⌘", Shift: "⇧", Alt: "⌥", Ctrl: "⌃", Enter: "↵", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "esc" }
  : { Mod: "Ctrl", Shift: "Shift", Alt: "Alt", Ctrl: "Ctrl", Enter: "↵", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "esc" }
/** A shortcut as the keycaps to draw: "Mod+Shift+F" -> ["⌘", "⇧", "F"]. */
// What ⇧ types on the keys a shortcut names by their place (a US layout), for a step drawn as what it types.
const SHIFTED: Record<string, string> = {
  "/": "?", ";": ":", "'": "\"", ",": "<", ".": ">", "[": "{", "]": "}", "\\": "|", "`": "~", "-": "_", "=": "+",
  "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*", "9": "(", "0": ")",
}
/** A shortcut as the keycaps to draw: "Mod+Shift+F" -> ["⌘", "⇧", "F"]. A step without ⌘, ⌃ or ⌥ is drawn as what it
 *  types, like Vim writes it: "G G" -> ["g", "g"], "Shift+G" -> ["G"], "Shift+/" -> ["?"], "Space" -> ["Space"]. */
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
/** A command's first keys in effect ("Mod+O": hotkeys.json's, else its defaults); undefined without any. */
export const firstKeys = (id: string) => { const c = reg.get(id) ?? known.get(id); return c ? keysOf(c)[0] : undefined }
/** Those keys as `keyHint` writes them, "" without any: for a button's tooltip, so it never names keys of its own. */
export const commandKeys = (id: string) => { const k = firstKeys(id); return k ? keyHint(k) : "" }
/** `commandKeys`, kept up to date as commands and hotkeys change; " (⌘O)" with `paren`, "" without keys. */
export function useCommandKeys(id: string, paren = false) {
  useKnownCommands()
  const k = commandKeys(id)
  return paren && k ? ` (${k})` : k
}

// ---------- hotkeys (.vaultite/hotkeys.json) ----------
let hotkeys: Record<string, string[]> = {}
let hotkeysJson = "{}"

/** The vault's hotkeys arrived (in /api/state, `config.hotkeys`). */
export function hydrateHotkeys(saved: unknown) {
  const next: Record<string, string[]> = {}
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    for (const [id, v] of Object.entries(saved)) if (Array.isArray(v)) next[id] = v.filter((k): k is string => typeof k === "string" && !!k)
  }
  const json = JSON.stringify(next)
  if (json === hotkeysJson) return
  hotkeys = next
  hotkeysJson = json
  changed()
}

/** A command's keys in effect: the vault's hotkeys.json if it names the command, else its own defaults and the keys
 *  plugins add to it (`addKeys`). */
export const keysOf = (c: { id: string; keys?: string[] }) => hotkeys[c.id] ?? (extra.has(c.id) ? [...(c.keys ?? []), ...extra.get(c.id)!] : c.keys ?? [])

// Keys a plugin gives other commands while it's on (Vim: "Space F F" for Open quick switcher), on top of their own.
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
/** Whether hotkeys.json sets this command's keys. */
export const isCustom = (id: string) => id in hotkeys

/** Set a command's keys (null: back to its defaults), in hotkeys.json: only that command's line changes (PATCH). */
export function setHotkeys(id: string, keys: string[] | null) {
  const next = { ...hotkeys }
  if (keys === null) delete next[id]
  else next[id] = keys
  hotkeys = next
  hotkeysJson = JSON.stringify(next)
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

/** The key of a keydown, as a shortcut names it ("T", "/", "ArrowLeft", "Space"); "" for a modifier alone. */
function keyName(e: KeyboardEvent) {
  if (MODIFIERS.has(e.key)) return ""
  if (e.key === " " || e.code === "Space") return "Space"
  const byCode = codeKey(e.code)
  if (byCode && (e.altKey || (e.shiftKey && !/^[a-z]$/i.test(e.key)))) return byCode
  return e.key.length === 1 ? e.key.toUpperCase() : e.key
}

// Other spellings a hand-written hotkeys.json may use.
const ALIASES: Record<string, string> = { cmd: "Mod", command: "Mod", meta: "Mod", mod: "Mod", ctrl: "Ctrl", control: "Ctrl", alt: "Alt", option: "Alt", opt: "Alt", shift: "Shift" }

/** A shortcut in one spelling, to compare two: modifiers in order (Mod, Ctrl, Alt, Shift), the key capitalised. Off a
 *  Mac, Ctrl is Mod; "Cmd" and "Option" are Mod and Alt. */
export function canonical(keys: string) {
  return stepsOf(keys).map(canonicalStep).join(" ")
}
/** A sequence's steps: "Ctrl+W L" -> ["Ctrl+W", "L"]. */
const stepsOf = (keys: string) => keys.trim().split(/ +/).filter(Boolean)
// Keys with names, as a hand-written hotkeys.json (or a lower-cased sequence) may spell them.
const NAMED = new Map(["Space", "Enter", "Escape", "Tab", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].map((k) => [k.toLowerCase(), k]))
function canonicalStep(keys: string) {
  const parts = keys.split(/\+(?!$)/)
  const key = parts.pop() ?? ""
  const mods = new Set(parts.map((m) => ALIASES[m.toLowerCase()] ?? m).map((m) => (!MAC && m === "Ctrl" ? "Mod" : m)))
  return [...["Mod", "Ctrl", "Alt", "Shift"].filter((m) => mods.has(m)), key.length === 1 ? key.toUpperCase() : NAMED.get(key.toLowerCase()) ?? key].join("+")
}
/** Two shortcuts are the same keys. */
export const sameKeys = (a: string, b: string) => canonical(a).toLowerCase() === canonical(b).toLowerCase()

/** The shortcut a keydown is ("Mod+Shift+T"), or "" while only modifiers are down. */
export function shortcutOf(e: KeyboardEvent) {
  const key = keyName(e)
  if (!key) return ""
  const mods = [(MAC ? e.metaKey : e.ctrlKey) && "Mod", MAC && e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean)
  return [...mods, key].join("+")
}

// ---------- pressing keys ----------
/** Every command's keys as steps (canonical, lower case), made when commands or hotkeys change: every keystroke typed
 *  comes here, so a key is looked up before any command's `when` is asked. */
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

// A command hotkeys.json binds that isn't here: its keys say why when its plugin is off or waits to be allowed.
let whyMissing: ((id: string) => (() => void) | null) | null = null
/** How to say why a bound command isn't here: a function that says it, or null (nothing to say: it comes with a tab). */
export const setMissingCommand = (fn: typeof whyMissing) => { whyMissing = fn; byKeys = null }
const standIns = new WeakSet<Command>()
function standIn(id: string): Command {
  const c: Command = { id, name: known.get(id)?.name ?? id, run: () => whyMissing?.(id)?.(), when: () => !!whyMissing?.(id) }
  standIns.add(c)
  return c
}

/** The commands available now whose keys are these steps (`exact`) or start with them (`longer`). */
function matching(steps: string[]) {
  const exact: Command[] = [], longer: { c: Command; steps: string[] }[] = []
  for (const b of table().get(steps[0]) ?? []) {
    if (b.steps.length < steps.length || steps.some((s, i) => b.steps[i] !== s)) continue
    if (!available([b.c]).length) continue
    if (b.steps.length === steps.length) exact.push(b.c)
    else longer.push(b)
  }
  return { exact, longer }
}

/** Where keys type: a text field, an editor, a terminal (contenteditable, or a field you type text in), or a widget
 *  that keeps its keys, marked `data-keeps-keys` (a remote screen takes every key, a drawing its tools' letters). */
export function typingIn(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.closest("[data-keeps-keys]")) return true
  return el.tagName === "INPUT" && !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/i.test((el as HTMLInputElement).type)
}
/** A step that a text field, an editor or a terminal keeps: one without ⌘, ⌃ or ⌥ types (but a function key never
 *  does), and on a Mac ⌃ and a letter edits the line (a shell's ⌃W, ⌃U). */
const typed = (step: string) => (!/(^|\+)(mod|ctrl|alt)\+/.test(step) && !/(^|\+)f\d\d?$/.test(step)) || (MAC && /^ctrl\+(shift\+)?[a-z]$/.test(step))

/** A sequence under way: its steps so far, and the command they already name when longer ones go on from it (run when
 *  nothing follows in time, like Vim's `timeoutlen`). */
type Pending = { steps: string[]; exact: Command | null }
let pending: Pending | null = null
let pendingTimer = 0
const pendingSubs = signal()
const WAIT = 1000
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
/** What can follow the sequence under way: each next step, with the commands it leads to. */
export function nextKeys(steps: string[]) {
  const out = new Map<string, Command[]>()
  for (const { c, steps: s } of matching(steps).longer) {
    const next = s[steps.length]
    out.set(next, [...(out.get(next) ?? []), c])
  }
  return [...out].map(([step, cs]) => ({ step, commands: cs, last: cs.every((c) => keysOf(c).some((k) => stepsOf(canonical(k).toLowerCase()).length === steps.length + 1)) }))
}

/** What this keydown would do: run a command, go on with a sequence, or nothing (null). */
function intent(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return null
  const step = shortcutOf(e)
  if (!step) return null
  const k = canonical(step).toLowerCase()
  if (!pending && typed(k) && typingIn(e.target)) return null
  const steps = pending ? [...pending.steps, k] : [k]
  const { exact, longer } = matching(steps)
  if (!exact.length && !longer.length) return pending ? { steps, cancel: true as const } : null
  return { steps, exact: exact[0] ?? null, longer: longer.length > 0 }
}

/** The first steps of the commands' keys that hold ⌘, ⌃ or ⌥: what a widget keeping the keyboard outside the page (the
 *  desktop web viewer) hands back as keydowns for `runShortcut`. */
export const modifiedSteps = () => [...table().keys()].filter((s) => /(^|\+)(mod|ctrl|alt)\+/.test(s))

/** A command that's available now has these keys, or a sequence goes on with them: a key the app would take (a
 *  terminal lets these through to it). */
export const appShortcut = (e: KeyboardEvent) => !!intent(e)

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

// A sequence under way takes the next key before anything else (an editor would type it); otherwise keys come here
// after the page had its turn.
addEventListener("keydown", (e) => { if (pending) runShortcut(e) }, true)
addEventListener("keydown", (e) => { runShortcut(e) })
// Clicking elsewhere ends a sequence, like pressing a key no sequence takes.
addEventListener("pointerdown", () => cancelKeys(), true)

/** The user ran it from the palette or with its keys: for Activity. Commands run by code (runCommandById) and by id
 *  (runCommandId: the desktop app's menu, `vau command`, which the server hears itself) aren't noted. */
const ran = (c: Command) => { if (!QUIET.has(c.id) && !standIns.has(c)) noteActivity("command", `Ran ${c.name}`) }
/** Opening the palettes is on the way to something else (what's run or opened from them is noted). */
const QUIET = new Set(["palette:open", "switcher:open"])

// The palette puts the commands used last on top.
const RECENT = "vaultite.recentCommands"
export function recentCommands(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] }
}
export function runCommand(c: Command) {
  try { localStorage.setItem(RECENT, JSON.stringify([c.id, ...recentCommands().filter((x) => x !== c.id)].slice(0, 5))) } catch { /* private mode */ }
  ran(c)
  runOrSay(c.run, c.name)
}

/** Run a command by id, if it's offered now (the desktop app's menu sends these). */
export function runCommandId(id: string) {
  const c = available(list).find((x) => x.id === id)
  if (c) runOrSay(c.run, c.name)
  return !!c
}
