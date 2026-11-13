export type Profile = { agent: string; model: string; effort: string }

export function parseProfiles(lines: unknown[]): Record<string, Profile> {
  const out: Record<string, Profile> = {}
  for (const l of lines) {
    const m = typeof l === "string" ? /^\s*@?(\w+)\s*:\s*([a-z][a-z0-9]*(?:_[a-z0-9]+)?)(?:\s+(\S+))?(?:\s+(\S+))?\s*$/i.exec(l) : null
    if (m) out[m[1].toLowerCase()] = { agent: m[2].toLowerCase(), model: m[3] ?? "", effort: m[4]?.toLowerCase() ?? "" }
  }
  return out
}

export function profileOf<T>(name: string, profiles: Record<string, T>): T | null {
  const k = name.trim().toLowerCase()
  return (Object.hasOwn(profiles, k) ? profiles[k] : null) ?? (Object.hasOwn(profiles, k.split("-")[0]) ? profiles[k.split("-")[0]] : null)
}
