// One colour per agent, the same wherever it shows: its cursor, the island by the notch, the Agents panel. Never orange
// (the island's "needs you") nor red (a walk recording). Node-free: the app, the server and the helper all use it.

export const AGENT_TINTS = ["teal", "purple", "green", "pink", "indigo", "blue", "yellow"] as const

/** Agent `id`'s tint (a session or terminal id; on another machine `<id>@<machine>` is the same agent). */
export function agentTint(id: string) {
  let h = 0
  for (const c of id.split("@")[0]) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AGENT_TINTS[h % AGENT_TINTS.length]
}
