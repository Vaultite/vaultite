
export const FAMILIES = ["sonnet", "opus", "haiku", "fable"]
/** Every alias --model takes (Claude Code's own list). */
const ALIASES = new Set([...FAMILIES, "best", "opusplan"])
const VERSIONED = new RegExp(`^(${FAMILIES.join("|")})-?(\\d)(?:-?(\\d{1,2}))?(-\\d{8})?$`)

export function modelId(said: string): string | null {
  const s = said.trim()
  if (!s) return ""
  // (a provider's own id, Bedrock's or Vertex's, is theirs to name)
  if (/[:@/]|anthropic\./i.test(s)) return s
  const [, base, wide = ""] = /^(.*?)\s*(\[1m\])?$/i.exec(s.toLowerCase())!
  const dashed = base.replace(/[\s_.]+/g, "-").replace(/-+/g, "-"), bare = dashed.replace(/^claude-?/, "")
  if (ALIASES.has(bare)) return bare + wide
  const v = VERSIONED.exec(bare)
  if (v) return `claude-${v[1]}-${v[2]}${v[3] ? `-${v[3]}` : ""}${v[4] ?? ""}${wide}`
  return /^claude-[a-z0-9]+(-[a-z0-9]+)*$/.test(dashed) && /[a-z]{4}/.test(bare) ? dashed + wide : null
}

export const notAModel = (said: string) =>
  `'${said}' isn't a model Claude Code runs: ${FAMILIES.join(", ")} (each its latest), one with its version (Fable 5.2, opus 5.5) or a full id (claude-opus-5-5)`

export function modelName(model: string) {
  const parts = model.replace(/^claude-/, "").split("-").filter((p) => !(/^\d+$/.test(p) && p.length === 8))
  const words = parts.filter((p) => !/^\d+$/.test(p)), nums = parts.filter((p) => /^\d+$/.test(p))
  return [...words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()), nums.join(".")].join(" ").trim() || model
}
