// Dictation: what's said goes where the cursor is, words not settled yet shown dimmed by it, never in the text. A source
// tells the events (the desktop app's helper, electron/dictation.ts; an iPhone's would too); plugins hear `onDictation`.
import type { EditorView } from "@codemirror/view"
import { cell } from "@/core/signal"

export type DictationEvent =
  /** The microphone is open. */
  | { type: "start" }
  /** Getting ready the first time (Apple's language files, Parakeet's model): what's said meanwhile is kept. */
  | { type: "loading"; what: string }
  /** The user started speaking after a pause. */
  | { type: "speech" }
  /** How loud, 0 to 1, a few times a second. */
  | { type: "level"; v: number }
  /** The words heard since the last final ones, as they stand now ("" none): replaced whole each time. */
  | { type: "pending"; text: string }
  /** Words settled, to type in. */
  | { type: "final"; text: string }
  /** Quiet for `ms` after speech: 700 ends a clause (what was heard turns final), 2000 a thought. */
  | { type: "pause"; ms: number }
  | { type: "end"; reason: "stop" | "silence" | "cancel" | "error" | "elsewhere" }
  | { type: "error"; code: "permission" | "mic" | "model" | "language" | "unsupported" | "engine" | "helper" | string; message: string }

export type DictationEngine = "apple" | "parakeet"
/** What dictates here: Apple's on-device recognizer (macOS 26, `locale`), Parakeet (its model found on this Mac). */
export type DictationEngines = { apple: boolean; parakeet: boolean; locale?: string; why?: string }
export type DictationSource = {
  engines: (language: string) => Promise<DictationEngines>
  /** `words`: what to listen for (Apple's); `keep`: keep the audio for replaying it (electron/dictation.ts says where). */
  start: (o: { engine: DictationEngine; language: string; silence: number; words?: string[]; keep?: boolean }) => Promise<{ ok: boolean; code?: string; message?: string }>
  stop: () => Promise<unknown>
  cancel: () => Promise<unknown>
  on: (fn: (e: DictationEvent) => void) => () => void
}

/** Where the words go: a note's editor (it shows the pending words itself) or a field. */
export type DictationTarget = {
  pending: (text: string) => void
  final: (text: string) => void
  end: () => void
  /** Where on screen the words go (the indicator sits by it; empty: not shown now); null once it's gone, which ends it. */
  rect: () => DOMRect | null
  /** It draws the pending words itself (an editor); a field's are in the indicator. */
  showsPending?: boolean
  /** A note's editor, and the note. */
  view?: EditorView
  path?: string
}

const source = (): DictationSource | null => (globalThis as { vaultite?: { dictation?: DictationSource } }).vaultite?.dictation ?? null
/** The source of dictation here, or null: a browser, a phone, an app build from before it. */
export const dictationSource = source()

/** `spokeAt`: when the utterance under way began (0: none, the user paused); `stopping`: told to stop, the microphone
 *  is off and its last words are on their way. */
export type Dictation = { target: DictationTarget; hold: boolean; speaking: boolean; spokeAt: number; pending: string; level: number; ready: boolean
  stopping?: boolean }
const now = cell<Dictation | null>(null)
/** The session under way, or null. */
export const dictation = () => now.get()
/** Listening now: a session not told to stop. */
export const listening = () => { const d = now.get(); return !!d && !d.stopping }
/** The session told to stop, settled (its last words in, or a few seconds gone by). */
async function settled() {
  for (let i = 0; i < 60 && now.get()?.stopping; i++) await new Promise((r) => setTimeout(r, 50))
  if (now.get()?.stopping) finish()
}
/** The session in React (`pick`: the part drawn from, so the voice's level doesn't redraw what doesn't show it). */
export const useDictation = <R = Dictation | null>(pick?: (d: Dictation | null) => R) => now.use(pick)

/** Whether the user is in the middle of saying something into this editor (an agent writing there waits). */
export const speakingIn = (view: EditorView) => { const d = now.get(); return !!d && d.target.view === view && (d.speaking || !!d.pending) }

type Heard = (e: DictationEvent, where: { view?: EditorView; path?: string }) => void
const hearers = new Set<Heard>()
/** Hear each session's events (pending at most a few times a second; level never), with the editor and note they go
 *  into, if any. Returns how to stop. */
export function onDictation(fn: Heard) { hearers.add(fn); return () => { hearers.delete(fn) } }
let saidPending = 0, pendingTimer: ReturnType<typeof setTimeout> | null = null
function tell(e: DictationEvent) {
  const d = now.get()
  if (!d) return
  const where = { view: d.target.view, path: d.target.path }
  if (e.type === "level") return
  if (e.type === "pending") {
    // (the last one always arrives: trailing)
    if (pendingTimer) clearTimeout(pendingTimer)
    const wait = 250 - (Date.now() - saidPending)
    const send = () => {
      pendingTimer = null
      saidPending = Date.now()
      const n = now.get()
      if (n?.target === d.target) for (const fn of [...hearers]) fn({ type: "pending", text: n.pending }, where)
    }
    if (wait <= 0) send(); else pendingTimer = setTimeout(send, wait)
    return
  }
  for (const fn of [...hearers]) fn(e, where)
}

/** `text` said after `before` (what precedes where it goes): a space between words, none before punctuation or at a
 *  line's start. */
export function joinText(before: string, text: string) {
  const t = text.replace(/^\s+/, "")
  if (!t) return ""
  const last = before.slice(-1)
  return last && !/[\s([{"'“‘/-]/u.test(last) && !/^[.,!?;:…)\]}"'”’]/u.test(t) ? ` ${t}` : t
}

/** A replacements line, "said: written" (the last ": " splits it), or null. */
export function parseReplacement(line: string): [string, string] | null {
  const i = line.lastIndexOf(": ")
  const from = i > 0 ? line.slice(0, i).trim() : "", to = i > 0 ? line.slice(i + 2).trim() : ""
  return from && to ? [from, to] : null
}
/** The replacements as patterns: the said words whole, in any case, however they're spaced. */
export function replacer(lines: string[]): [RegExp, string][] {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return lines.map(parseReplacement).filter((x) => !!x).map(([from, to]) =>
    [new RegExp(`(?<![\\p{L}\\p{N}@])${from.split(/\s+/).map(esc).join("\\s+")}(?![\\p{L}\\p{N}])`, "giu"), to.replace(/\$/g, "$$$$")])
}

let unsub: (() => void) | null = null
let session = 0

/** Listen, typing into `target` (`hold`: push to talk, the key still down). Says why when it can't. */
export async function startDictation(target: DictationTarget, o: { engine: DictationEngine; language: string; silence: number; hold?: boolean
  /** "said: written" lines (`replacements`), which are also the words listened for; `keep`: keep the audio. */
  replacements?: string[]; keep?: boolean },
  failed: (code: string, message?: string) => void) {
  const src = dictationSource
  if (!src) return failed("unsupported")
  if (now.get()?.stopping) await settled()
  if (now.get()) await stopDictation(true)
  const mine = ++session
  const swap = replacer(o.replacements ?? [])
  const said = (t: string) => swap.reduce((x, [re, to]) => x.replace(re, to), t)
  now.set({ target, hold: !!o.hold, speaking: false, spokeAt: 0, pending: "", level: 0, ready: false })
  unsub = src.on((e) => heard(e.type === "pending" || e.type === "final" ? { ...e, text: said(e.text) } : e, mine, failed))
  // (the window left for another app: what's said there isn't for this note)
  addEventListener("blur", away)
  indicator.show()
  tell({ type: "start" })
  const words = (o.replacements ?? []).map(parseReplacement).filter((x) => !!x).map((x) => x[0])
  const r = await src.start({ engine: o.engine, language: o.language, silence: o.silence, words, keep: !!o.keep }).catch((e) => ({ ok: false, code: "helper", message: String(e) }))
  if (!r.ok && session === mine) { finish(); failed(r.code ?? "helper", r.message) }
}

function heard(e: DictationEvent, mine: number, failed: (code: string, message?: string) => void) {
  const d = now.get()
  if (!d || session !== mine) return
  const set = (x: Partial<Dictation>) => now.set({ ...d, ...x })
  switch (e.type) {
    case "start": set({ ready: true }); return
    case "level": set({ level: e.v }); break
    case "speech": set({ speaking: true, spokeAt: d.spokeAt || Date.now() }); break
    case "pending":
      d.target.pending(e.text)
      set({ pending: e.text, speaking: d.speaking || !!e.text, spokeAt: d.spokeAt || (e.text ? Date.now() : 0) })
      break
    case "final": d.target.final(e.text); break
    case "pause": set({ speaking: false, spokeAt: 0 }); break
    case "error": failed(e.code, e.message); break
    case "end": tell(e); finish(); return
  }
  tell(e)
}

/** Stop listening: what was heard becomes final (`cancel`: the words not settled yet are dropped). */
export async function stopDictation(cancel = false) {
  const d = now.get()
  if (!d) return
  if (cancel) { tell({ type: "end", reason: "cancel" }); finish() }
  else {
    if (d.stopping) return
    // (it shows stopped at once; the words still coming go in as they arrive, and a helper that never ends is let go)
    now.set({ ...d, stopping: true, speaking: false })
    indicator.hide()
    removeEventListener("blur", away)
    const mine = session
    setTimeout(() => { if (session === mine && now.get()?.stopping) finish() }, 30_000)
  }
  // (the end comes back as an event, after the last words)
  await (cancel ? dictationSource?.cancel() : dictationSource?.stop())?.catch(() => {})
}

const away = () => void stopDictation()

function finish() {
  const d = now.get()
  removeEventListener("blur", away)
  unsub?.()
  unsub = null
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
  now.set(null)
  indicator.hide()
  d?.target.end()
}

// ---------- the indicator: a microphone by where the words go, its ring following the voice (a click stops)

const MIC = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>'
const indicator = (() => {
  let el: HTMLDivElement | null = null, text: HTMLSpanElement | null = null, raf = 0, stop: (() => void) | null = null
  const place = () => {
    raf = requestAnimationFrame(place)
    const d = now.get()
    if (!d || !el || d.stopping) return
    const r = d.target.rect()
    if (!r) { void stopDictation(true); return }
    // (its tab hidden: the words still go there, the indicator waits)
    el.style.visibility = r.x || r.y || r.width || r.height ? "" : "hidden"
    const w = el.offsetWidth, h = el.offsetHeight
    const x = Math.max(8, Math.min(innerWidth - w - 8, r.left - (d.target.showsPending ? 11 : 0)))
    const below = r.bottom + 6 + h <= innerHeight - 8
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(below ? r.bottom + 6 : r.top - h - 6)}px)`
    el.style.setProperty("--level", String(d.speaking || d.level > 0.35 ? d.level : d.level * 0.4))
    el.toggleAttribute("data-ready", d.ready)
    const t = d.target.showsPending ? "" : d.pending
    if (text && text.textContent !== t) { text.textContent = t.length > 80 ? `…${t.slice(-80)}` : t; text.hidden = !t }
  }
  return {
    show() {
      if (el) return
      el = document.createElement("div")
      el.className = "dictation-indicator"
      el.setAttribute("role", "status")
      el.setAttribute("aria-label", "Listening")
      el.innerHTML = `<span class="dictation-mic">${MIC}</span>`
      text = document.createElement("span")
      text.className = "dictation-pending"
      text.hidden = true
      el.append(text)
      // (pressed, not clicked: the editor keeps the keyboard)
      el.addEventListener("pointerdown", (e) => { e.preventDefault(); void stopDictation() })
      document.body.append(el)
      raf = requestAnimationFrame(place)
      stop = () => cancelAnimationFrame(raf)
    },
    hide() { stop?.(); stop = null; el?.remove(); el = null; text = null },
  }
})()

// ---------- the key: a tap starts and the next one stops; held down, it listens until it's let go

const HOLD_MS = 450
let lastKey = { at: -1e9, repeat: false }
globalThis.addEventListener?.("keydown", (e) => { if (!["Meta", "Control", "Alt", "Shift"].includes(e.key)) lastKey = { at: e.timeStamp, repeat: e.repeat } }, true)

/** The dictation command ran: stop the session under way, else start one with `begin` (null: nowhere to dictate), and
 *  when its key was pressed (not the palette, nor the menu) and held past a tap, stop when it's let go. */
export async function pressDictation(begin: (hold: boolean) => Promise<boolean>) {
  const byKey = performance.now() - lastKey.at < 250
  // (the key's own repeats while it's held)
  if (byKey && lastKey.repeat) return
  if (listening()) return void stopDictation()
  const down = performance.now()
  let released = byKey ? 0 : down, mine = -1
  // (the key may come up before the session has started: the Ask box opening)
  const decide = () => {
    if (!released || mine < 0 || session !== mine || !listening()) return
    if (released - down >= HOLD_MS) void stopDictation()
    else now.set({ ...now.get()!, hold: false })
  }
  const up = () => { removeEventListener("keyup", up, true); removeEventListener("blur", up); released = performance.now(); decide() }
  if (byKey) { addEventListener("keyup", up, true); addEventListener("blur", up) }
  if (!(await begin(byKey))) return up()
  mine = session
  decide()
}
