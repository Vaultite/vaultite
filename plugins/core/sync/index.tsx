import { useEffect, useState } from "react"
import { CloudDownload, HardDriveDownload, Smartphone } from "lucide-react"
import { Button, definePlugin, Empty, fileRowsChanged, get, notify, notifyError, op, openView, PageHeader, phoneLocal, phoneSyncModule, post,
  Row, Section, Stat, Switch, type FileMark, type PhoneSync } from "@vaultite"
import { CAP, BIG, fit, mediaKind, wanted, type DeviceRules, type Media, type MediaKind } from "./phone.ts"

const DEVICE = "iphone"
let M: Awaited<ReturnType<typeof phoneSyncModule>> | null = null
const phoneSync = () => M?.phoneSync() ?? null
const keepHere = (...a: Parameters<NonNullable<typeof M>["keepHere"]>) => M!.keepHere(...a)
const letGo = (...a: Parameters<NonNullable<typeof M>["letGo"]>) => M!.letGo(...a)
const previewPath = (p: string) => M!.previewPath(p)
const dec = new TextDecoder()
const json = (s: PhoneSync, p: string) => { try { const b = s.folder.read(p); return b ? JSON.parse(dec.decode(b)) : null } catch { return null } }
const rulesOf = (s: PhoneSync): DeviceRules => json(s, ".vaultite/plugins/sync/data.json")?.devices?.[DEVICE] ?? {}
const blobUrl = (set: string, hash: string) => `api/sync/blob?set=${encodeURIComponent(set)}&hash=${hash}`
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }

function heads(s: PhoneSync) {
  const media: (Media & { blob: string })[] = [], notes: { path: string; at: number; text: string }[] = []
  for (const [file] of s.replica.byFile) {
    const h = s.replica.head(file)
    if (!h?.blob) continue
    if (h.path.endsWith(".md")) { const b = s.folder.read(h.path); if (b) notes.push({ path: h.path, at: h.at, text: dec.decode(b) }) }
    else if (mediaKind(h.path) !== "other" && h.size >= 64 << 10) media.push({ path: h.path, size: h.size, at: h.at, blob: h.blob })
  }
  return { media, notes }
}
const here = (s: PhoneSync, m: { path: string; blob: string }) => s.folder.files.get(m.path)?.hash === m.blob

let applying = false
async function apply(s: PhoneSync) {
  if (applying || !phoneLocal) return
  applying = true
  try {
    const rules = rulesOf(s), { media, notes } = heads(s), cap = rules.cap ?? CAP
    const pinned: string[] = json(s, ".vaultite/pages.json")?.pinned ?? []
    const { take, over } = fit(wanted({ media, notes, pinned, rules, now: Date.now(), today: today() }), cap)
    if (over) notify("What you keep on this phone is more than its storage cap: raise the cap or keep less", { kind: "error" })
    const info = await phoneLocal.info(), byPath = new Map(media.map((m) => [m.path, m])), want = new Set(take.map((w) => w.path))
    let got = 0
    for (const w of take) {
      const m = byPath.get(w.path)!
      if (here(s, m) || s.downloading.has(m.path)) continue
      if (m.size > (rules.bigOnWifi ?? BIG) && !info.wifi) continue
      if (++got > 3) break
      await keepHere(s, m.path, blobUrl).catch(() => false)
    }
    let used = media.filter((m) => here(s, m)).reduce((n, m) => n + m.size, 0)
    for (const m of media.filter((x) => here(s, x) && !want.has(x.path)).sort((a, b) => a.at - b.at)) {
      if (used <= cap) break
      if (await letGo(s, m.path)) used -= m.size
    }
    await previews(s, media.filter((m) => mediaKind(m.path) === "image"))
  } finally { applying = false; fileRowsChanged() }
}

let previewIndex: Record<string, string> | null = null
async function previews(s: PhoneSync, images: (Media & { blob: string })[]) {
  if (!phoneLocal) return
  if (!previewIndex) {
    const got = await phoneLocal.read({ area: "sync", vault: s.vault, paths: ["previews/index.json"] }).catch(() => null)
    try { previewIndex = JSON.parse(atob(got?.files["previews/index.json"] ?? "") || "{}") } catch { previewIndex = {} }
  }
  const index = previewIndex!
  let n = 0
  for (const m of images) {
    if (index[m.path] === m.blob || here(s, m)) continue
    if (++n > 20) break
    try {
      const r = await fetch(`api/raw/${encodeURIComponent(m.path.split("/").pop()!)}?path=${encodeURIComponent(m.path)}&thumb=256`)
      if (!r.ok) continue
      const b = new Uint8Array(await r.arrayBuffer())
      let bin = ""
      for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000))
      await phoneLocal.write({ area: "sync", vault: s.vault, path: previewPath(m.path), data: btoa(bin) })
      index[m.path] = m.blob
    } catch {}
  }
  if (n) await phoneLocal.write({ area: "sync", vault: s.vault, path: "previews/index.json", data: btoa(unescape(encodeURIComponent(JSON.stringify(index)))) })
}

function useSync() {
  const [s, setS] = useState<PhoneSync | null>(phoneSync())
  const [, tick] = useState(0)
  useEffect(() => {
    const on = () => { tick((n) => n + 1); const now = phoneSync(); if (now) { setS(now); void apply(now) } }
    addEventListener("vaultite:phone-sync", on)
    return () => removeEventListener("vaultite:phone-sync", on)
  }, [])
  return s
}

function Background() {
  useEffect(() => { if (phoneLocal) void phoneSyncModule().then((m) => { M = m; return m.startPhoneSync(get, post) }).catch(() => {}) }, [])
  useSync()
  return null
}

const KINDS: [MediaKind, string][] = [["video", "Video"], ["audio", "Audio"], ["pdf", "PDF"], ["image", "Images"]]
const size = (n: number) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20 ? `${Math.round(n / (1 << 20))} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

function Downloads() {
  const s = useSync()
  const [free, setFree] = useState<number | null>(null)
  useEffect(() => { void phoneLocal?.info().then((i) => setFree(i.free), () => {}) }, [s?.last])
  if (!phoneLocal) return <Empty>Downloads are the iPhone app's: what of the vault's media it keeps for when the hub can't be reached.</Empty>
  if (!s) return <Empty>This phone doesn't keep a copy of this vault yet: device sync isn't on for it.</Empty>
  const rules = rulesOf(s), { media } = heads(s), on = media.filter((m) => here(s, m))
  const used = on.reduce((n, m) => n + m.size, 0)
  const keepAll = (all: boolean) => op("sync.keep", { all, device: DEVICE }).then(() => notify(all ? "Keeping all media on this phone" : "Keeping media by its rules again"), (e) => notifyError(e, "Couldn't change it"))
  return (
    <div className="mx-auto max-w-[640px] px-4 py-4">
      <PageHeader title="Downloads" subtitle={s.readOnly ? "A copy for testing: device sync is in shadow mode until the switch." : undefined} />
      <div className="mb-5 grid grid-cols-3 gap-4">
        <Stat label="On this phone" value={size(used)} />
        <Stat label="Cap" value={size(rules.cap ?? CAP)} />
        <Stat label="Free" value={free === null ? "…" : size(free)} />
      </div>
      <Row title="Keep all media offline" meta="Every file of the vault on this phone, the rules and the cap aside" right={<Switch on={!!rules.keepAll} onChange={keepAll} label="Keep all media offline" />} />
      {[...s.downloading].length > 0 && <Section title="Downloading">{[...s.downloading].map((p) => <Row key={p} title={p.split("/").pop()} meta={p} lead={<CloudDownload className="size-4" />} />)}</Section>}
      {KINDS.map(([k, name]) => {
        const items = on.filter((m) => mediaKind(m.path) === k).sort((a, b) => b.size - a.size)
        if (!items.length) return null
        return (
          <Section key={k} title={`${name} · ${size(items.reduce((n, m) => n + m.size, 0))}`}>
            {items.map((m) => <Row key={m.path} title={m.path.split("/").pop()} meta={`${size(m.size)} · ${m.path}`}
              right={<Button size="small" onClick={() => void letGo(s, m.path)}>Remove</Button>} />)}
          </Section>
        )
      })}
      {!on.length && <Empty>No media on this phone yet: notes are, in full.</Empty>}
    </div>
  )
}

function marks(): Record<string, FileMark> {
  const s = phoneSync()
  if (!s) return {}
  const out: Record<string, FileMark> = {}
  for (const m of heads(s).media) out[m.path] = s.downloading.has(m.path) ? { text: "Downloading", tip: "Coming to this phone" }
    : here(s, m) ? { text: "On phone", tip: "Kept on this phone: opens without the hub" } : { text: "Online", tip: "Online only: its preview is on this phone" }
  return out
}

const keepOnPhone = (path: string, off = false) => op("sync.keep", { path, device: DEVICE, ...(off ? { off: true } : {}) })
  .then(() => notify(off ? "This phone keeps it by its rules again" : "Kept on this phone: it comes down next time it syncs"), (e) => notifyError(e, "Couldn't keep it on this phone"))
const kept = (path: string) => { const s = phoneSync(); return !!s && (rulesOf(s).keep ?? []).some((r) => r.path === path) }

const background = <Background />

export default definePlugin({
  background: phoneLocal ? () => background : undefined,
  views: { "phone-downloads": { icon: HardDriveDownload, title: () => "Downloads", render: () => <Downloads /> } },
  commands: [{ id: "sync:downloads", name: "Show downloads on this phone", icon: HardDriveDownload, when: () => !!phoneLocal, run: () => openView("phone-downloads", { newTab: true }) }],
  fileMarks: () => marks(),
  fileMenu: (path) => (phoneSync() ? [kept(path)
    ? { label: "Don't keep on this phone", icon: Smartphone, section: "actions", run: () => void keepOnPhone(path, true) }
    : { label: "Keep on this phone", icon: Smartphone, section: "actions", run: () => void keepOnPhone(path) }] : []),
  folderMenu: (path) => (phoneSync() ? [kept(path)
    ? { label: "Don't keep on this phone", icon: Smartphone, section: "actions", run: () => void keepOnPhone(path, true) }
    : { label: "Keep on this phone", icon: Smartphone, section: "actions", run: () => void keepOnPhone(path) }] : []),
})
