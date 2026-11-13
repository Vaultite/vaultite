import type { Entry, Said, Tool } from "@/components/AgentSession"

export type SessionGroup = { at: number; kind: "tools"; tools: Tool[] } | { at: number; kind: "said"; said: Said }

export function groupsOf(entries: Entry[], start: number): SessionGroup[] {
  const groups: SessionGroup[] = []
  entries.forEach((e, i) => {
    const last = groups[groups.length - 1]
    if (e.kind !== "tool") groups.push({ at: start + i, kind: "said", said: e })
    else if (last?.kind === "tools") last.tools.push(e)
    else groups.push({ at: start + i, kind: "tools", tools: [e] })
  })
  return groups
}
