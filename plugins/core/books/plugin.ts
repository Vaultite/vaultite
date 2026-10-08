// Books: Books/<Title>.md (format: AGENTS.md).
import { bullets, OpError, Plugin, section, today } from "../../../core/plugins.ts"
import { isArchived, type Item, Kind, nowUtc, num, sortBy, str, truthy } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

const STATUSES = ["reading", "want", "done", "dropped"]

plugin.kind(new Kind({
  type: "book", collection: "books", folder: "Books",
  parse(fm, body, stem) {
    const status = truthy(fm.status) ? fm.status : "want"
    return [{
      title: truthy(fm.title) ? str(fm.title) : stem, author: truthy(fm.author) ? str(fm.author) : "", status,
      total_pages: num(fm.total_pages), current_page: num(fm.current_page),
      started: fm.started ?? null, finished: fm.finished ?? null, rating: num(fm.rating),
      created: fm.created ?? null, notes: body,
    }, STATUSES.includes(status) ? [] : [`status \`${str(status)}\` is not one of ['reading', 'want', 'done', 'dropped']`]]
  },
  render: (b) => [{
    author: b.author, status: b.status || "want", total_pages: b.total_pages,
    current_page: b.current_page || null, started: b.started, finished: b.finished,
    rating: b.rating, created: b.created,
  }, b.notes || ""],
  prepare(b) {
    b.created = b.created || nowUtc()
    return b
  },
  order: (bs) => sortBy(sortBy(bs, (b) => str(b.finished || b.created || ""), true),
    (b) => Math.min(STATUSES.includes(b.status) ? STATUSES.indexOf(b.status) : 2, 2)),
  key: (b) => str(b.title).toLowerCase(),
  blocks: ["book"],
}))

// ---------- operations (core/ops.ts)

plugin.op({
  id: "book.progress",
  mcp: "book_progress",
  summary: "Note how far the user is in a book (its current page), and its status (reading, done...) when that changed.",
  help: `The book by its title (Books/<Title>.md, any case). Starting one sets status reading (and started, today, when it
has none); finishing it, status done (and finished, today). A new book is a file in Books/ (vau docs books).

  vau book.progress "The Overstory" 212
  vau book.progress "The Overstory" --status done --rating 5`,
  kind: "write",
  params: {
    book: { type: "string", required: true, description: "its title, as in Books/<Title>.md" },
    page: { type: "integer", minimum: 0, description: "the page the user is on" },
    status: { type: "string", enum: STATUSES, description: "reading, want, done or dropped" },
    rating: { type: "integer", minimum: 1, maximum: 5, description: "1 to 5, once it's done" },
  },
  args: ["book", "page"],
  action: { on: ["book"], param: "book", from: "name", label: "Update progress", ask: ["page"], icon: "book-open" },
  run: async ({ book, page, status, rating }, ctx) => {
    const b = plugin.vault.get("books", book) ?? plugin.vault.items("books").find((x) => str(x.title).toLowerCase() === book.trim().toLowerCase())
    if (!b) throw new OpError(`no book '${book}' in Books/ (a new one is a file there: vau docs books)`, 404)
    const patch: Item = {}
    if (page !== undefined) patch.current_page = page
    const st = status ?? (page !== undefined && b.status === "want" ? "reading" : undefined)
    if (st) patch.status = st
    if (st === "reading" && !b.started) patch.started = today()
    if (st === "done" && !b.finished) patch.finished = today()
    if (rating !== undefined) patch.rating = rating
    if (!Object.keys(patch).length) throw new OpError("say what changed: page, status or rating")
    const r = await ctx.api("PUT", `books/${encodeURIComponent(b.id)}`, patch)
    return { path: `${r.id}.md`, title: r.title, status: r.status, current_page: r.current_page, total_pages: r.total_pages }
  },
  text: (r) => `${r.title}: ${r.status}${r.current_page ? `, page ${r.current_page}${r.total_pages ? ` of ${r.total_pages}` : ""}` : ""}.`,
})

// ---------- blocks as text (GET /api/render) ----------

function line(b: Item) {
  const pages = b.current_page && b.total_pages ? `, page ${b.current_page} of ${b.total_pages}` : ""
  const started = b.status === "reading" && b.started && !pages ? `, started ${b.started}` : ""
  const rating = b.status === "done" && b.rating ? `, ${b.rating}/5` : ""
  return `${b.title}${b.author ? " by " + b.author : ""}${pages}${started}${rating}`
}

plugin.block("book", (ctx) => {
  const b = plugin.vault.items("books").find((x) => x.id + ".md" === ctx.path)
  if (!b) return ""
  return bullets([
    b.author ? `Author: ${b.author}` : "", `Status: ${b.status}`,
    b.current_page && b.total_pages ? `Page ${b.current_page} of ${b.total_pages}` : "",
    b.started ? `Started: ${b.started}` : "", b.finished ? `Finished: ${b.finished}` : "",
    b.rating ? `Rating: ${b.rating} of 5` : "",
  ])
})

// The same groups as the card (Books.tsx): reading, the next five and the last five finished; empty ones left out.
plugin.block("books", (ctx) => {
  const bs = plugin.vault.items("books").filter((b) => !isArchived(b))
  const groups: [string, Item[]][] = [
    ["Reading", bs.filter((b) => b.status === "reading")],
    ["Up next", bs.filter((b) => b.status === "want").slice(0, 5)],
    ["Finished", bs.filter((b) => b.status === "done").slice(0, 5)],
  ]
  ctx.source(groups.map(([, g]) => g))
  const parts = groups.filter(([, g]) => g.length).map(([title, g]) => `${title}:\n${bullets(g.map(line))}`)
  return section("Books", ...(parts.length ? parts : ["_No books yet._"]))
})
