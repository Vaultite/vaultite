// MCP Apps' cards for Vaultite's own tools (a note, tasks, a board), offered to the MCP plugin ("mcp:apps"), and the
// host that draws them in notes (```block-mcp-app): the card served sandboxed at /mcp-app/, its tool run as the caller.
import fs from "node:fs"
import path from "node:path"
import { Marked, type Tokens } from "marked"
import { HTTPError, OpError, Plugin, type Request, Text } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

const CARDS = path.join(path.dirname(new URL(import.meta.url).pathname), "cards")
const file = (name: string) => fs.readFileSync(path.join(CARDS, name), "utf8")
/** A card's page: its body with the shared bridge and styles put in, self-contained. */
const page = (name: string) => () => file(`${name}.html`).replace("/*card.css*/", file("card.css")).replace("/*bridge.js*/", file("bridge.js"))

const decoded = (s: string) => { try { return decodeURI(s) } catch { return s } }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
// The note's own HTML is shown as text, links that run code aren't links, and images are their names (no network).
const md = new Marked({ gfm: true, breaks: false, renderer: {
  html: ({ text }: Tokens.HTML | Tokens.Tag) => esc(text),
  image: ({ text, href }: Tokens.Image) => `<span class="img">${esc(text || href)}</span>`,
  link({ href, tokens }: Tokens.Link) {
    const inner = this.parser.parseInline(tokens)
    return /^(https?|mailto):/i.test(href) ? `<a href="${esc(href)}" data-url="${esc(href)}">${inner}</a>` : `<a data-open="${esc(decoded(href))}">${inner}</a>`
  },
  code: ({ text, lang }: Tokens.Code) => (/^block-/.test(lang ?? "") ? "" : `<pre><code>${esc(text)}</code></pre>`),
} })

/** A note's Markdown as the card's HTML: no frontmatter, [[links]] as links to the files they name (`resolve`: a
 *  target's path, or null), embeds as their names. */
export function noteHtml(text: string, resolve: (target: string) => string | null = () => null) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/!?\[\[([^[\]\n|]+?)(?:\|([^[\]\n]+?))?\]\]/g, (_all, target: string, shown?: string) => {
      const label = (shown ?? target.replace(/#.*/, "")).replace(/[[\]]/g, "")
      const to = resolve(target.replace(/#.*/, "").trim())
      return to ? `[${label}](<${to}>)` : label
    })
  return md.parse(body, { async: false }) as string
}

const fmTitle = (text: string) => /^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$[\s\S]*?\n---/m.exec(text)?.[1]
/** Where a vault file opens: the Mac's or iPhone's app (vaultite://), and the app on the internet when there's one. */
const links = (p: string, app: string | null) => ({ open: `vaultite://open/${p.split("/").map(encodeURIComponent).join("/")}`,
  ...(app ? { web: `${app}/#file/${encodeURIComponent(p)}` } : {}) })

type R = Record<string, unknown>
plugin.provide("mcp:apps", () => [{
  uri: "ui://vaultite/note",
  name: "Note",
  description: "A vault note, drawn, with a link that opens it in Vaultite",
  html: page("note"),
  meta: { prefersBorder: true },
  tools: ["read"],
  data: ({ result, app }: { result: unknown; app: string | null }) => {
    const f = result as R
    const p = String(f?.path ?? "")
    if (!p.endsWith(".md")) return undefined
    const text = String(f.text ?? "")
    return { path: p, title: fmTitle(text) ?? p.split("/").pop()!.replace(/\.md$/, ""), html: noteHtml(text, (t) => plugin.vault.resolveLink(t, p)), partial: f.from !== undefined && f.to !== f.lines,
      ...links(p, app) }
  },
}, {
  uri: "ui://vaultite/tasks",
  name: "Tasks",
  description: "Tasks from a Tasks query, ticked in place",
  html: page("tasks"),
  meta: { prefersBorder: true },
  tools: ["tasks_list"],
  also: ["tasks_complete"],
  data: ({ tool, result, app }: { tool: string; result: unknown; app: string | null }) => {
    const r = result as R
    if (tool !== "tasks_list") return r
    const groups = (r.groups as { names: string[]; tasks: R[] }[] | undefined) ?? []
    return { today: r.today, total: r.total, shown: r.shown, problems: r.problems, app, groups: groups.map((g) => ({ names: g.names, tasks: g.tasks.map((t) => ({
      path: t.path, line: t.line, text: t.text, description: t.description, status: t.status, priority: t.priority, dates: t.dates,
      recurrence: t.recurrence, tags: t.tags, ...links(String(t.path), app) })) })) }
  },
}, {
  uri: "ui://vaultite/board",
  name: "Board",
  description: "A Kanban board: its lanes and cards, moved and ticked in place",
  html: page("board"),
  meta: { prefersBorder: true },
  tools: ["kanban_read"],
  also: ["kanban_move", "kanban_done"],
  data: ({ result, app }: { result: unknown; app: string | null }) => {
    const r = result as R
    return r?.board ? { ...r, ...links(String(r.path), app) } : undefined
  },
}])

// ---------- the host: cards drawn in notes

type Host = {
  tool: (name: string) => Promise<{ declared: R; kind: string | null } | null>
  call: (req: Request, name: string, args: R) => Promise<R>
  read: (uri: string) => Promise<{ contents: { uri: string; mimeType: string; text: string; _meta?: R }[]; csp: string } | null>
}
const host = (): Host => {
  const fn = plugin.service("mcp:app-host")
  if (typeof fn !== "function") throw new HTTPError(404, "the MCP plugin is off")
  return fn() as Host
}
const args = (v: unknown): R => (v && typeof v === "object" && !Array.isArray(v) ? v as R : {})

/** A block's tool: one that only reads (a note drawn mustn't write), with the card that draws it. */
async function blockTool(name: string) {
  const t = await host().tool(name)
  if (!t) throw new OpError(`no tool ${name || "(none)"}: \`vau ops\` lists the operations, each one's tool named`, 404)
  if (t.kind !== "read") throw new OpError(`${name} changes the vault: a block runs only tools that read`)
  return t
}

/** Run a block's tool: its declaration, the card it names (its _meta.ui, which answers leave out as private) and its
 *  CallToolResult. */
plugin.route("POST", "mcp-apps/run", async (req) => {
  const b = args(req.body), name = String(b.tool ?? "")
  const t = await blockTool(name)
  const uri = (t.declared._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri ?? null
  return { tool: t.declared, uri, result: await host().call(req, name, args(b.arguments)) }
}, { lock: false })

/** A card's tools/call: any tool but `call` (which runs any op), as the caller, so an in-app op's checks apply. */
plugin.route("POST", "mcp-apps/call", async (req) => {
  const b = args(req.body), name = String(b.name ?? "")
  if (name === "call" || !(await host().tool(name))) return { content: [{ type: "text", text: `no tool ${name} for cards` }], isError: true }
  return host().call(req, name, args(b.arguments))
}, { lock: false })

plugin.route("GET", "mcp-apps/resource", async (req) => {
  const r = await host().read(String(req.query.uri ?? ""))
  if (!r) throw new HTTPError(404, "no such card")
  return { contents: r.contents }
}, { lock: false })

// The card's page, sandboxed by its own CSP (an opaque origin: none of the app's) with what its _meta.ui declares.
plugin.serve("mcp-app", async (req) => {
  const r = await host().read(String(req.query.uri ?? ""))
  if (!r) throw new HTTPError(404, "no such card")
  return new Text(r.contents[0].text, "text/html; charset=utf-8", {
    "Content-Security-Policy": `sandbox allow-scripts; ${r.csp}`, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  })
})

// What the block shows an agent: its tool's text.
plugin.block("mcp-app", async (ctx) => {
  const name = String(ctx.options.tool ?? "")
  try {
    await blockTool(name)
    const r = await host().call({} as Request, name, args(ctx.options.arguments)) as { content?: { text?: string }[] }
    return r.content?.map((c) => c.text ?? "").join("\n") ?? ""
  } catch (e) { return `_${(e as Error).message}_` }
})
