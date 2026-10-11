// Podcasts: shows you follow (their feeds, .vaultite/plugins/podcasts/feeds.json), checked every hour; each new episode
// is downloaded into the vault with its artwork and transcript (when the feed has one) and lands in the inbox to listen to.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { bullets, OpError, Plugin } from "../../../core/plugins.ts"
import { clock, paragraphs, parseFeed, srtToVtt, type Episode, type Show } from "./feed.ts"

export const plugin = new Plugin(import.meta.url)

type Feed = { url: string; title: string; image?: string | null; added: string }
const feeds = () => ((plugin.settings({}, "feeds").feeds ?? []) as Feed[])
const saveFeeds = (list: Feed[]) => plugin.saveSettings(list.length ? { feeds: list } : null, "feeds")
// Episodes already seen in each feed (downloaded, or there before it was followed), by guid.
const seen = () => (plugin.settings({}, "seen").feeds ?? {}) as Record<string, string[]>
function markSeen(url: string, guids: string[]) {
  const all = { ...seen() }
  all[url] = [...new Set([...guids, ...(all[url] ?? [])])].slice(0, 500)
  plugin.saveSettings({ feeds: all }, "seen")
}
const firstEpisodes = () => Math.max(0, Math.min(10, Number(plugin.settings().new_episodes ?? 1)))

const UA = { "User-Agent": "Vaultite (podcasts)" }
async function fetchShow(url: string): Promise<Show> {
  const r = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(30_000) })
  if (!r.ok) throw new OpError(`the feed answered ${r.status}`, 502)
  const show = parseFeed(await r.text())
  if (!show.episodes.length) throw new OpError("that address isn't a podcast's feed (no episodes with audio)", 400)
  return show
}

type Found = { title: string; author: string; feed: string; image: string | null }
async function search(term: string): Promise<Found[]> {
  const r = await fetch(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=12&term=${encodeURIComponent(term)}`, { headers: UA, signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new OpError(`the podcast directory answered ${r.status}`, 502)
  const j = await r.json() as { results?: { collectionName?: string; artistName?: string; feedUrl?: string; artworkUrl600?: string; artworkUrl100?: string }[] }
  return (j.results ?? []).filter((x) => x.feedUrl).map((x) => ({ title: x.collectionName ?? "", author: x.artistName ?? "", feed: x.feedUrl!, image: x.artworkUrl600 ?? x.artworkUrl100 ?? null }))
}

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s)
function fileName(s: string) {
  const t = s.replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim()
  return t.length > 90 ? t.slice(0, 90).replace(/\s+\S*$/, "").trim() : t
}
const extOf = (url: string, type: string) => /\.(mp3|m4a|aac|mp4|ogg|opus|wav)(\?|$)/i.exec(new URL(url).pathname)?.[1]?.toLowerCase()
  ?? ({ "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/x-m4a": "m4a", "audio/mp4": "m4a", "audio/aac": "aac", "video/mp4": "mp4", "audio/ogg": "ogg" } as Record<string, string>)[type.toLowerCase()] ?? "mp3"

async function upload(name: string, body: Readable | Buffer) {
  const input = Buffer.isBuffer(body) ? Readable.from(body) : body
  const r = await plugin.host.call("file.upload", { name }, undefined, { input })
  return String((r.result as { path?: unknown })?.path ?? "")
}

/** One episode into the vault: its audio, its picture and captions beside it (same name), and a note in the inbox. */
async function save(show: Show, feed: Feed, ep: Episode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-podcast-"))
  try {
    const ext = extOf(ep.audio, ep.type)
    const tmp = path.join(dir, `episode.${ext}`)
    const r = await fetch(ep.audio, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(30 * 60_000) })
    if (!r.ok || !r.body) throw new Error(`the episode answered ${r.status}`)
    await pipeline(Readable.fromWeb(r.body as never), fs.createWriteStream(tmp))
    const title = fileName(`${show.title} - ${ep.title}`)
    const saved = await upload(`${title}.${ext}`, fs.createReadStream(tmp))
    const name = path.posix.basename(saved), stem = name.replace(/\.[^.]+$/, "")
    const pic = ep.image || show.image
    if (pic) {
      const p = await fetch(pic, { headers: UA, signal: AbortSignal.timeout(30_000) }).catch(() => null)
      if (p?.ok) {
        const type = p.headers.get("content-type") ?? ""
        await upload(`${stem}.${/png/.test(type) ? "png" : /webp/.test(type) ? "webp" : "jpg"}`, Buffer.from(await p.arrayBuffer())).catch(() => "")
      }
    }
    let transcript = ""
    if (ep.transcript) {
      const t = await fetch(ep.transcript.url, { headers: UA, signal: AbortSignal.timeout(60_000) }).catch(() => null)
      if (t?.ok) {
        const raw = await t.text()
        const vtt = /^\s*WEBVTT/.test(raw) ? raw : /-->/.test(raw) ? srtToVtt(raw) : ""
        if (vtt) {
          await upload(`${stem}.vtt`, Buffer.from(vtt)).catch(() => "")
          transcript = paragraphs(vtt)
        }
      }
    }
    const meta = [show.title, ep.date, ep.duration ? `${Math.round(ep.duration / 60)} minutes` : ""].filter(Boolean).join(", ")
    const body = [`![[${name}]]`, `${meta}.`, ep.notes, transcript && `## Transcript\n\n${transcript}`].filter(Boolean).join("\n\n")
    await plugin.runOp("inbox.add", { title: fileName(ep.title), body, source: ep.link || ep.audio, from: feed.title,
      tldr: `A new episode of ${show.title}${ep.duration ? `, ${clock(ep.duration)}` : ""}, to listen to here.` })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// One check at a time, episodes one by one (a show's backlog never floods the inbox: three new at most each time).
let running: Promise<unknown> = Promise.resolve()
const PER_CHECK = 3
function check(only?: string[]) {
  const next = running.then(async () => {
    const out: string[] = []
    for (const f of feeds().filter((x) => !only || only.includes(x.url))) {
      try {
        const show = await fetchShow(f.url)
        const known = new Set(seen()[f.url] ?? [])
        const fresh = show.episodes.filter((e) => !known.has(e.guid)).slice(0, PER_CHECK)
        for (const ep of fresh) {
          await save(show, f, ep)
          markSeen(f.url, [ep.guid])
          out.push(`${f.title}: ${ep.title}`)
        }
      } catch (e) {
        console.error(`podcasts: ${f.title}: ${(e as Error).message ?? e}`)
      }
    }
    return out
  })
  running = next.catch(() => [])
  return next
}

plugin.every("check", { every: "1h" }, () => check())

plugin.op({
  id: "podcast.follow",
  cli: "podcast follow",
  mcp: true,
  summary: "Follow a podcast by its name or its feed's address: its latest episode lands in the inbox, and every new one after.",
  help: `A name is looked up in Apple's podcast directory (the best match); an address is the show's RSS feed. Each
episode is downloaded into the vault (with its artwork, and its transcript when the feed has one) and filed in the
inbox to listen to; the Player's queue lists it.

  vau podcast follow "Hard Fork"
  vau podcast follow https://feeds.example.com/show.xml`,
  kind: "write",
  lock: false,
  params: { show: { type: "string", required: true, description: "the show's name, or its feed's address" } },
  args: ["show"],
  run: async ({ show }) => {
    const asked = String(show).trim()
    let url = asked
    if (!isUrl(asked)) {
      const hit = (await search(asked))[0]
      if (!hit) throw new OpError(`no podcast called '${asked}' in the directory: give its feed's address`, 404)
      url = hit.feed
    }
    const s = await fetchShow(url)
    if (feeds().some((f) => f.url === url)) return { title: s.title, url, already: true }
    saveFeeds([...feeds(), { url, title: s.title, image: s.image, added: new Date().toISOString().slice(0, 10) }])
    // The latest few come now; the rest are seen, so only new ones come after.
    const n = firstEpisodes()
    markSeen(url, s.episodes.slice(n).map((e) => e.guid))
    void check([url])
    return { title: s.title, url, episodes: Math.min(n, s.episodes.length) }
  },
  text: (r) => r.already ? `Already following ${r.title}.` : `Following ${r.title}${r.episodes ? `: its latest episode${r.episodes === 1 ? "" : "s"} land${r.episodes === 1 ? "s" : ""} in the inbox shortly` : ""}.`,
})

plugin.op({
  id: "podcast.unfollow",
  cli: "podcast unfollow",
  summary: "Stop following a podcast (by its title or feed): episodes already saved stay.",
  kind: "write",
  params: { show: { type: "string", required: true, description: "its title, as podcast.list shows it, or its feed's address" } },
  args: ["show"],
  run: ({ show }) => {
    const q = String(show).trim().toLowerCase()
    const f = feeds().find((x) => x.url.toLowerCase() === q || x.title.toLowerCase() === q)
    if (!f) throw new OpError(`not following '${show}'`, 404)
    saveFeeds(feeds().filter((x) => x !== f))
    return { title: f.title }
  },
  text: (r) => `Stopped following ${r.title}.`,
})

plugin.op({
  id: "podcast.list",
  cli: "podcast list",
  summary: "The podcasts the user follows.",
  kind: "read",
  run: () => ({ shows: feeds() }),
  text: (r) => bullets((r.shows as Feed[]).map((f) => `${f.title} (${f.url}), since ${f.added}`), "Not following any podcast."),
})

plugin.op({
  id: "podcast.search",
  cli: "podcast search",
  summary: "Look a podcast up by name in Apple's podcast directory: titles, authors and feeds.",
  kind: "read",
  params: { term: { type: "string", required: true, description: "words of its name" } },
  args: ["term"],
  run: async ({ term }) => ({ results: await search(String(term)) }),
  text: (r) => bullets((r.results as Found[]).map((x) => `${x.title}${x.author ? ` by ${x.author}` : ""}: ${x.feed}`), "None found."),
})

plugin.op({
  id: "podcast.check",
  cli: "podcast check",
  summary: "Look for new episodes now (it does every hour), saving them into the inbox.",
  kind: "write",
  lock: false,
  run: async () => ({ saved: await check() }),
  text: (r) => bullets(r.saved as string[], "No new episodes."),
})
