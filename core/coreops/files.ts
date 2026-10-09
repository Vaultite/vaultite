// The vault as files: read, write, list, search, render. What agents do most, so each is also an MCP tool.
import { actionsFor } from "../actions.ts"
import type { App } from "../app.ts"
import { type Op, OpError, type Who } from "../ops.ts"
import { type Any, enc } from "./common.ts"

/** How much of a file an MCP answer carries (an agent's context is precious; vau prints it whole): more is a page. */
const MAX_TEXT = 100_000
const mcp = (who?: Who) => who?.client === "mcp"

/** Lines `offset` on (1: the first), at most `limit` of them: exactly that stretch of the file, and where it stands. */
function linesOf(text: string, offset?: number, limit?: number) {
  const starts = [0]
  for (let i = text.indexOf("\n"); i >= 0 && i + 1 < text.length; i = text.indexOf("\n", i + 1)) starts.push(i + 1)
  const total = text ? starts.length : 0
  const from = Math.max(1, Math.trunc(offset ?? 1)), to = Math.min(total, limit ? from - 1 + Math.trunc(limit) : total)
  if (from > total) return { text: "", from, to: from - 1, total }
  return { text: text.slice(starts[from - 1], to < total ? starts[to] : text.length), from, to, total }
}

/** A page as an answer: over MCP at most MAX_TEXT characters, cut at a line; a stretch that isn't the whole file ends
 *  saying so, with the offset that goes on. `edit`: how to change it without dropping the rest. */
function paged(p: ReturnType<typeof linesOf>, who: Who | undefined, edit = "") {
  let { text, to } = p
  if (mcp(who) && text.length > MAX_TEXT) {
    const nl = text.lastIndexOf("\n", MAX_TEXT - 1)
    if (nl >= 0) { to = p.from + text.slice(0, nl).split("\n").length - 1; text = text.slice(0, nl + 1) }
    else return `${text.slice(0, MAX_TEXT)}\n\n(line ${p.from} is cut at ${MAX_TEXT} of its ${text.length} characters; vau read prints it whole)`
  }
  if (p.from === 1 && to >= p.total) return text
  return `${text}${text.endsWith("\n") || !text ? "" : "\n"}\n(${to === p.from ? `line ${to}` : `lines ${p.from}-${to}`} of ${p.total}${to < p.total ? `; more: offset ${to + 1}` : ""}${edit})`
}
/** What read gave an agent ended with the note `paged` adds: written back, the rest of the file would be lost. */
const PAGE_NOTE = /\n\((lines \d+-\d+ of \d+|line \d+ (of \d+|is cut at \d+))[^\n]*\)\s*$/
const PAGE = {
  offset: { type: "integer" as const, minimum: 1, description: "the line to start at (1: the first)" },
  limit: { type: "integer" as const, minimum: 1, description: "at most this many lines (all when left out; over MCP a page is at most 100k characters)" },
}
const EDIT = "; to change it: edit_file, or write_file with base"

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
  vau render Health --offset 200 --limit 100      lines 200 to 299`,
    kind: "read",
    params: { path: PATH, ...PAGE },
    args: ["path"],
    run: async ({ path, offset, limit }, ctx) => {
      const p = linesOf(String(await ctx.api("GET", `render?path=${enc(path)}`)), offset, limit)
      return { path, text: p.text, from: p.from, to: p.to, lines: p.total }
    },
    text: (r, _p, who) => {
      const out = paged({ text: r.text, from: r.from, to: r.to, total: r.lines }, who)
      return out === r.text ? out.trimEnd() : out
    },
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
      offset: { type: "integer", minimum: 0, default: 0, description: "skip this many files first (the next page: what the last answer says)" },
      lines: { type: "integer", minimum: 0, maximum: 50, default: 3, description: "up to this many matching lines per file (0: the first match, in a line)" },
      sort: { type: "string", enum: SORTS, description: "the order: relevance (the default), name, modified, created (-old, -desc: the other way)" },
      case: { type: "boolean", description: "words match in their case" },
    },
    args: ["query"],
    run: async ({ query, folder, limit, offset, lines, sort, case: matchCase }, ctx) => {
      const q = String(query).trim()
      if (!q) throw new OpError("query is missing: what to search for")
      // (one more than asked: whether there's a next page)
      const p = new URLSearchParams({ q, limit: String(limit + 1), offset: String(offset), lines: String(lines) })
      if (folder) p.set("folder", folder)
      if (sort) p.set("sort", sort)
      if (matchCase) p.set("case", "1")
      const hits = await ctx.api("GET", `search?${p}`) as Any[]
      return { offset, hits: hits.slice(0, limit), ...(hits.length > limit ? { next: offset + limit } : {}) }
    },
    text: (r, p) => {
      if (!r.hits.length) return r.offset ? `No more matches for ${JSON.stringify(String(p.query).trim())} past ${r.offset}.` : `No matches for ${JSON.stringify(String(p.query).trim())}.`
      const out = (r.hits as Any[]).map((h) => {
        const ms = (h.matches as Any[] | undefined) ?? []
        const head = `- ${h.path}${h.title && !String(h.path).endsWith(`${h.title}.md`) ? ` (${h.title})` : ""}${!ms.length && h.context ? `: ${h.context}` : ""}`
        const more = (h.count ?? 0) - ms.filter((m) => !m.ctx).length
        return [head, ...ms.map((m) => `  - line ${m.line}: ${String(m.text).trim()}`), ...(more > 0 && ms.length ? [`  - (${more} more matching lines: lines up to 50, or read the file)`] : [])].join("\n")
      }).join("\n")
      return r.next ? `${out}\n(more files match: offset ${r.next})` : out
    },
  }, {
    id: "file.read",
    cli: "read",
    mcp: "read",
    summary: "A file's text, as it is on disk (Markdown with its frontmatter).",
    help: `Prints a vault file's text (GET /api/file). Settings files under .vaultite/ work by their exact path. To see
blocks filled in, use vau render. Over MCP the answer starts with the file's path.

  vau read "Notes/Voice journaling.md"
  vau read .vaultite/plugins.json
  vau read "Notes/Long.md" --offset 2000 --limit 500      lines 2000 to 2499`,
    kind: "read",
    params: { path: PATH, ...PAGE },
    args: ["path"],
    run: async ({ path, offset, limit }, ctx) => {
      const f = await ctx.api("GET", `file?path=${enc(path)}`)
      const p = linesOf(String(f.text ?? ""), offset, limit)
      return { ...f, text: p.text, from: p.from, to: p.to, lines: p.total }
    },
    // vau prints the text exactly (`vau read x > a`, then `vau write x --base a`); an MCP client gets which file it is.
    text: (f, _p, who) => {
      const out = paged({ text: String(f.text ?? ""), from: f.from, to: f.to, total: f.lines }, who, mcp(who) ? EDIT : "; to change it: vau edit, or vau write with --base")
      return mcp(who) ? `${f.path}\n\n${out}` : out === f.text ? out.replace(/\n$/, "") : out
    },
  }, {
    id: "file.write",
    cli: "write",
    mcp: "write_file",
    summary: "Write a file's text (made if it's new); with base, edits made meanwhile are merged.",
    help: `Saves a vault file (PUT /api/file), making it if it's new. base is the text you started from (what vau read
gave you): lines changed on disk since then are merged in rather than overwritten, and a clash in the same lines is
refused. Without it the file is replaced. To change part of a file, edit_file (vau edit) is safer: it replaces only
the text it names. A file read in pages is written back only with base (the text you read): the rest is kept.

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
      // A page of a file written back whole would drop the rest: a page's note, or a file too long for one answer.
      const keep = "use edit_file (vau edit) for the change, or pass base: the text you read, so the rest is kept"
      if (base === undefined && PAGE_NOTE.test(String(text))) throw new OpError(`text ends with read's note on a page of ${p}: writing it would drop the rest of the file; ${keep}`)
      if (base === undefined && mcp(ctx.who)) {
        const cur = await ctx.api("GET", `file?path=${enc(p)}`).catch(() => null)
        if (typeof cur?.text === "string" && cur.text.length > MAX_TEXT) throw new OpError(`${p} is longer than one read (${cur.text.length} characters): ${keep}`)
      }
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
    id: "file.edit",
    cli: "edit",
    mcp: "edit_file",
    summary: "Change part of a file: replace a stretch of its text, found exactly; the rest stays as it is.",
    help: `Replaces old with new in a vault file, the rest untouched (what the app's editor does): the safe way to change
part of a long file or one read in pages. old must be found exactly once (give a few lines around it), or with all,
every time. A change made meanwhile elsewhere in the file is kept.

  vau edit Notes/Idea.md --old "status: seed" --new "status: growing"
  vau edit Notes/Idea.md --old "- [ ] Call Alice" --new "- [x] Call Alice"
  vau edit Notes/Idea.md --old "colour" --new "color" --all`,
    kind: "write",
    params: {
      path: { ...PATH, description: "the file to change (Notes/Idea.md)" },
      old: { type: "string", required: true, description: "the text to replace, exactly as in the file (whitespace too), found once unless all" },
      new: { type: "string", required: true, description: "what replaces it (empty: remove it)" },
      all: { type: "boolean", description: "replace it everywhere it's found" },
    },
    args: ["path"],
    run: async ({ path, old, new: by, all }, ctx) => {
      const f = await ctx.api("GET", `file?path=${enc(path)}`)
      const cur = String(f.text ?? ""), from = String(old)
      if (!from) throw new OpError("old is empty: give the text to replace")
      const n = cur.split(from).length - 1
      if (!n) throw new OpError(`old isn't in ${f.path}: read it again (it may have changed) and copy the text exactly`)
      if (n > 1 && !all) throw new OpError(`old is in ${f.path} ${n} times: give more text around it so it's found once, or all: true`)
      const text = all ? cur.split(from).join(String(by)) : cur.replace(from, () => String(by))
      try {
        await ctx.api("PUT", "file", { path: f.path, text, base: cur })
      } catch (e) {
        if (e instanceof OpError && e.status === 409) throw new OpError(`${f.path} changed on disk in the same lines: read it again and redo your change`, 409)
        throw e
      }
      return { path: f.path, replaced: all ? n : 1 }
    },
    text: (r) => `Edited ${r.path}${r.replaced > 1 ? ` (${r.replaced} places)` : ""}.`,
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
      offset: { type: "integer", minimum: 0, default: 0, description: "skip this many first (the next page: what the last answer says)" },
    },
    args: ["folder"],
    run: async ({ folder, limit, offset }, ctx) => {
      const t = await ctx.api("GET", "files") as Any
      const pre = String(folder ?? "").replace(/^\/+|\/+$/g, "")
      const all = [...(t.files ?? []), ...(t.others ?? [])].sort((a: Any, b: Any) => String(a.path).localeCompare(String(b.path)))
      let rows = all.filter((f: Any) => !pre || f.path === pre || String(f.path).startsWith(`${pre}/`))
      if (!rows.length && pre) rows = all.filter((f: Any) => String(f.path).startsWith(pre))
      const files = rows.slice(offset, offset + limit).map((f: Any) => ({ path: f.path, ...(f.type ? { type: f.type } : {}), ...(f.archived ? { archived: true } : {}) }))
      return { folder: pre || null, total: rows.length, offset, files }
    },
    text: (r) => {
      if (!r.files.length) return r.offset ? `No files past ${r.offset} (${r.total} in all).` : r.folder ? `Nothing under ${r.folder}/.` : "The vault is empty."
      const shown = r.files.map((f: Any) => `- ${f.path}${f.type ? ` (${f.type}${f.archived ? ", archived" : ""})` : f.archived ? " (archived)" : ""}`)
      const end = r.offset + shown.length
      return shown.join("\n") + (r.offset || r.total > end ? `\n(files ${r.offset + 1}-${end} of ${r.total}${r.total > end ? `; more: offset ${end}, or narrow it with a folder` : ""})` : "")
    },
  }]
}
