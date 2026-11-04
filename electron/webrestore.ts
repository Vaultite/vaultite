// How a tab's page comes back (⌘⇧T, a relaunch, a page let go), kept on this Mac: its history (web-tab-history.json)
// and its last picture (web-frames/). Loaded with the first page, not at launch (web.ts `restore`).
import { app, type NavigationEntry, type NativeImage } from "electron"
import fs from "node:fs"
import path from "node:path"
import { mayOpen, mayPicture } from "./browser/engine.ts"
import { writeAtomic } from "./setup.ts"

// ---------- each tab's page history ----------

type Past = { profile: string; index: number; entries: { url: string; title: string; pageState?: string }[]; at: number }
const pastFile = () => path.join(app.getPath("userData"), "web-tab-history.json")
let pasts: Map<string, Past> | null = null
const pastsOf = () => {
  if (pasts) return pasts
  try { pasts = new Map(Object.entries(JSON.parse(fs.readFileSync(pastFile(), "utf8")) as Record<string, Past>)) } catch { pasts = new Map() }
  return pasts
}
let pastTimer: NodeJS.Timeout | null = null
export function savePasts() {
  if (pastTimer) { clearTimeout(pastTimer); pastTimer = null }
  const old = Date.now() - 30 * 86400_000
  const list = [...pastsOf()].filter(([, v]) => v.at > old).sort((a, b) => b[1].at - a[1].at).slice(0, 500)
  pasts = new Map(list)
  try { writeAtomic(pastFile(), JSON.stringify(Object.fromEntries(list))) } catch (e) { console.error("vaultite: tabs' page history wasn't kept:", e) }
}
/** Tab `tab`'s page's history as it is now (`all`, at `at`), kept: its own addresses only (`shows`: no spare's
 *  about:blank), 50 around where it is. `settle`: written even if only a page's state moved (its scroll), as it ends. */
export function keepPast(tab: string, profile: string, all: NavigationEntry[], at: number, shows: (u: string) => boolean, settle = false) {
  if (!shows(all[at]?.url ?? "")) return
  // (a page's state, its scroll and form, only while small: the file is rewritten as pages move on)
  const mine = all.map((e, i) => ({ url: e.url, title: e.title, ...(e.pageState && e.pageState.length < 8000 ? { pageState: e.pageState } : {}), i })).filter((e) => shows(e.url))
  const i = mine.findIndex((e) => e.i === at), from = Math.max(0, i - 40), was = pastsOf().get(tab)
  const next = { profile, index: i - from, entries: mine.slice(from, i + 10).map(({ i: _, ...e }) => e), at: Date.now() }
  pastsOf().set(tab, next)
  // (a title changing alone, as some sites' do every second, waits for the next move to be written)
  const moved = (f: (e: Past["entries"][number]) => string | undefined) => was!.entries.map(f).join() !== next.entries.map(f).join()
  if (!was || was.index !== next.index || moved((e) => e.url) || (settle && moved((e) => e.pageState))) pastTimer ??= setTimeout(savePasts, 2000)
}
/** Tab `to` is a copy of `from` (Duplicate): its page starts from the same history. */
export function copyPast(from: string, to: string) {
  const k = pastsOf().get(from)
  if (k) { pastsOf().set(to, { ...k, at: Date.now() }); pastTimer ??= setTimeout(savePasts, 2000) }
}
/** How tab `tab`'s page starts in `profile` at `url`, from its kept history: as it was (its page come back), or, in other
 *  logins or at another address (moved to another container), its places up to there and `url` after them (`load`). */
export function pastOf(tab: string, profile: string, url: string) {
  const k = pastsOf().get(tab)
  if (!k) return null
  if (k.profile === profile && k.entries[k.index]?.url === url) return k.entries.length > 1 ? { entries: k.entries, index: k.index, load: false } : null
  // (without what sites keep in them: another session's)
  const back = k.entries.slice(0, k.index + 1).map(({ url, title }) => ({ url, title }))
  if (back.at(-1)?.url === url) back.pop()
  // (`url` restored last, the one load: an earlier place loaded there and cut short (an extension's page, in a new
  // container) left the extension's next navigation dropped on Linux)
  return back.length ? { entries: [...back, { url, title: "" }], index: back.length, load: true } : null
}
/** The titles tabs' pages had, by address: a tab not loaded yet is named as it was. */
export const pastTitles = () => Object.fromEntries([...pastsOf().values()].flatMap((k) => { const e = k.entries[k.index]; return e?.title ? [[e.url, e.title]] : [] }))

// ---------- each tab's page as last seen: drawn in its place while the page comes back ----------

/** A tab's picture (`<tab>.jpg`): the page it shows, in which logins, its size in the window's CSS px. */
export type Frame = { url: string; profile: string; width: number; height: number; at: number }
const FRAMES = 40
const dir = () => path.join(app.getPath("userData"), "web-frames")
const fileOf = (tab: string) => path.join(dir(), `${tab}.jpg`)
let frames: Map<string, Frame> | null = null
const framesOf = () => {
  if (frames) return frames
  try { frames = new Map(Object.entries(JSON.parse(fs.readFileSync(path.join(dir(), "frames.json"), "utf8")) as Record<string, Frame>)) } catch { frames = new Map() }
  return frames
}
/** The newest FRAMES of the last 30 days kept (none a locking container's), the rest's pictures deleted. */
function save() {
  const old = Date.now() - 30 * 86400_000, all = [...framesOf()].sort((a, b) => b[1].at - a[1].at)
  const keep = all.filter(([, f]) => f.at > old && mayPicture(f.profile)).slice(0, FRAMES), kept = new Set(keep.map(([tab]) => tab))
  for (const [tab] of all) if (!kept.has(tab)) fs.rm(fileOf(tab), { force: true }, () => {})
  frames = new Map(keep)
  try { writeAtomic(path.join(dir(), "frames.json"), JSON.stringify(Object.fromEntries(keep))) } catch { /* only the pictures are lost */ }
}

/** Tab `tab`'s picture of `url` in `profile`, if there's one (never a locked container's). */
export function frameFor(tab: string, url: string, profile: string) {
  const f = tab ? framesOf().get(tab) : undefined
  return f && f.url === url && f.profile === profile && mayOpen(profile) && mayPicture(profile) ? f : null
}
/** Its bytes (JPEG) and size, to draw. */
export function readFrame(tab: string, f: Frame) {
  try { return { data: fs.readFileSync(fileOf(tab)), width: f.width, height: f.height } } catch { return null }
}
/** Keep `img` as tab `tab`'s picture. */
export async function keepFrame(tab: string, img: NativeImage, f: Omit<Frame, "at">) {
  if (img.isEmpty()) return
  const small = img.getSize().width > 1600 ? img.resize({ width: 1600, quality: "good" }) : img
  await fs.promises.mkdir(dir(), { recursive: true })
  await fs.promises.writeFile(fileOf(tab), small.toJPEG(80))
  framesOf().set(tab, { ...f, at: Date.now() })
  save()
}
