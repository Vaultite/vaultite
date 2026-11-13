// Where a browser page is shown (webspot.ts applies it): one spot at a time, so a page is never both parked and placed.

/** Out of sight; an agent's page drawing off the window (`woke`: when it last came back from resting); hidden and
 *  throttled there a while; in its tab's pane; filling its window (full screen) or its player. */
export type Spot = { at: "hidden" } | { at: "parked"; woke: number } | { at: "resting" } | { at: "tab" } | { at: "fill" }
export const HIDDEN: Spot = { at: "hidden" }

export type SpotEvent =
  /** Placed as it wants: filling something, in its tab's rect, else out of sight (parked when it's `drawn`, an agent's). */
  | { type: "fit"; fill: boolean; rect: boolean; drawn: boolean; now: number }
  /** Let go by its tab: out of sight, the keyboard left where it is. */
  | { type: "stow"; drawn: boolean; now: number }
  | { type: "park"; now: number }
  | { type: "rest" }
  /** Taken out of its window (moved, ended, back from its player). */
  | { type: "hide" }

/** `unfocus`: the window takes the keyboard if the page has it. `keys-out`: the same, remembered so it's given back
 *  when shown. `raise`: over the window's other pages. `see`: checked that it draws. */
export type SpotEffect = "show" | "hide" | "throttle" | "unthrottle" | "to-parked" | "to-fill" | "to-tab" | "raise" | "unfocus" | "keys-out" | "see"

/** On screen, where the user sees it. */
export const shown = (s: Spot) => s.at === "tab" || s.at === "fill"

export type SpotMove = { to: Spot; do: SpotEffect[] }

const parkFrom = (s: Spot, now: number): SpotMove => s.at === "parked" ? { to: s, do: [] }
  : { to: { at: "parked", woke: s.at === "resting" ? now : 0 }, do: ["unfocus", "unthrottle", "to-parked", "show"] }

function fitFrom(s: Spot, e: Extract<SpotEvent, { type: "fit" }>): SpotMove {
  if (e.fill) return { to: { at: "fill" }, do: ["to-fill", "show"] }
  const see: SpotEffect[] = e.drawn ? ["see"] : []
  if (e.rect && (s.at === "parked" || s.at === "resting")) return { to: { at: "tab" }, do: ["hide", "raise", "to-tab", "show", ...see] }
  if (e.rect) return { to: { at: "tab" }, do: ["to-tab", "show", ...(s.at === "hidden" ? see : [])] }
  if (e.drawn) return parkFrom(s, e.now)
  return s.at === "hidden" || s.at === "resting" ? { to: s, do: [] } : { to: HIDDEN, do: ["keys-out", "hide"] }
}

export function spotStep(s: Spot, e: SpotEvent): SpotMove {
  switch (e.type) {
    case "fit": return fitFrom(s, e)
    case "stow": return e.drawn ? parkFrom(s, e.now) : { to: HIDDEN, do: ["hide"] }
    case "park": return parkFrom(s, e.now)
    case "rest": return s.at === "parked" ? { to: { at: "resting" }, do: ["hide", "throttle"] } : { to: s, do: [] }
    case "hide": return { to: HIDDEN, do: ["hide"] }
  }
}
