// The window's last minutes, in memory only: what the user did (keys, clicks, wheel, focus, moving around) and what the
// app did (the trace's topics, files changed, scrolling nobody asked for). Started while the plugin is on.
import { onTrace, onVaultChange } from "@vaultite"

export type Ev = { at: number; topic: string; [k: string]: unknown }

const MAX = 50_000
let events: Ev[] = []
let keepMs = 5 * 60_000
let typedText = false

export const setKeep = (minutes: number, text: boolean) => { keepMs = Math.max(1, minutes) * 60_000; typedText = text }

/** What was recorded in the minutes kept, oldest first. */
export const recorded = (): Ev[] => events.filter((e) => e.at >= Date.now() - keepMs)

function push(e: Ev) {
  events.push(e)
  if (events.length > MAX || events[0].at < e.at - keepMs - 60_000) events = events.filter((x) => x.at >= e.at - keepMs)
}
const add = (topic: string, fields: Record<string, unknown>) => push({ at: Date.now(), topic, ...fields })

/** An element as a person would point at it: its name (label, tip, path) and the area it's in. */
export function where(t: EventTarget | null): string {
  const el = t instanceof Element ? t : t instanceof Node ? t.parentElement : null
  if (!el) return t === window ? "window" : t === document ? "document" : ""
  const area = el.closest(".cm-editor") ? "editor" : el.closest(".xterm") ? "terminal" : el.closest("[role=dialog]") ? "dialog"
    : el.closest("[data-palette], [cmdk-root]") ? "palette" : el.closest("[role=menu]") ? "menu" : el.closest("aside, [data-sidebar]") ? "sidebar"
    : el.closest("[data-pane], #main-scroll") ? "pane" : ""
  const named = el.closest("[aria-label], [data-tip], [data-path], [data-select-key], button, a, input, textarea")
  const name = named?.getAttribute("aria-label") ?? named?.getAttribute("data-tip") ?? named?.getAttribute("data-path") ?? named?.getAttribute("data-select-key")
    ?? (named instanceof HTMLButtonElement || named instanceof HTMLAnchorElement ? named.textContent?.trim().slice(0, 40) : null)
  const tag = (named ?? el).tagName.toLowerCase() + ((named ?? el).id ? `#${(named ?? el).id}` : "")
  return [area, name ? `${tag} (${name})` : tag].filter(Boolean).join(" ")
}

const secret = (t: EventTarget | null) => t instanceof Element && (!!t.closest(".xterm") || (t instanceof HTMLInputElement && t.type === "password"))
const MODS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"])
function combo(e: KeyboardEvent) {
  const key = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Cmd", key].filter(Boolean).join("+")
}

let lastInput = 0
/** The run each kind is adding to (the app's events come in between: a key's editor change). */
const runs = new Map<string, { ev: Ev; last: number }>()
/** Add to the run of `kind` when `same` says it's one, within `ms` of its last; else start one (at its first's time). */
function into(kind: string, same: (run: Ev) => boolean, grow: (run: Ev) => void, start: () => Record<string, unknown>, ms = 2000) {
  const run = runs.get(kind), now = Date.now()
  if (run && now - run.last < ms && same(run.ev)) { grow(run.ev); run.last = now; return }
  const ev: Ev = { at: now, topic: kind, ...start() }
  push(ev)
  runs.set(kind, { ev, last: now })
}
/** Start recording; returns how to stop. */
export function startRecording(): () => void {
  const offs: (() => void)[] = []
  const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
    addEventListener(type, fn, { capture: true, passive: true })
    offs.push(() => removeEventListener(type, fn, { capture: true }))
  }

  // Keys: shortcuts as they are; letters as a count (or the letters, when asked), a run of them one event.
  on("keydown", (e) => {
    lastInput = Date.now()
    if (MODS.has(e.key)) return
    const at = where(e.target), letter = e.key.length === 1 && !e.metaKey && !e.ctrlKey
    const name = letter ? "typed" : combo(e), text = letter && typedText && !secret(e.target) ? e.key : ""
    into("key", (r) => r.key === name && r.in === at, (r) => { r.n = (r.n as number) + 1; if (text) r.text = `${r.text ?? ""}${text}` },
      () => ({ key: name, n: 1, in: at, ...(text ? { text } : {}) }))
  })
  on("pointerdown", (e) => { lastInput = Date.now(); add("pointer", { button: e.button, kind: e.pointerType, x: Math.round(e.clientX), y: Math.round(e.clientY), on: where(e.target) }) })
  on("wheel", (e) => {
    lastInput = Date.now()
    const over = where(e.target), dy = Math.round(e.deltaY)
    into("wheel", (r) => r.on === over, (r) => { r.dy = (r.dy as number) + dy }, () => ({ dy, on: over }), 500)
  })
  on("touchmove", () => { lastInput = Date.now() })
  on("focusin", (e) => add("focus", { on: where(e.target) }))
  on("hashchange", () => add("nav", { to: decodeURIComponent(location.hash).slice(0, 200) }))
  on("blur", (e) => { if (e.target === window) add("window", { state: "blur" }) })
  on("focus", (e) => { if (e.target === window) add("window", { state: "focus" }) })
  on("resize", () => { const size = `${innerWidth}x${innerHeight}`; into("resize", () => true, (r) => { r.size = size }, () => ({ size }), 1000) })
  on("online", () => add("window", { state: "online" }))
  on("offline", () => add("window", { state: "offline" }))
  const visible = () => add("window", { state: document.visibilityState })
  document.addEventListener("visibilitychange", visible)
  offs.push(() => document.removeEventListener("visibilitychange", visible))

  // Scrolling: where each scroller went, and whether the user moved it or the app did (nothing typed, wheeled or touched).
  const tops = new WeakMap<Element, { top: number; ev: Ev; last: number }>()
  const scrolled = (e: Event) => {
    const el = e.target instanceof Element ? e.target : document.scrollingElement
    if (!el || el.closest(".xterm")) return
    const was = tops.get(el), top = Math.round(el.scrollTop)
    const now = Date.now(), by = now - lastInput < 800 ? "user" : "app"
    if (was && now - was.last < 400 && was.ev.by === by) { was.ev.to = top; was.top = top; was.last = now; return }
    const ev: Ev = { at: now, topic: "scroll", on: where(el), from: was?.top ?? null, to: top, by }
    push(ev)
    tops.set(el, { top, ev, last: now })
  }
  document.addEventListener("scroll", scrolled, { capture: true, passive: true })
  offs.push(() => document.removeEventListener("scroll", scrolled, { capture: true }))

  // What the app traced (editor changes, scroll restores, commands, console warnings) and files changing on disk.
  offs.push(onTrace((topic, e) => push({ ...e, t: undefined, at: Date.parse(e.at), topic })))
  offs.push(onVaultChange((paths) => add("files", paths ? { changed: paths.slice(0, 5), n: paths.length } : { changed: "everything" })))

  add("window", { state: "recording", size: `${innerWidth}x${innerHeight}` })
  return () => { for (const f of offs) f() }
}
