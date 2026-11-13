export type MediaKind = "image" | "video" | "audio" | "pdf" | "other"
export type KeepRule = { path: string; kind?: MediaKind; since?: string; latest?: number }
export type DeviceRules = { keep?: KeepRule[]; keepAll?: boolean; cap?: number; bigOnWifi?: number }
export type Media = { path: string; size: number; at: number }
export type Want = { path: string; size: number; why: "kept" | "all" | "pinned" | "recent" | "daily" | "audio" }

export const CAP = 2 << 30, BIG = 50 << 20, RECENT_DAYS = 30
const EXT: Record<string, MediaKind> = {}
for (const e of "png jpg jpeg gif webp heic heif avif svg bmp tif tiff".split(" ")) EXT[e] = "image"
for (const e of "mp4 mov m4v webm mkv avi".split(" ")) EXT[e] = "video"
for (const e of "m4a mp3 wav aac flac ogg opus caf".split(" ")) EXT[e] = "audio"
EXT.pdf = "pdf"
export const mediaKind = (path: string): MediaKind => EXT[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "other"

export function span(s: string | undefined) {
  const m = /^(\d+)\s*([hdwm])$/.exec(String(s ?? "").trim())
  return m ? Number(m[1]) * { h: 3600_000, d: 86400_000, w: 7 * 86400_000, m: 30 * 86400_000 }[m[2] as "h"]! : 0
}

export function embeds(text: string, from: string, byName: Map<string, string[]>, exists: (p: string) => boolean): string[] {
  const out = new Set<string>(), dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : ""
  const find = (raw: string) => {
    const t = decodeURIComponent(raw.split("|")[0].split("#")[0].trim()).replace(/^\.\//, "")
    if (!t || /^[a-z]+:/i.test(t)) return
    for (const p of [t, dir ? `${dir}/${t}` : t]) if (exists(p)) return void out.add(p)
    const hits = byName.get(t.slice(t.lastIndexOf("/") + 1).toLowerCase())
    if (hits?.length) out.add(hits[0])
  }
  for (const m of text.matchAll(/!\[\[([^\]]+)\]\]/g)) find(m[1])
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) find(m[1])
  return [...out]
}

export function wanted(o: { media: Media[]; notes: { path: string; at: number; text: string }[]; pinned: string[]; rules: DeviceRules; now: number; today: string }): Want[] {
  const { media, notes, pinned, rules, now } = o
  const byPath = new Map(media.map((m) => [m.path, m])), byName = new Map<string, string[]>()
  for (const m of media) { const n = m.path.slice(m.path.lastIndexOf("/") + 1).toLowerCase(); byName.set(n, [...(byName.get(n) ?? []), m.path]) }
  const out = new Map<string, Want>()
  const add = (p: string, why: Want["why"]) => { const m = byPath.get(p); if (m && !out.has(p)) out.set(p, { path: p, size: m.size, why }) }
  const noteText = new Map(notes.map((n) => [n.path, n.text]))
  const inNote = (p: string) => embeds(noteText.get(p) ?? "", p, byName, (x) => byPath.has(x))
  if (rules.keepAll) for (const m of media) add(m.path, "all")
  for (const r of rules.keep ?? []) {
    const p = r.path.replace(/^\/+|\/+$/g, ""), since = span(r.since)
    if (byPath.has(p)) { add(p, "kept"); continue }
    if (noteText.has(p) || noteText.has(`${p}.md`)) { for (const x of inNote(noteText.has(p) ? p : `${p}.md`)) add(x, "kept"); continue }
    let hits = media.filter((m) => (!p || m.path.startsWith(`${p}/`)) && (!r.kind || mediaKind(m.path) === r.kind) && (!since || m.at >= now - since))
    if (r.latest) hits = hits.sort((a, b) => b.at - a.at).slice(0, r.latest)
    for (const m of hits) add(m.path, "kept")
  }
  for (const p of pinned) {
    if (byPath.has(p)) add(p, "pinned")
    else if (noteText.has(p)) for (const x of inNote(p)) add(x, "pinned")
    else for (const m of media) if (m.path.startsWith(`${p}/`) && mediaKind(m.path) === "image") add(m.path, "pinned")
  }
  const smallEnough = (p: string) => { const k = mediaKind(p); return k === "image" || (k === "pdf" && (byPath.get(p)?.size ?? 0) < 10 << 20) }
  for (const n of notes) if (n.path.slice(n.path.lastIndexOf("/") + 1).startsWith(o.today)) for (const x of inNote(n.path)) if (smallEnough(x)) add(x, "daily")
  for (const n of [...notes].sort((a, b) => b.at - a.at)) {
    if (n.at < now - RECENT_DAYS * 86400_000) break
    for (const x of inNote(n.path)) if (smallEnough(x)) add(x, "recent")
  }
  for (const m of media) if (mediaKind(m.path) === "audio") add(m.path, "audio")
  return [...out.values()]
}

export function fit(want: Want[], cap: number) {
  const kept = want.filter((w) => w.why === "kept" || w.why === "all"), rest = want.filter((w) => w.why !== "kept" && w.why !== "all")
  let used = kept.reduce((n, w) => n + w.size, 0)
  const over = used > cap
  const take = [...kept]
  for (const w of rest) if (used + w.size <= cap) { take.push(w); used += w.size }
  return { take, used, over }
}
