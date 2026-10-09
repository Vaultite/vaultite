// Web clipper (Defuddle on linkedom): a page, fetched or given as `html` (a logged-in page), saved as
// a note; one clipped before is answered (the app opens it and offers Update: `update` clips it into that note again).
// Only writing holds the vault (`lock: false`).
import fs from "node:fs"
import path from "node:path"
import { fetchPublic, HTTPError, OpError, pageText, Plugin, publicUrl, reply, vaultPath } from "../../../core/plugins.ts"
import { FM, frontmatter, type Item, nowUtc, readText, safeName, setPropertyText, str, writeAtomic } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

const MAX_HTML = 8 * 1024 * 1024
const TIMEOUT = 15_000

/** What a page reads as: Defuddle's answer, the Markdown and what it says about itself. */
export type Clipped = { title: string; markdown: string; author: string; published: string; description: string; site: string; words: number }

/** A page's HTML read by Defuddle, with links and images made absolute against `url`. `fetchMore`: Defuddle may ask
 *  a site's own API when the page itself has nothing (a video's transcript): only for a page the server fetched. */
export async function readPage(html: string, url: string, fetchMore = false): Promise<Clipped> {
  const [{ parseHTML }, { Defuddle }] = await Promise.all([import("linkedom"), import("defuddle/node")])
  const { document } = parseHTML(html)
  // What Defuddle asks of a browser's DOM that linkedom doesn't have (as defuddle's own linkedom-compat does).
  const doc = document as unknown as Item
  doc.styleSheets ??= []
  if (doc.defaultView && !doc.defaultView.getComputedStyle) doc.defaultView.getComputedStyle = () => ({ display: "" })
  try { doc.URL = url } catch { /* read-only here */ }
  const r = await Defuddle(document as unknown as Document, url, { markdown: true, useAsync: fetchMore })
  return {
    title: str(r.title).trim(), markdown: str(r.content).trim(), author: str(r.author).trim(), published: str(r.published).trim(),
    description: str(r.description).replace(/\s+/g, " ").trim(), site: str(r.site).trim(), words: Number(r.wordCount) || 0,
  }
}

/** A published date as YYYY-MM-DD, or "" when it doesn't read as one. */
export function dateOf(s: string) {
  const m = /^(\d{4}-\d\d-\d\d)/.exec(s.trim())
  if (m) return m[1]
  const t = Date.parse(s)
  return Number.isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10)
}

/** The address a clip is known by (its `source`): without its #fragment. */
const sameUrl = (u: string) => u.replace(/#.*$/, "")

/** The note's text: frontmatter (the vault's note format, Obsidian Web Clipper's keys) and the content. */
export function noteText(c: Clipped, url: string, tags: string[], title: string, now = nowUtc(), inbox: string | null = null) {
  // A note, or a result to review in the inbox (`inbox`: who clipped it).
  const fm: Item = inbox === null ? { type: "note", kind: "note" } : { type: "inbox", status: "new", from: inbox }
  if (safeName(title) !== title) { fm.title = title; fm.aliases = [title] }
  fm.source = sameUrl(url)
  if (c.author) fm.author = [c.author]
  const published = dateOf(c.published)
  if (published) fm.published = published
  if (c.description) fm.description = c.description.length > 300 ? `${c.description.slice(0, 297)}...` : c.description
  if (tags.length) fm.tags = tags
  fm.created = now
  fm.updated = now
  return frontmatter(fm, c.markdown)
}

function settings() {
  const s = plugin.settings({})
  return { folder: typeof s.folder === "string" && s.folder.trim() ? s.folder : "Clippings", tags: Array.isArray(s.tags) ? s.tags.map(String) : ["Clipping"],
    inbox: s.inbox === true }
}

/** A file name for the title in `folder` that's free ("Title.md", "Title 1.md"...). */
function freePath(folder: string, title: string) {
  // (no dots at either end: "Markdown." would be "Markdown..md", and a leading one hides the file)
  const name = [...safeName(title)].slice(0, 120).join("").replace(/^[.\s]+|[.\s]+$/g, "") || "Untitled"
  for (let n = 0; ; n++) {
    const rel = `${folder ? `${folder}/` : ""}${n ? `${name} ${n}` : name}.md`
    if (!plugin.vault.entries.has(rel) && !fs.existsSync(plugin.vault.abs(rel))) return rel
  }
}

type Clip = { path: string; title: string; url: string; words?: number; existing: boolean; updated?: boolean }

/** A note clipped before, with the page as it is now: its content and what the page says about itself (author,
 *  published, description), `updated` now; the user's own keys (tags, a title) stay as they are. */
export function updatedText(text: string, c: Clipped, now = nowUtc()): string {
  let out: string | null = text
  const set = (k: string, v: unknown) => { if (out !== null) out = setPropertyText(out, k, v) }
  if (c.author) set("author", [c.author])
  const published = dateOf(c.published)
  if (published) set("published", published)
  if (c.description) set("description", c.description.length > 300 ? `${c.description.slice(0, 297)}...` : c.description)
  set("updated", now)
  if (out === null) throw new HTTPError(409, "its frontmatter doesn't read: fix it before updating the clip")
  const m = FM.exec(out)
  return `${m ? m[0] : ""}\n${c.markdown.trim()}\n`
}

/** Clip a page ({url, html?, folder?, tags?, inbox?, from?, update?}, the route's body): its note, made, or found (with
 *  `update`: clipped into again). Holds the vault only to write it. */
async function clip(b: Item): Promise<Clip> {
  const raw = str(b.url).trim()
  if (!raw) throw new HTTPError(400, "url: the page's address")
  let url: string
  try { url = new URL(raw).href } catch { throw new HTTPError(400, `not a web address: ${raw}`) }
  if (!/^https?:/.test(url)) throw new HTTPError(400, "only http and https pages can be clipped")
  const s = settings()
  // Into the inbox (asked, or the setting), while the Inbox plugin is on to say where that is.
  const inboxFolder = b.inbox === false ? null : b.inbox === true || s.inbox ? plugin.service("inbox:folder")?.() ?? null : null
  if (b.inbox === true && !inboxFolder) throw new HTTPError(400, "the Inbox plugin is off: clip without inbox, or turn it on")
  const folder = inboxFolder ? inboxFolder : b.folder !== undefined && str(b.folder).trim() ? vaultPath(b.folder, false, plugin.vault) : s.folder ? vaultPath(s.folder, false, plugin.vault) : ""
  const tags = Array.isArray(b.tags) ? b.tags.map((t: unknown) => str(t).trim()).filter(Boolean) : typeof b.tags === "string" ? b.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : s.tags

  // Clipped before: that file.
  const known = () => [...plugin.vault.entries.values()].find((e) => typeof e.fm.source === "string" && sameUrl(e.fm.source) === sameUrl(url))
  const before = known()
  if (before && b.update !== true) return { path: before.rel, title: str(before.fm.title) || path.basename(before.rel, ".md"), url, existing: true }

  let html: string
  if (typeof b.html === "string" && b.html.trim()) {
    if (b.html.length > MAX_HTML) throw new HTTPError(413, `the page's HTML is over ${MAX_HTML >> 20} MB`)
    html = b.html
  } else {
    const ok = publicUrl(url)
    if (typeof ok === "string") throw new HTTPError(400, `the server doesn't fetch ${url} (${ok}): send its html instead`)
    let page
    try {
      page = await fetchPublic(ok, { max: MAX_HTML, timeout: TIMEOUT, types: /html|xml/ })
    } catch (e) {
      throw new HTTPError(502, `couldn't fetch ${url}: ${(e as Error).message}`)
    }
    if (page.status < 200 || page.status >= 300) throw new HTTPError(502, `${url} answered ${page.status}`)
    if (!page.body.length) throw new HTTPError(415, `${url} isn't a web page (${page.type || "no type"})`)
    html = pageText(page.type, page.body)
    url = page.url // where it ended up, after redirects
  }
  let c: Clipped
  try {
    c = await readPage(html, url, typeof b.html !== "string")
  } catch (e) {
    throw new HTTPError(422, `couldn't read the page: ${(e as Error).message}`)
  }
  if (!c.markdown) throw new HTTPError(422, `found no text to clip on ${url}`)
  const title = c.title || new URL(url).hostname

  // Only the write holds the vault: the file is named after a sync, so two clips at once don't take the same name.
  return plugin.vault.lock(async () => {
    await plugin.vault.sync()
    const again = known()
    if (again) {
      const was = { path: again.rel, title: str(again.fm.title) || path.basename(again.rel, ".md"), url, existing: true }
      if (b.update !== true) return was
      const abs = plugin.vault.abs(again.rel), text = readText(abs), next = updatedText(text, c)
      if (next !== text) writeAtomic(abs, next)
      await plugin.vault.sync()
      return { ...was, words: c.words, updated: true }
    }
    const rel = freePath(folder, title)
    writeAtomic(plugin.vault.abs(rel), noteText(c, url, tags, title, nowUtc(), inboxFolder ? str(b.from).trim().slice(0, 60) || "Web clipper" : null))
    await plugin.vault.sync()
    await plugin.vault.fillIn(rel, null) // (its id and dates, as the notes plugin gives a new note)
    return { path: rel, title, url, words: c.words, existing: false }
  })
}


plugin.route("POST", "clip", async (req) => {
  if (plugin.isOff()) throw new HTTPError(404, "the Web clipper plugin is off (Settings > Plugins)")
  const r = await clip((req.body ?? {}) as Item)
  return r.existing ? r : reply(201, r)
}, { lock: false })

plugin.op({
  id: "clipper.save",
  cli: "clip",
  mcp: "clip",
  summary: "Save a web page to the vault as a Markdown note (its main content, without menus and ads), with its source, author and date.",
  help: `The page's main content as Markdown (Defuddle), with its source, title, author,
published date and description, in Clippings/ (the Web clipper's folder) unless folder says otherwise. The server
fetches the page (public addresses only); to clip a page only you can see (logged in), give its HTML too (from a
terminal: --html - < page.html), its links made absolute against the url. inbox puts it in the user's inbox to review
(Inbox/) instead. A page clipped before isn't clipped again: its note is answered; update clips it into that note again
(its content as the page is now, the note's own keys kept).

  vau clip https://example.com/posts/an-article
  vau clip https://example.com/a --folder Notes/Reading --tags "Clipping, Reading"
  vau clip https://example.com/private --html - < ~/Downloads/page.html
  vau clip https://example.com/long-read --inbox
  vau clip https://example.com/a --update`,
  kind: "write",
  lock: false, // fetching and reading the page holds nothing; writing the note holds the vault (clip)
  params: {
    url: { type: "string", required: true, description: "the page's address (http or https)" },
    html: { type: "string", description: "the page's HTML, when you have it (else the server fetches the url)" },
    folder: { type: "string", description: "where the note goes (default Clippings, the plugin's setting)" },
    tags: { type: "array", items: { type: "string" }, description: "its tags (default Clipping)" },
    inbox: { type: "boolean", description: "put it in the user's inbox to review (Inbox/) instead of a folder" },
    update: { type: "boolean", description: "clipped before: replace its note's content with the page as it is now" },
  },
  args: ["url"],
  run: async (p, ctx) => {
    if (p.html !== undefined && !/<[a-z!]/i.test(p.html)) throw new OpError("html is the page's HTML itself, not a file's name (from a terminal: --html - < page.html)")
    try {
      return await clip({ ...p, ...(p.inbox ? { from: ctx.who.label } : {}) })
    } catch (e) {
      if (e instanceof HTTPError) throw new OpError(e.message, e.status)
      throw e
    }
  },
  text: (r: Clip) => (r.updated ? `Updated ${r.path} ("${r.title}") with the page as it is now (${r.words ?? "?"} words).`
    : r.existing ? `Already clipped: ${r.path} ("${r.title}"). To replace its content with the page as it is now: update.`
    : `Clipped "${r.title}" to ${r.path} (${r.words ?? "?"} words).`),
})
