export type Offer = { kind: "quiet" } | { kind: "offered"; id: string }
export type OfferEvent = { type: "closed"; id: string; n: number } | { type: "changed"; closed: string[] }
export type OfferEffect = { do: "unwatch" } | { do: "offer"; id: string; n: number } | { do: "watch" } | { do: "dismiss" }
export type OfferStep = { state: Offer; effects: OfferEffect[] }

export const QUIET: Offer = { kind: "quiet" }

export function stepOffer(s: Offer, e: OfferEvent): OfferStep {
  switch (e.type) {
    case "closed": {
      const effects: OfferEffect[] = [{ do: "offer", id: e.id, n: e.n }, { do: "watch" }]
      return { state: { kind: "offered", id: e.id }, effects: s.kind === "offered" ? [{ do: "unwatch" }, ...effects] : effects }
    }
    case "changed":
      if (s.kind === "offered" && !e.closed.includes(s.id)) return { state: QUIET, effects: [{ do: "dismiss" }, { do: "unwatch" }] }
      return { state: s, effects: [] }
    default: {
      const never: never = e
      return never
    }
  }
}
