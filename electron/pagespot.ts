// Where a browser page is shown (web.ts applies it): one spot at a time, so a page is never both parked and placed.

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

export function spotStep(s: Spot, e: SpotEvent): { to: Spot; do: SpotEffect[] } {
  const stay = { to: s, do: [] }
  const park = (now: number): { to: Spot; do: SpotEffect[] } => s.at === "parked" ? stay
    : { to: { at: "parked", woke: s.at === "resting" ? now : 0 }, do: ["unfocus", "unthrottle", "to-parked", "show"] }
  switch (e.type) {
    case "fit":
      if (e.fill) return { to: { at: "fill" }, do: ["to-fill", "show"] }
      if (e.rect) {
        if (s.at === "parked" || s.at === "resting") return { to: { at: "tab" }, do: ["hide", "raise", "to-tab", "show", ...(e.drawn ? ["see" as const] : [])] }
        if (s.at === "hidden") return { to: { at: "tab" }, do: ["to-tab", "show", ...(e.drawn ? ["see" as const] : [])] }
        return { to: { at: "tab" }, do: ["to-tab", "show"] }
      }
      if (e.drawn) return park(e.now)
      return s.at === "hidden" || s.at === "resting" ? stay : { to: HIDDEN, do: ["keys-out", "hide"] }
    case "stow":
      return e.drawn ? park(e.now) : { to: HIDDEN, do: ["hide"] }
    case "park":
      return park(e.now)
    case "rest":
      return s.at === "parked" ? { to: { at: "resting" }, do: ["hide", "throttle"] } : stay
    case "hide":
      return { to: HIDDEN, do: ["hide"] }
  }
}
