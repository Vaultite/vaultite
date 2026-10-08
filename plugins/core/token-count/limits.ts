// How long a Markdown file may be before Token count flags it: a loose limit for any file, stricter ones for the files
// agents load at startup (by name or path), a file's own `max_tokens`. Shared by plugin.ts and index.tsx.

/** At this share of its limit a file is near it (amber); over it, red. */
export const NEAR = 0.8
/** How deep Claude Code follows `@path` imports ("a maximum depth of four hops"). */
export const MAX_DEPTH = 4

export type Level = "ok" | "near" | "over"
export type Limits = { limit: number; limits: Record<string, number> }
/** One file in a load chain: how deep it was imported, and from where. */
export type Link = { path: string; tokens: number; depth: number; from: string }
/** A file's size against its limit; a CLAUDE.md or AGENTS.md also what it loads (`total`: it and every file it imports). */
export type Sized = { path: string; tokens: number; limit: number; level: Level
  total?: number; chain?: Link[]; outside?: string[]; missing?: string[] }

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null)

/** The settings as limits: `limits` merged over the manifest's (`defaults`), so adding one pattern keeps the others. */
export function limitsOf(settings: Record<string, unknown>, defaults: Limits): Limits {
  const own = settings.limits && typeof settings.limits === "object" && !Array.isArray(settings.limits) ? settings.limits as Record<string, unknown> : {}
  const limits = { ...defaults.limits }
  for (const [k, v] of Object.entries(own)) { const n = num(v); if (k.trim() && n !== null) limits[k.trim()] = n }
  return { limit: num(settings.limit) ?? defaults.limit, limits }
}

const globRe = (g: string) => new RegExp(`^${g.split(/(\*\*\/?|\*)/).map((s) =>
  s === "**/" ? "(?:.*/)?" : s === "**" ? ".*" : s === "*" ? "[^/]*" : s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("")}$`)
const cache = new Map<string, RegExp>()

/** Whether a pattern names this path: without a slash, a file name in any folder (CLAUDE.md); with one, a vault path
 *  (.vaultite/AGENTS.md, .claude/skills/**). `*` and `**` as in globs; case counts (Claude.md isn't CLAUDE.md). */
export function matches(pattern: string, path: string) {
  let re = cache.get(pattern)
  if (!re) cache.set(pattern, re = globRe(pattern))
  return re.test(pattern.includes("/") ? path : path.slice(path.lastIndexOf("/") + 1))
}

/** A file's limit in tokens (0: none) and what set it: its frontmatter's `max_tokens`, else the most specific pattern
 *  naming it (a path before a name, then the longer), else the limit for any file (`by` null). */
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

/** The files Claude Code loads at startup with their `@path` imports expanded. */
export const isChainRoot = (path: string) => /(^|\/)(CLAUDE(\.local)?|AGENTS)\.md$/.test(path)

/** A file's `@path` imports as written, Claude Code's way: after a space or a line's start, not in code. */
export function importsOf(text: string): string[] {
  const prose = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?(^\1[ \t]*$|(?![\s\S]))/gm, "").replace(/`[^`\n]*`/g, "")
  const out = new Set<string>()
  for (const m of prose.matchAll(/(?:^|\s)@((?:~\/|\.{1,2}\/|\/)?[^\s`'"<>()[\]{}]+)/g)) {
    const p = m[1].replace(/[.,;:!?]+$/, "")
    if (p && !p.includes("@")) out.add(p)
  }
  return [...out]
}

/** Looks like a path someone meant to import (a folder or an extension), not a mention (@alice). */
export const pathLike = (p: string) => p.includes("/") || /\.[A-Za-z0-9]{1,8}$/.test(p)
