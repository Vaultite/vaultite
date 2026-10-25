// Names that pick an agent: @opus starts Claude Code on Opus, @opus-review another one. Both halves use it (no Node, no DOM).

/** What a name starts: a coding agent ("claude", "codex", "claude_work"), its model and its effort ("": the default). */
export type Profile = { agent: string; model: string; effort: string }

/** The setting's lines ("opus: claude opus high"), later ones replacing a name's earlier. */
export function parseProfiles(lines: unknown[]): Record<string, Profile> {
  const out: Record<string, Profile> = {}
  for (const l of lines) {
    const m = typeof l === "string" ? /^\s*@?(\w+)\s*:\s*([a-z][a-z0-9]*(?:_[a-z0-9]+)?)(?:\s+(\S+))?(?:\s+(\S+))?\s*$/i.exec(l) : null
    if (m) out[m[1].toLowerCase()] = { agent: m[2].toLowerCase(), model: m[3] ?? "", effort: m[4]?.toLowerCase() ?? "" }
  }
  return out
}

/** The profile `name` picks: its own, else its first part's (@opus-review: opus's); null when neither has one. */
export function profileOf<T>(name: string, profiles: Record<string, T>): T | null {
  const k = name.trim().toLowerCase()
  return (Object.hasOwn(profiles, k) ? profiles[k] : null) ?? (Object.hasOwn(profiles, k.split("-")[0]) ? profiles[k.split("-")[0]] : null)
}
