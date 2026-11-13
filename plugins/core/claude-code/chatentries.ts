import type { Entry } from "./chatlog.ts"

/** Entries a page of history has (the chat tab's first, and each Show earlier). */
export const PAGE = 300

/** A transcript with the keeper's entries (`live`) merged in: shared ones where the transcript has them, the keeper's
 *  own (asks, failed turns, notes) after the one before them there; a "Stopped" left out beside an "Interrupted". */
export function merge(history: Entry[], live: Entry[]): Entry[] {
  const at = new Map(history.map((e, i) => [e.id, i]))
  const out = [...history], before = new Map<number, Entry[]>(), after = new Map<number, Entry[]>(), tail: Entry[] = []
  let prev = -1, waiting: Entry[] = []
  for (const e of live) {
    const i = at.get(e.id)
    if (i === undefined) { (prev < 0 ? waiting : after.get(prev) ?? (after.set(prev, []), after.get(prev)!)).push(e); continue }
    out[i] = e
    if (prev < 0 && waiting.length) { before.set(i, waiting); waiting = [] }
    prev = i
  }
  tail.push(...waiting)
  const all = out.flatMap((e, i) => [...(before.get(i) ?? []), e, ...(after.get(i) ?? [])]).concat(tail)
  // (each turn's own: from a user message to the next)
  const only = new Set(live.filter((e) => !at.has(e.id)).map((e) => e.id)), drop = new Set<string>()
  for (let i = 0, from = 0; i <= all.length; i++) {
    if (i < all.length && all[i].k !== "user") continue
    const turn = all.slice(from, i)
    if (turn.some((e) => e.k === "note" && e.text === "Interrupted")) for (const e of turn) if (e.k === "note" && e.text === "Stopped" && only.has(e.id)) drop.add(e.id)
    from = i
  }
  return drop.size ? all.filter((e) => !drop.has(e.id)) : all
}

/** An entry as one Markdown paragraph, for an agent reading a chat. */
export function entryText(e: Entry): string {
  switch (e.k) {
    case "user": return `**You:** ${e.text}${e.images?.length ? ` (${e.images.length} picture${e.images.length > 1 ? "s" : ""})` : ""}`
    case "text": return e.text
    case "thinking": return ""
    case "tool": return `\`${e.name}\` ${e.summary}${e.error ? " (failed)" : ""}`
    case "ask": return `**Asks** (${e.kind}): ${e.title}${e.detail ? `: ${e.detail}` : ""}${e.answer ? ` · ${e.answer}` : ""}`
    case "result": return e.ok ? "" : `**Stopped:** ${e.error ?? ""}`
    case "note": return `_${e.text}_`
  }
}
