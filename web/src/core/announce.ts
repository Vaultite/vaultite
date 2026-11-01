// What a screen reader says without moving the user's focus: toasts (core/notify.ts) and agents' turns. Two regions
// made at load, empty: one added together with its text is often not read.
const regions = new Map<"polite" | "assertive", HTMLElement>()
if (typeof document !== "undefined") {
  for (const live of ["polite", "assertive"] as const) {
    const el = document.createElement("div")
    el.setAttribute("aria-live", live)
    // (each line read as it's added, not the region again: several in a moment are each read once)
    el.setAttribute("aria-atomic", "false")
    el.setAttribute("aria-relevant", "additions")
    el.dataset.announce = live
    el.className = "sr-only"
    document.body.append(el)
    regions.set(live, el)
  }
}

const recent = new Map<string, number>()

/** Say `text` to a screen reader: politely, after what it's reading, or `assertive` (an error) at once. The same line
 *  again within 2 s (one change heard by two tabs) is said once. */
export function announce(text: string, opts: { assertive?: boolean } = {}) {
  const region = regions.get(opts.assertive ? "assertive" : "polite"), line = text.trim()
  const now = Date.now()
  if (!region || !line || now - (recent.get(line) ?? -Infinity) < 2000) return
  recent.set(line, now)
  for (const [k, at] of recent) if (now - at > 2000) recent.delete(k)
  const p = document.createElement("p")
  p.textContent = line
  region.append(p)
  // (gone again once read, so reading the page doesn't find old news at its end)
  setTimeout(() => p.remove(), 7000)
}

/** Where a coding agent is in its turn, in every agent's words: a terminal's state, a chat's. */
export type AgentPhase = "working" | "waiting" | "done" | "failed" | null

/** Say what matters when agent `label` goes from `was` to `now`: it finished, it waits for the user, it failed. Nothing
 *  while it works, nor for a change first heard (a list loading). */
export function announceAgent(label: string, was: AgentPhase | undefined, now: AgentPhase) {
  if (was === undefined || was === now || !now || now === "working") return
  if (now === "failed") announce(`${label} failed`, { assertive: true })
  else if (now === "waiting") announce(`${label} is waiting for you`)
  else if (was === "working") announce(`${label} finished`)
}
