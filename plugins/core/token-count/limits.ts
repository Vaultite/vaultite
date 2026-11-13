export const NEAR = 0.8
/** How deep Claude Code follows `@path` imports ("a maximum depth of four hops"). */
export const MAX_DEPTH = 4

export type Level = "ok" | "near" | "over"
export type Limits = { limit: number; limits: Record<string, number> }
export type Link = { path: string; tokens: number; depth: number; from: string }
export type Sized = { path: string; tokens: number; limit: number; level: Level
  total?: number; chain?: Link[]; outside?: string[]; missing?: string[] }

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null)

export function limitsOf(settings: Record<string, unknown>, defaults: Limits): Limits {
  const own = settings.limits && typeof settings.limits === "object" && !Array.isArray(settings.limits) ? settings.limits : {}
  const limits = { ...defaults.limits }
  for (const [k, v] of Object.entries(own)) { const n = num(v); if (k.trim() && n !== null) limits[k.trim()] = n }
  return { limit: num(settings.limit) ?? defaults.limit, limits }
}

const globRe = (g: string) => new RegExp(`^${g.split(/(\*\*\/?|\*)/).map((s) =>
  s === "**/" ? "(?:.*/)?" : s === "**" ? ".*" : s === "*" ? "[^/]*" : s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("")}$`)
const cache = new Map<string, RegExp>()

export function matches(pattern: string, path: string) {
  let re = cache.get(pattern)
  if (!re) cache.set(pattern, re = globRe(pattern))
  return re.test(pattern.includes("/") ? path : path.slice(path.lastIndexOf("/") + 1))
}

export function ruleFor(path: string, fm: Record<string, unknown> | null | undefined, l: Limits): { limit: number; by: string | null } {
  const own = num(fm?.max_tokens)
  if (own !== null) return { limit: own, by: "max_tokens" }
  let best: string | null = null
  const rank = (p: string) => (p.includes("/") ? 1e6 : 0) + p.replace(/\*/g, "").length
  for (const p of Object.keys(l.limits)) if (matches(p, path) && (best === null || rank(p) > rank(best))) best = p
  return best !== null ? { limit: l.limits[best], by: best } : { limit: l.limit, by: null }
}
export const limitFor = (path: string, fm: Record<string, unknown> | null | undefined, l: Limits) => ruleFor(path, fm, l).limit

export function levelOf(tokens: number, limit: number): Level {
  if (!limit) return "ok"
  return tokens > limit ? "over" : tokens >= limit * NEAR ? "near" : "ok"
}

export const worse = (a: Level, b: Level): Level => (a === "over" || b === "over" ? "over" : a === "near" || b === "near" ? "near" : "ok")

export const isChainRoot = (path: string) => /(^|\/)(CLAUDE(\.local)?|AGENTS)\.md$/.test(path)

/** Claude Code reads an `@path` import after a space or a line's start, never in code. */
export function importsOf(text: string): string[] {
  const prose = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?(^\1[ \t]*$|(?![\s\S]))/gm, "").replace(/`[^`\n]*`/g, "")
  const out = new Set<string>()
  for (const m of prose.matchAll(/(?:^|\s)@((?:~\/|\.{1,2}\/|\/)?[^\s`'"<>()[\]{}]+)/g)) {
    const p = m[1].replace(/[.,;:!?]+$/, "")
    if (p && !p.includes("@")) out.add(p)
  }
  return [...out]
}

export const pathLike = (p: string) => p.includes("/") || /\.[A-Za-z0-9]{1,8}$/.test(p)
