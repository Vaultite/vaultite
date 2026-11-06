// A Talk-key press as one state machine (helper.ts'): the only owner of where it is, each transition logged in its press
// log, so the log says how far every press got and none is left halfway. No Electron.

/** Held: listening (failed: nothing hears now); let go: sending, thinking (asked), working (its turn), answering (words,
 *  marks, voice coming), open (answered, a follow-up may come); missed (said so a moment); closed. */
export type Phase = "listening" | "failed" | "sending" | "thinking" | "working" | "answering" | "open" | "missed" | "closed"
export type PressEvent = "up" | "tap" | "fail" | "miss" | "sent" | "busy" | "arrived" | "done" | "shown" | "close" | "stuck"

const NEXT: Record<Phase, Partial<Record<PressEvent, Phase>>> = {
  listening: { up: "sending", tap: "open", fail: "failed", miss: "missed", close: "closed", stuck: "closed" },
  failed: { up: "sending", miss: "missed", close: "closed" },
  sending: { sent: "thinking", arrived: "answering", miss: "missed", close: "closed", stuck: "missed" },
  thinking: { busy: "working", arrived: "answering", done: "open", miss: "missed", close: "closed", stuck: "missed" },
  working: { arrived: "answering", done: "open", close: "closed" },
  answering: { done: "open", close: "closed" },
  open: { busy: "working", arrived: "answering", close: "closed" },
  missed: { shown: "open", close: "closed" },
  closed: {},
}

/** How long a phase may last before it's stuck (told `stuck` once): a lost key-up, a gather or an ask that never answers. */
export const LIMITS: Partial<Record<Phase, number>> = { listening: 10 * 60_000, sending: 15_000, thinking: 60_000 }

export type Transition = { from: Phase; to: Phase; on: PressEvent; why?: string }

/** One press's machine: `send` an event, true if it moved (one its phase doesn't take is ignored, and false). `log` hears
 *  each transition; `stuck`, a phase past its limit (the owner sends what follows: `stuck`, or a miss). */
export function pressMachine(o: { log?: (t: Transition) => void; stuck?: (phase: Phase) => void; limits?: Partial<Record<Phase, number>> } = {}) {
  let phase: Phase = "listening", timer: ReturnType<typeof setTimeout> | null = null
  const limits = o.limits ?? LIMITS
  const arm = () => {
    if (timer) clearTimeout(timer)
    timer = null
    const ms = limits[phase], at = phase
    if (ms !== undefined) { timer = setTimeout(() => { timer = null; if (phase === at) o.stuck?.(at) }, ms); timer.unref?.() }
  }
  arm()
  return {
    get phase() { return phase },
    send(on: PressEvent, why?: string): boolean {
      const to = NEXT[phase][on]
      if (!to) return false
      const from = phase
      phase = to
      arm()
      o.log?.({ from, to, on, ...(why ? { why } : {}) })
      return true
    },
    /** Whether `on` would move it now. */
    takes: (on: PressEvent) => !!NEXT[phase][on],
  }
}
export type PressMachine = ReturnType<typeof pressMachine>
