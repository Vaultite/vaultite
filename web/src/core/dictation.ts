// Dictation: what's said goes where the cursor is, words not settled yet shown dimmed by it, never in the text. A source
// tells the events (the desktop app's helper, electron/dictation.ts; an iPhone's would too); plugins hear `onDictation`.
import type { EditorView } from "@codemirror/view"
import { cell } from "@/core/signal"
import { parseReplacement, replacer } from "../../../core/dictationtext.ts"
import { fnKey } from "../../../core/fnkey.ts"
import { makePill } from "@/core/pill"

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
  /** The fn key (or another dictation key), as the desktop app's menu-bar helper hears it while this window has the
   *  keyboard (`other`: a key pressed with it; `talk`: a companion's Talk key). Builds from before the helper don't have it. */
  onKey?: (fn: (k: { down?: boolean; other?: boolean; talk?: boolean }) => void) => () => void
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

// ---------- the pill: by where the words go, its bars following the voice (a click stops)

const indicator = (() => {
  let pill: ReturnType<typeof makePill> | null = null, raf = 0
  const place = (t: number) => {
    raf = requestAnimationFrame(place)
    const d = now.get(), el = pill?.el
    if (!d || !pill || !el || d.stopping) return
    const r = d.target.rect()
    if (!r) { void stopDictation(true); return }
    // (its tab hidden: the words still go there, the pill waits)
    el.style.visibility = r.x || r.y || r.width || r.height ? "" : "hidden"
    const w = el.offsetWidth, h = el.offsetHeight
    const x = Math.max(8, Math.min(innerWidth - w - 8, r.left - (d.target.showsPending ? 11 : 0)))
    const below = r.bottom + 6 + h <= innerHeight - 8
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(below ? r.bottom + 6 : r.top - h - 6)}px)`
    pill.set(d.speaking || d.level > 0.35 ? d.level : d.level * 0.4, d.ready, d.target.showsPending ? "" : d.pending, t)
  }
  return {
    show() {
      if (pill) return
      pill = makePill()
      // (pressed, not clicked: the editor keeps the keyboard)
      pill.el.addEventListener("pointerdown", (e) => { e.preventDefault(); void stopDictation() })
      document.body.append(pill.el)
      raf = requestAnimationFrame(place)
    },
    hide() { cancelAnimationFrame(raf); pill?.el.remove(); pill = null },
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

/** The fn key (the helper's; `talk`: the companion's Talk keys) as a dictation's key: a tap starts, the next stops, held
 *  it listens till let go; with another key what it started is dropped. Returns how to stop hearing it. */
export function fnDictation(begin: (hold: boolean) => Promise<boolean>, talk = false) {
  const key = fnKey()
  let starting: Promise<boolean> | null = null, after: "stop" | "cancel" | "tap" | null = null
  const end = (how: "stop" | "cancel" | "tap") => {
    if (how === "tap") { const d = now.get(); if (d && !d.stopping) now.set({ ...d, hold: false }); return }
    void stopDictation(how === "cancel")
  }
  return dictationSource?.onKey?.((k) => {
    if (!!k.talk !== talk) return
    const a = k.other ? key.other() : k.down ? key.down(performance.now(), listening()) : key.up(performance.now())
    const how = a === "stop" || a === "cancel" ? a : a === null && k.down === false ? "tap" : null
    if (a === "start") {
      after = null
      const s = (starting = begin(true))
      void s.then((ok) => { if (starting !== s) return; starting = null; if (ok && after) end(after) })
    } else if (how && starting) after = how
    else if (how) end(how)
  }) ?? (() => {})
}
