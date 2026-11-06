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

// The keys the user picks (dictation's and the companion's `keys`), as the screen helper's tap knows them: a key alone
// by its code, a chord (two modifiers held together, nothing else) by its name.
const CODES: Record<string, number[]> = { fn: [63], right_option: [61], right_command: [54] }
export const CHORDS = ["control_option", "fn_control"] as const
export const isChord = (k: string) => (CHORDS as readonly string[]).includes(k)
export const keyCodes = (keys: readonly string[]) => keys.flatMap((k) => CODES[k] ?? [])

/** How long right Option or Command must be alone before it counts: a chord's key comes sooner, and starts nothing. */
export const ALONE_MS = 200

/** `t`: when the key moved (ms since 1970), if its tap said; else it's when heard. */
export type FnEvent = { down: boolean; t?: number } | { other: true }
/** What the tap says: a watched key's press or release (`alone`: nothing else held), or that something else came. */
export type ModEvent = { code?: number; on?: boolean; alone?: boolean; at?: number; other?: boolean }
/** `fn`: what it means as fn's events; `wait`: call `settled` in ALONE_MS. */
export type ModHeard = { fn: FnEvent[]; wait?: boolean }

/** The right modifiers, as fn's events: alone, it's fn itself; with another key it's what it always was. */
export function modKeys(keys: readonly string[]) {
  const codes = new Set(keyCodes(keys.filter((k) => k !== "fn")))
  let solo: { code: number; state: "waiting" | "down" | "dropped" } | null = null
  const dropSolo = (): FnEvent[] => {
    if (!solo) return []
    const was = solo.state
    solo.state = "dropped"
    return was === "down" ? [{ other: true }] : []
  }
  return {
    heard(m: ModEvent): ModHeard {
      const code = m.code ?? -1
      if (m.other || !codes.has(code)) return { fn: dropSolo() }
      if (solo && solo.code !== code) return { fn: dropSolo() }
      if (m.on) {
        solo = { code, state: m.alone ? "waiting" : "dropped" }
        return { fn: [], wait: !!m.alone }
      }
      const was = solo?.state
      solo = null
      return { fn: was === "waiting" ? [{ down: true }, { down: false }] : was === "down" ? [{ down: false }] : [] }
    },
    /** ALONE_MS after a `wait`, still alone: its press counts now. */
    settled(): FnEvent[] {
      if (solo?.state !== "waiting") return []
      solo.state = "down"
      return [{ down: true }]
    },
  }
}

// The Talk keys' gesture (HeyClicky's): held, it listens and sends when let go; a tap opens a box to type in; a double
// tap listens hands-free until the next double tap. A key pressed with it (a shortcut) cancels what its press started.
export const TAP_MS = 250, DOUBLE_MS = 350
/** listen: its cursor at the pointer, hearing; send: what was said (and drawn) goes; type: a box to type in, nothing
 *  heard; free: hands-free, into that box; cancel: nothing goes. */
export type TalkAction = "listen" | "send" | "type" | "free" | "cancel" | null

export function talkGesture(tap = TAP_MS, gap = DOUBLE_MS) {
  let s: "idle" | "held" | "typed" | "freeing" | "free" | "freeDown" = "idle", at = 0, lastTap = -Infinity, quick = false
  return {
    get state() { return s },
    down(now: number): TalkAction {
      if (s === "typed" && now - lastTap <= gap) { s = "freeing"; return "free" }
      if (s === "free") { s = "freeDown"; at = now; quick = now - lastTap <= gap; return null }
      if (s !== "idle" && s !== "typed") return null
      s = "held"
      at = now
      return "listen"
    },
    up(now: number): TalkAction {
      if (s === "held") {
        if (now - at >= tap) { s = "idle"; return "send" }
        s = "typed"
        lastTap = now
        return "type"
      }
      if (s === "freeing") { s = "free"; lastTap = -Infinity; return null }
      if (s === "freeDown") {
        const short = now - at < tap
        if (short && quick) { s = "idle"; return "send" }
        s = "free"
        lastTap = short ? now : -Infinity
      }
      return null
    },
    /** Another key with it: a shortcut, not for the companion. */
    other(): TalkAction {
      if (s !== "held") return null
      s = "idle"
      return "cancel"
    },
    /** The exchange ended elsewhere (sent from its box, Esc, closed): the next press starts anew. */
    reset() { s = "idle"; lastTap = -Infinity },
  }
}
