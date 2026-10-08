// Projects: Projects/<Name>.md (format: AGENTS.md). Live numbers (stars, commits) aren't stored: plugins like GitHub
// add them on the page.
import { bullets, Plugin, section } from "../../../core/plugins.ts"
import { isArchived, type Item, Kind, num, sortBy, str, truthy } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

plugin.kind(new Kind({
  type: "project", collection: "projects", folder: "Projects", titleKey: "name",
  parse: (fm, body, stem) => [{
    name: truthy(fm.name) ? str(fm.name) : stem,
    slug: truthy(fm.slug) ? str(fm.slug) : stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    status: truthy(fm.status) ? str(fm.status) : "", tagline: truthy(fm.tagline) ? str(fm.tagline) : "",
    repo: fm.repo || null, path: fm.path || null,
    links: (truthy(fm.links) ? fm.links : []).filter((l: Item) => l && typeof l === "object" && !Array.isArray(l) && truthy(l.url))
      .map((l: Item) => ({ label: str(l.label || l.url), url: str(l.url) })),
    sort: num(fm.sort), notes: body,
  }, []],
  render: (p) => [{ status: p.status, tagline: p.tagline, repo: p.repo, path: p.path, links: p.links || [], sort: p.sort }, p.notes || ""],
  key: (p) => str(p.name).toLowerCase(),
  blocks: ["project"],
  order: (ps) => sortBy(ps, (p) => [p.sort ?? 1e9, p.name]),
}))

// ---------- blocks as text (GET /api/render) ----------

const about = (p: Item) => [p.status, p.tagline].filter(Boolean).join(" · ")

plugin.block("project", (ctx) => {
  const p = plugin.vault.items("projects").find((x) => x.id + ".md" === ctx.path)
  if (!p) return ""
  const repo = p.repo ? `https://github.com/${p.repo}` : null
  const links = [...p.links.filter((l: Item) => String(l.url).replace(/\/$/, "") !== repo), ...(repo ? [{ label: "GitHub", url: repo }] : [])]
  return [about(p), links.length ? bullets(links.map((l: Item) => `[${l.label}](${l.url})`)) : ""].filter(Boolean).join("\n\n")
})

plugin.block("projects", (ctx) => {
  const ps = plugin.vault.items("projects").filter((p) => !isArchived(p))
  ctx.source(ps)
  return section("Projects", bullets(ps.map((p) => `[[${p.name}]]: ${about(p)}`), "No projects."),
    "Each project's file has its details (GET /api/render?path=Projects/<Name>.md).")
})
