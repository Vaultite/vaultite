import fs from "node:fs"
import path from "node:path"
import { fetchPublic, HTTPError, OpError, pageText, Plugin, publicUrl, reply, vaultPath } from "../../../core/plugins.ts"
import { FM, frontmatter, type Item, nowStamp, readText, safeName, setPropertyText, str, writeAtomic } from "../../../core/vault.ts"
import { unescapeTurndownLists } from "./escapes.ts"

export const plugin = new Plugin(import.meta.url)

const TIMEOUT = 15_000

export type Clipped = { title: string; markdown: string; author: string; published: string; description: string; site: string; words: number; video: boolean | null }

export async function readPage(html: string, url: string, fetchMore = false): Promise<Clipped> {
  const [{ parseHTML }, { Defuddle }] = await Promise.all([import("linkedom"), import("defuddle/node")])
  const { document } = parseHTML(html)
  // Defuddle asks for these, which linkedom's DOM lacks (as defuddle's own linkedom-compat adds).
  const doc: { styleSheets?: unknown; defaultView?: { getComputedStyle?: unknown } | null; URL?: string } = document
  doc.styleSheets ??= []
  if (doc.defaultView && !doc.defaultView.getComputedStyle) doc.defaultView.getComputedStyle = () => ({ display: "" })
  try { doc.URL = url } catch {}
  const post = xPost(url)
  const video = post ? videoOnPage(document, post.id) : null
  const r = await Defuddle(document, url, { markdown: true, useAsync: fetchMore })
  return {
    title: str(r.title).trim(), markdown: unescapeTurndownLists(str(r.content).trim()), author: str(r.author).trim(), published: str(r.published).trim(),
    description: str(r.description).replace(/\s+/g, " ").trim(), site: str(r.site).trim(), words: Number(r.wordCount) || 0, video,
  }
}

export function xPost(url: string): { user: string; id: string } | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (!/^((www|mobile)\.)?(x|twitter)\.com$/i.test(u.hostname)) return null
  const m = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/.exec(u.pathname)
  return m ? { user: m[1], id: m[2] } : null
}

// X draws a quoted post as a link inside the post, and a GIF as a video from tweet_video.
export function videoOnPage(document: Document, id: string): boolean | null {
  const posts = [...document.querySelectorAll('article[data-testid="tweet"]')]
  if (!posts.length) return null
  const own = posts.find((a) => [...a.querySelectorAll("time")].some((t) => new RegExp(`/status/${id}(?:$|[/?#])`).test(t.closest("a")?.getAttribute("href") ?? "")))
  if (!own) return null
  return [...own.querySelectorAll("video")].some((v) => {
    const quoted = v.closest('[role="link"]')
    return !(quoted && own.contains(quoted)) && !/tweet_video/.test(`${v.getAttribute("poster") ?? ""} ${v.getAttribute("src") ?? ""} ${v.querySelector("source")?.getAttribute("src") ?? ""}`)
  })
}

async function videoByApi(post: { user: string; id: string }): Promise<boolean> {
  try {
    const r = await fetchPublic(`https://api.fxtwitter.com/${post.user}/status/${post.id}`, { timeout: TIMEOUT, types: /json/ })
    if (r.status < 200 || r.status >= 300) return false
    const videos = JSON.parse(r.body.toString("utf8"))?.tweet?.media?.videos
    return Array.isArray(videos) && videos.some((v: Item) => v?.type !== "gif")
  } catch { return false }
}

export function dateOf(s: string) {
  const m = /^(\d{4}-\d\d-\d\d)/.exec(s.trim())
  if (m) return m[1]
  const t = Date.parse(s)
  return Number.isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10)
}

const sameUrl = (u: string) => u.replace(/#.*$/, "")

export function noteText(c: Clipped, url: string, tags: string[], title: string, now = nowStamp(), inbox: string | null = null) {
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
    inbox: s.inbox === true, videos: s.videos !== false }
}

function freePath(folder: string, title: string) {
  // A leading dot hides the file.
  const name = [...safeName(title)].slice(0, 120).join("").replace(/^[.\s]+|[.\s]+$/g, "") || "Untitled"
  for (let n = 0; ; n++) {
    const rel = `${folder ? `${folder}/` : ""}${n ? `${name} ${n}` : name}.md`
    if (!plugin.vault.entries.has(rel) && !fs.existsSync(plugin.vault.abs(rel))) return rel
  }
}

type Clip = { path: string; title: string; url: string; words?: number; existing: boolean; updated?: boolean; video?: true; videoError?: string }

const EMBED = /^!\[\[([^\]|#]+)[^\]]*\]\]$/
const MEDIA = /\.(mp4|m4v|mov|webm|mkv|m4a|mp3|ogg|opus|wav)$/i
const headingOf = (section: string) => section.split("\n")[0].trim()
const sectionsOf = (body: string) => body.split(/^(?=## )/m).filter((p) => p.startsWith("## ")).map((p) => p.trim())
function topEmbeds(body: string) {
  const out: string[] = []
  for (const l of body.split("\n").map((x) => x.trim())) {
    if (EMBED.test(l)) out.push(l)
    else if (l) break
  }
  return out
}
const startsWithMedia = (body: string) => topEmbeds(body).some((l) => MEDIA.test(EMBED.exec(l)![1].trim()))

export function withVideo(text: string, body: string, now = nowStamp()): string {
  const m = FM.exec(text), fm = m ? m[0] : "", clip = text.slice(fm.length).trim()
  const embeds = body.split(/^## /m)[0].split("\n").map((l) => l.trim()).filter((l) => EMBED.test(l) && !clip.includes(l))
  const had = new Set(sectionsOf(clip).map(headingOf))
  const sections = sectionsOf(body).filter((x) => !had.has(headingOf(x)))
  if (!embeds.length && !sections.length) return text
  const next = setPropertyText(`${fm}\n${[embeds.join("\n\n"), clip, ...sections].filter(Boolean).join("\n\n")}\n`, "updated", now)
  return next ?? text
}

function keepingVideo(body: string, markdown: string) {
  if (!startsWithMedia(body)) return markdown
  const has = new Set(sectionsOf(markdown).map(headingOf))
  const top = topEmbeds(body).filter((l) => !markdown.includes(l)).join("\n\n")
  return [top, markdown, ...sectionsOf(body).filter((x) => !has.has(headingOf(x)))].filter(Boolean).join("\n\n")
}

export function updatedText(text: string, c: Clipped, now = nowStamp()): string {
  let out: string | null = text
  const set = (k: string, v: unknown) => { if (out !== null) out = setPropertyText(out, k, v) }
  if (c.author) set("author", [c.author])
  const published = dateOf(c.published)
  if (published) set("published", published)
  if (c.description) set("description", c.description.length > 300 ? `${c.description.slice(0, 297)}...` : c.description)
  set("updated", now)
  if (out === null) throw new HTTPError(409, "its frontmatter doesn't read: fix it before updating the clip")
  const m = FM.exec(out), fm = m ? m[0] : ""
  return `${fm}\n${keepingVideo(out.slice(fm.length), c.markdown.trim())}\n`
}

async function clip(b: Item, saveVideo: (url: string) => Promise<unknown>): Promise<Clip> {
  const raw = str(b.url).trim()
  if (!raw) throw new HTTPError(400, "url: the page's address")
  let url: string
  try { url = new URL(raw).href } catch { throw new HTTPError(400, `not a web address: ${raw}`) }
  if (!/^https?:/.test(url)) throw new HTTPError(400, "only http and https pages can be clipped")
  const s = settings()
  const inboxFolder = b.inbox === false ? null : b.inbox === true || s.inbox ? plugin.service("inbox:folder")?.() ?? null : null
  if (b.inbox === true && !inboxFolder) throw new HTTPError(400, "the Inbox plugin is off: clip without inbox, or turn it on")
  const folder = inboxFolder ? inboxFolder : b.folder !== undefined && str(b.folder).trim() ? vaultPath(b.folder, false, plugin.vault) : s.folder ? vaultPath(s.folder, false, plugin.vault) : ""
  const tags = Array.isArray(b.tags) ? b.tags.map((t: unknown) => str(t).trim()).filter(Boolean) : typeof b.tags === "string" ? b.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : s.tags

  const known = () => [...plugin.vault.entries.values()].find((e) => typeof e.fm.source === "string" && sameUrl(e.fm.source) === sameUrl(url))
  const before = known()
  if (before && b.update !== true) return { path: before.rel, title: str(before.fm.title) || path.basename(before.rel, ".md"), url, existing: true }

  let html: string
  if (typeof b.html === "string" && b.html.trim()) {
    html = b.html
  } else {
    const ok = publicUrl(url)
    if (typeof ok === "string") throw new HTTPError(400, `the server doesn't fetch ${url} (${ok}): send its html instead`)
    let page
    try {
      page = await fetchPublic(ok, { max: Infinity, timeout: TIMEOUT, types: /html|xml/ })
    } catch (e) {
      throw new HTTPError(502, `couldn't fetch ${url}: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (page.status < 200 || page.status >= 300) throw new HTTPError(502, `${url} answered ${page.status}`)
    if (!page.body.length) throw new HTTPError(415, `${url} isn't a web page (${page.type || "no type"})`)
    html = pageText(page.type, page.body)
    url = page.url
  }
  let c: Clipped
  try {
    c = await readPage(html, url, typeof b.html !== "string")
  } catch (e) {
    throw new HTTPError(422, `couldn't read the page: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!c.markdown) throw new HTTPError(422, `found no text to clip on ${url}`)
  const title = c.title || new URL(url).hostname

  const r: Clip = await plugin.vault.lock(async () => {
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
    writeAtomic(plugin.vault.abs(rel), noteText(c, url, tags, title, nowStamp(), inboxFolder ? str(b.from).trim().slice(0, 60) || "Web clipper" : null))
    await plugin.vault.sync()
    await plugin.vault.fillIn(rel, null)
    return { path: rel, title, url, words: c.words, existing: false }
  })

  const post = xPost(url)
  if (!post || !(typeof b.video === "boolean" ? b.video : s.videos) || r.existing && !r.updated) return r
  if (!plugin.host.catalog().some((e) => e.id === "video.save")) return r
  const note = plugin.vault.entries.get(r.path)
  if (note && startsWithMedia(note.body) || !(c.video ?? await videoByApi(post))) return r
  const source = sameUrl(url)
  awaiting(source, r.path)
  try {
    await saveVideo(source)
    return { ...r, video: true }
  } catch (e) {
    awaiting(source, null)
    return { ...r, videoError: e instanceof Error ? e.message : String(e) }
  }
}

const WAIT = 24 * 3_600_000
type Waiting = Record<string, { path: string; t: number }>
function awaiting(source: string, rel: string | null) {
  const now = Date.now(), all = Object.fromEntries(Object.entries(plugin.kept<Waiting>("videos", {})).filter(([k, w]) => k !== source && now - w.t < WAIT))
  plugin.keep("videos", rel ? { ...all, [source]: { path: rel, t: now } } : all)
}

plugin.around("inbox.add", async (call, next) => {
  const source = sameUrl(str(call.params.source).trim())
  const w = source ? plugin.kept<Waiting>("videos", {})[source] : undefined
  if (!w || Date.now() - w.t >= WAIT) return next()
  const ofSource = (e: { fm: Item }) => typeof e.fm.source === "string" && sameUrl(e.fm.source) === source
  const at = plugin.vault.entries.get(w.path)
  const e = at && ofSource(at) ? at : [...plugin.vault.entries.values()].find(ofSource)
  awaiting(source, null)
  if (!e) return next()
  const abs = plugin.vault.abs(e.rel), text = readText(abs), merged = withVideo(text, str(call.params.body))
  if (merged === text) return next()
  writeAtomic(abs, merged)
  await plugin.vault.sync()
  return { path: e.rel, title: str(e.fm.title) || path.basename(e.rel, ".md") }
})

plugin.route("POST", "clip", async (req) => {
  if (plugin.isOff()) throw new HTTPError(404, "the Web clipper plugin is off (Plugins)")
  const r = await clip(req.body ?? {}, (url) => plugin.runOp("video.save", { url }, undefined, req.http))
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
(its content as the page is now, the note's own keys kept). An X post with a video gets its video too, saved into its
note by video.save (the Videos plugin, while it's on) a few minutes later: video false leaves it out, and so does the
Web clipper's Save videos setting turned off.

  vau clip https://example.com/posts/an-article
  vau clip https://example.com/a --folder Notes/Reading --tags "Clipping, Reading"
  vau clip https://example.com/private --html - < ~/Downloads/page.html
  vau clip https://example.com/long-read --inbox
  vau clip https://example.com/a --update`,
  kind: "write",
  lock: false,
  params: {
    url: { type: "string", required: true, description: "the page's address (http or https)" },
    html: { type: "string", description: "the page's HTML, when you have it (else the server fetches the url)" },
    folder: { type: "string", description: "where the note goes (default Clippings, the plugin's setting)" },
    tags: { type: "array", items: { type: "string" }, description: "its tags (default Clipping)" },
    inbox: { type: "boolean", description: "put it in the user's inbox to review (Inbox/) instead of a folder" },
    update: { type: "boolean", description: "clipped before: replace its note's content with the page as it is now" },
    video: { type: "boolean", description: "an X post's video saved into its note too (default: the Save videos setting, on)" },
  },
  args: ["url"],
  run: async (p, ctx) => {
    if (p.html !== undefined && !/<[a-z!]/i.test(p.html)) throw new OpError("`html` is the page's HTML itself, not a file's name (from a terminal: --html - < page.html)")
    try {
      return await clip({ ...p, ...(p.inbox ? { from: ctx.who.label } : {}) }, (url) => ctx.op("video.save", { url }))
    } catch (e) {
      if (e instanceof HTTPError) throw new OpError(e.message, e.status)
      throw e
    }
  },
  text: (r: Clip) => (r.updated ? `Updated ${r.path} ("${r.title}") with the page as it is now (${r.words ?? "?"} words).`
    : r.existing ? `Already clipped: ${r.path} ("${r.title}"). To replace its content with the page as it is now: update.`
    : `Clipped "${r.title}" to ${r.path} (${r.words ?? "?"} words).`) +
    (r.video ? " Its video is being saved into it: it lands in a few minutes." : r.videoError ? ` Its video couldn't be saved: ${r.videoError}` : ""),
  did: (p) => ({ action: "create", text: `Clipped ${p.url.trim().slice(0, 120) || "a web page"}${p.inbox ? " into the inbox" : ""}` }),
})
