// The vault as files: read, write, list, search, render. What agents do most, so each is also an MCP tool.
import { actionsFor } from "../actions.ts"
import type { App } from "../app.ts"
import { type Op, OpError, type Who } from "../ops.ts"
import { type Any, enc } from "./common.ts"

/** How much of a file an MCP answer carries (an agent's context is precious; vau prints it whole). */
const MAX_TEXT = 100_000
const cut = (t: string, total = true) => (t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}\n\n(cut at ${MAX_TEXT} characters${total ? ` of ${t.length}` : ""})` : t)
const mcp = (who?: Who) => who?.client === "mcp"

const PATH = { type: "string" as const, format: "path", required: true, description: "a vault path (Notes/Idea.md, People/Alice Park.md) or a file's name (Today, Alice Park)" }
const SORTS = ["relevance", "name", "name-desc", "modified", "modified-old", "created", "created-old"]

export function fileOps(app: App): Op[] {
  return [{
    id: "file.render",
    cli: "render",
    mcp: "render",
    summary: "A file as the user sees it: its Markdown with every block filled in as text.",
    help: `Reads a file the way the app draws it (GET /api/render): dashboards' blocks become their text (today's routines,
this week's goals, a person's profile, a project's numbers). The quickest way to answer "what's on today" (render
Today) or "how's my week". Saves nothing. A name works too ("Today", "Alice Park").

  vau render Dashboards/Today.md
  vau render "People/Alice Park.md"
  vau render Health`,
    kind: "read",
    params: { path: PATH },
    args: ["path"],
    run: async ({ path }, ctx) => ({ path, text: String(await ctx.api("GET", `render?path=${enc(path)}`)) }),
    text: (r, _p, who) => (mcp(who) ? cut(r.text, false) : r.text.trimEnd()),
  }, {
    id: "file.search",
    cli: "search",
    mcp: "search",
    summary: "Search the vault's files (notes, people, logs, books, projects...), best first, with search operators.",
    help: `Finds files matching a query (GET /api/search), best first, with the lines that matched. Plain words: every
word in the file's name or text, any order. Operators work too: "a phrase", -word, a OR b, ( ), /regex/,
file:, path:, content:, tag:#x, line:(a b), block:(a b), section:(a b), task:, task-todo:, task-done:, match-case:,
[property] and [property:value]. Quote the whole query so the shell keeps its quotes and brackets.

  vau search climbing
  vau search "coffee sam"
  vau search 'tag:#project "next step" -done'
  vau search '[status:seed] path:Notes' --sort modified
  vau search 'task-todo:call' --lines 5        every unticked task that has "call", under its file`,
    kind: "read",
    params: {
      query: { type: "string", required: true, description: "what to look for, with search operators" },
      folder: { type: "string", description: "only this folder (People, Logs/Workouts)" },
      limit: { type: "integer", minimum: 1, maximum: 500, default: 20, description: "at most this many files" },
      lines: { type: "integer", minimum: 0, maximum: 50, default: 3, description: "up to this many matching lines per file (0: the first match, in a line)" },
      sort: { type: "string", enum: SORTS, description: "the order: relevance (the default), name, modified, created (-old, -desc: the other way)" },
      case: { type: "boolean", description: "words match in their case" },
    },
    args: ["query"],
    run: async ({ query, folder, limit, lines, sort, case: matchCase }, ctx) => {
      const q = String(query).trim()
      if (!q) throw new OpError("query is missing: what to search for")
      const p = new URLSearchParams({ q, limit: String(limit), lines: String(lines) })
      if (folder) p.set("folder", folder)
      if (sort) p.set("sort", sort)
      if (matchCase) p.set("case", "1")
      return await ctx.api("GET", `search?${p}`)
    },
    text: (hits: Any[], p) => {
      if (!hits.length) return `No matches for ${JSON.stringify(String(p.query).trim())}.`
      return hits.map((h) => {
        const ms = (h.matches as Any[] | undefined) ?? []
        const head = `- ${h.path}${h.title && !String(h.path).endsWith(`${h.title}.md`) ? ` (${h.title})` : ""}${!ms.length && h.context ? `: ${h.context}` : ""}`
        return [head, ...ms.map((m) => `  - line ${m.line}: ${String(m.text).trim().slice(0, 240)}`)].join("\n")
      }).join("\n")
    },
  }, {
    id: "file.read",
    cli: "read",
    mcp: "read",
    summary: "A file's text, as it is on disk (Markdown with its frontmatter).",
    help: `Prints a vault file's text (GET /api/file). Settings files under .vaultite/ work by their exact path. To see
blocks filled in, use vau render. Over MCP the answer starts with the file's path.

  vau read "Notes/Voice journaling.md"
  vau read .vaultite/plugins.json`,
    kind: "read",
    params: { path: PATH },
    args: ["path"],
    run: async ({ path }, ctx) => await ctx.api("GET", `file?path=${enc(path)}`),
    // vau prints the text exactly (`vau read x > a`, then `vau write x --base a`); an MCP client gets which file it is.
    text: (f, _p, who) => (mcp(who) ? `${f.path}\n\n${cut(String(f.text ?? ""))}` : String(f.text ?? "").replace(/\n$/, "")),
  }, {
    id: "file.write",
    cli: "write",
    mcp: "write_file",
    summary: "Write a file's text (made if it's new); with base, edits made meanwhile are merged.",
    help: `Saves a vault file (PUT /api/file), making it if it's new. base is the text you started from (what vau read
gave you): lines changed on disk since then are merged in rather than overwritten, and a clash in the same lines is
refused. Without it the file is replaced. Prefer small edits: read, change, write with base.

From vau, the text comes from --from <file> or stdin, and --base <file> is the file holding the text you started from:

  echo "Some text" | vau write Notes/Scratch.md
  vau read Notes/Idea.md > /tmp/a && cp /tmp/a /tmp/b && $EDITOR /tmp/b && vau write Notes/Idea.md --from /tmp/b --base /tmp/a`,
    kind: "destructive",
    params: {
      path: { type: "string", required: true, description: "the vault path to write (Notes/Idea.md)" },
      text: { type: "string", required: true, description: "the file's whole new text (vau: --from <file>, or stdin)" },
      base: { type: "string", description: "the text you started from, to merge with changes made meanwhile (vau: --base <file>)" },
    },
    args: ["path"],
    run: async ({ path, text, base }, ctx) => {
      const p = String(path).replace(/^\/+/, "")
      // What read gave an AI is cut for a long file: writing that back would drop the rest.
      if (/\n\n\(cut at \d+ characters( of \d+)?\)$/.test(String(text))) throw new OpError(`text ends where read cut ${p}: writing it would drop the rest of the file; edit a shorter file, or make the change with another operation`)
      try {
        await ctx.api("PUT", "file", { path: p, text, ...(base !== undefined ? { base } : {}) })
      } catch (e) {
        if (e instanceof OpError && e.status === 409) throw new OpError(`${p} changed on disk in the same lines: read it again and redo your change`, 409)
        throw e
      }
      return { path: p, bytes: Buffer.byteLength(text) }
    },
    text: (r) => `Wrote ${r.path} (${r.bytes} bytes).`,
  }, {
    id: "file.move",
    cli: "move",
    summary: "Rename or move a file or folder; links to it across the vault are updated.",
    help: `Moves a vault file or folder (POST /api/file/move), like the file tree does: every [[link]], ![[embed]] and
Markdown link to what moved is pointed at its new path, and open tabs follow it. Refused when the target exists.

  vau move "Notes/Idea.md" "Notes/Better idea.md"
  vau move Attachments/Screenshot.png Attachments/Chart.png`,
    kind: "write",
    params: {
      from: { ...PATH, description: "the file or folder to move (Notes/Idea.md)" },
      to: { type: "string", required: true, description: "its new vault path (Notes/Better idea.md)" },
    },
    args: ["from", "to"],
    run: async ({ from, to }, ctx) => {
      const f = String(from).replace(/^\/+/, ""), ext = /\.[^./]+$/.exec(f)?.[0] ?? ""
      let t = String(to).replace(/^\/+|\/+$/g, "")
      if (ext && !/\.[a-z0-9]{1,8}$/i.test(t)) t += ext // "Notes/Better idea" keeps the .md
      return await ctx.api("POST", "file/move", { from: f, to: t })
    },
    text: (r) => `Moved to ${r.path}${r.updated?.length ? `; links updated in ${r.updated.join(", ")}` : ""}.`,
  }, {
    id: "file.actions",
    cli: "actions",
    mcp: "actions",
    summary: "What can be done with a file: the operations that act on its kind (a person's timeline, a book's progress), the file filled in.",
    help: `Lists a file's actions: each op that acts on its type, with the parameter the file fills and the ones still to
give. The app's menus show the same list. Run one with the op's id (vau <id>, the MCP call tool).

  vau actions "Alice Park"
  vau actions Books/Dune.md`,
    kind: "read",
    params: { path: PATH },
    args: ["path"],
    run: async ({ path }, ctx) => {
      const t = await ctx.api("GET", "files") as Any
      const f = [...(t.files ?? []), ...(t.others ?? [])].find((x: Any) => x.path === path)
      if (!f) throw new OpError(`no file '${path}' (vau files lists them)`, 404)
      const file = { path, type: f.type ?? null, archived: !!f.archived }
      return { ...file, actions: actionsFor(app.catalog(), file).map(({ entry: _, menu: _m, ...a }) => a) }
    },
    text: (r) => {
      if (!r.actions.length) return `Nothing acts on ${r.path}${r.type ? ` (${r.type})` : ""} yet.`
      return r.actions.map((a: Any) => {
        const given = Object.entries(a.params).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")
        return `- ${a.label}: ${a.op} ${given}${a.needs.length ? `, needs ${a.needs.join(", ")}` : ""}`
      }).join("\n")
    },
  }, {
    id: "file.list",
    cli: "files",
    mcp: "list",
    summary: "List the vault's files under a folder (all of them without one), each with its type.",
    help: `Lists vault paths (GET /api/files): notes, and every other file (artifacts, tables, images), each with its type
(person, note, log, dashboard...). Folders are the user's: list the top first. A folder that's no folder is read as
the start of paths ("Dash").

  vau files
  vau files People
  vau files Logs/Workouts`,
    kind: "read",
    params: {
      folder: { type: "string", description: "a folder (People, Logs/Workouts); the whole vault when left out" },
      limit: { type: "integer", minimum: 1, default: 1000, description: "at most this many files" },
    },
    args: ["folder"],
    run: async ({ folder, limit }, ctx) => {
      const t = await ctx.api("GET", "files") as Any
      const pre = String(folder ?? "").replace(/^\/+|\/+$/g, "")
      const all = [...(t.files ?? []), ...(t.others ?? [])].sort((a: Any, b: Any) => String(a.path).localeCompare(String(b.path)))
      let rows = all.filter((f: Any) => !pre || f.path === pre || String(f.path).startsWith(`${pre}/`))
      if (!rows.length && pre) rows = all.filter((f: Any) => String(f.path).startsWith(pre))
      const files = rows.slice(0, limit).map((f: Any) => ({ path: f.path, ...(f.type ? { type: f.type } : {}), ...(f.archived ? { archived: true } : {}) }))
      return { folder: pre || null, total: rows.length, files }
    },
    text: (r) => {
      if (!r.files.length) return r.folder ? `Nothing under ${r.folder}/.` : "The vault is empty."
      const shown = r.files.map((f: Any) => `- ${f.path}${f.type ? ` (${f.type}${f.archived ? ", archived" : ""})` : f.archived ? " (archived)" : ""}`)
      return shown.join("\n") + (r.total > shown.length ? `\n(${r.total - shown.length} more: narrow it with a folder)` : "")
    },
  }]
}
