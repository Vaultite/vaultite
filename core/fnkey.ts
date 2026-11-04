// The fn key as ⌘J in the window: a tap starts and the next stops; held, it listens until it's let go. A key pressed with
// fn (fn+arrow, fn+F1) wasn't for dictation: what its press started is cancelled. The page's and the helper's (no Node).

export const HOLD_MS = 450
export type FnAction = "start" | "stop" | "cancel" | null

export function fnKey(hold = HOLD_MS) {
  let at = 0, started = false
  return {
    /** fn went down; `listening`: a session is under way. */
    down(now: number, listening: boolean): FnAction {
      at = now
      started = !listening
      return listening ? "stop" : "start"
    },
    /** fn came up: a hold ends its session, a tap leaves it listening. */
    up(now: number): FnAction {
      if (!started) return null
      started = false
      return now - at >= hold ? "stop" : null
    },
    /** Another key went down with fn. */
    other(): FnAction {
      if (!started) return null
      started = false
      return "cancel"
    },
  }
}

/** macOS's "Press globe key to" (AppleFnUsageType): 0 Do nothing; else it acts too on each press (input source, emoji,
 *  its dictation). Unset reads as macOS's default, which acts. */
export const fnActsToo = (usage: string | null) => usage?.trim() !== "0"

/** macOS's dictation shortcut (AppleSymbolicHotKeys 164, its Control twice: a `modifier` entry with Control's flag), and
 *  AppleDictationAutoEnable, without which it's off: it would start Apple's dictation on a double Control too. */
export function controlActsToo(hotKey: string | null, autoEnable: string | null) {
  if (autoEnable?.trim() === "0") return false
  try {
    const k = JSON.parse(hotKey ?? "null") as { enabled?: boolean | number; value?: { type?: string; parameters?: number[] } } | null
    return !!k?.enabled && k.value?.type === "modifier" && !!k.value.parameters?.some((p) => (p & 0x40000) !== 0)
  } catch { return false }
}

// The dictation keys the user picks (plugins/core/dictation's `keys`), as the screen helper's tap knows them.
const CODES: Record<string, number[]> = { fn: [63], right_option: [61], right_command: [54], double_control: [59, 62] }
export const keyCodes = (keys: readonly string[]) => keys.flatMap((k) => CODES[k] ?? [])

/** How long right Option or Command must be alone before it counts: a chord's key comes sooner, and starts nothing. */
export const ALONE_MS = 200
/** Double Control: each press at most TAP_MS, and at most GAP_MS from one's release to the next press. */
export const TAP_MS = 300, GAP_MS = 400

export type FnEvent = { down: boolean } | { other: true }
/** What the tap says: a watched key's press or release (`alone`: nothing else held), or that something else came. */
export type ModEvent = { code?: number; on?: boolean; alone?: boolean; at?: number; other?: boolean }
/** `fn`: what it means as fn's events; `wait`: call `settled` in ALONE_MS; `twice`: it was a double Control. */
export type ModHeard = { fn: FnEvent[]; wait?: boolean; twice?: boolean }

/** The keys but fn, as fn's events. Right Option or Command alone is fn itself; with another key it's what it always
 *  was. A double Control is a tap of fn, once: a third tap right after does nothing. */
export function modKeys(keys: readonly string[]) {
  const codes = new Set(keyCodes(keys.filter((k) => k !== "fn")))
  let solo: { code: number; state: "waiting" | "down" | "dropped" } | null = null
  let clean = false, ignored = false, pressed = 0, released = 0, taps = 0, quiet = -1
  const dropSolo = (): FnEvent[] => {
    if (!solo) return []
    const was = solo.state
    solo.state = "dropped"
    return was === "down" ? [{ other: true }] : []
  }
  const dropControl = () => { clean = false; taps = 0 }
  const control = (m: ModEvent, now: number): ModHeard => {
    const fn = dropSolo()
    if (m.on) {
      if (now <= quiet) { ignored = true; clean = false; return { fn } }
      if (!m.alone) { dropControl(); return { fn } }
      if (taps && now - released > GAP_MS) taps = 0
      pressed = now
      clean = true
      return { fn }
    }
    if (ignored) { ignored = false; quiet = now + GAP_MS; return { fn } }
    if (!clean) return { fn }
    clean = false
    if (now - pressed > TAP_MS) { taps = 0; return { fn } }
    released = now
    if (++taps < 2) return { fn }
    taps = 0
    quiet = now + GAP_MS
    return { fn: [...fn, { down: true }, { down: false }], twice: true }
  }
  const alone = (m: ModEvent, code: number): ModHeard => {
    dropControl()
    if (solo && solo.code !== code) return { fn: dropSolo() }
    if (m.on) {
      solo = { code, state: m.alone ? "waiting" : "dropped" }
      return { fn: [], wait: !!m.alone }
    }
    const was = solo?.state
    solo = null
    return { fn: was === "waiting" ? [{ down: true }, { down: false }] : was === "down" ? [{ down: false }] : [] }
  }
  return {
    heard(m: ModEvent): ModHeard {
      const code = m.code ?? -1
      if (m.other || !codes.has(code)) { dropControl(); return { fn: dropSolo() } }
      return code === 59 || code === 62 ? control(m, m.at ?? 0) : alone(m, code)
    },
    /** ALONE_MS after a `wait`, still alone: its press counts now. */
    settled(): FnEvent[] {
      if (solo?.state !== "waiting") return []
      solo.state = "down"
      return [{ down: true }]
    },
  }
}
