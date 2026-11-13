import type { Color } from "./colors.ts"

type NeedsYou = "orange"
type Recording = "red"
export const AGENT_TINTS = ["teal", "purple", "green", "pink", "indigo", "blue", "yellow"] as const satisfies readonly Exclude<Color, NeedsYou | Recording>[]

export function agentTint(id: string) {
  let h = 0
  for (const c of id.split("@")[0]) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AGENT_TINTS[h % AGENT_TINTS.length]
}
