// Detail sheets live in the hash after the tab, so they deep-link and Back closes them. Sheets stack: one opened from
// another pushes an entry (history.state = { sheet: depth, prev }); Close pops the whole stack.
/** Scroll the page: on desktop the main area scrolls by itself (#main-scroll, below the tab bar), on phones the window. */
export function scrollPage(top: number, smooth = false) {
  const el = document.getElementById("main-scroll")
  const target = el && getComputedStyle(el).overflowY === "auto" ? el : window
  target.scrollTo({ top, behavior: smooth ? "smooth" : "auto" })
}

export type Route = { tab: string; detail: string; depth: number; prev: string }

export function route(): Route {
  let [tab, ...rest] = location.hash.slice(1).split("/")
  // A file is a tab of its own: #file/Notes%2FIdea.md (then any sheet on top of it).
  if ((tab === "file" || tab === "view") && rest.length) tab = `${tab}/${rest.shift()}`
  const s = history.state as { sheet?: number; prev?: string } | null
  return { tab, detail: rest.join("/"), depth: s?.sheet ?? 0, prev: s?.prev ?? "" }
}

// Some details are files (a person is People/<name>.md): the app opens those as files instead (a tab on desktop, the
// file view in a tab, on phones too). Set by App, which knows the plugins.
let redirect: ((path: string) => string | null) | null = null
export const setDetailRedirect = (fn: (path: string) => string | null) => { redirect = fn }
let fileOpener: ((path: string) => void) | null = null
/** core/files.ts registers how to open a file (nav can't import it: files imports nav). */
export const setFileOpener = (fn: (path: string) => void) => { fileOpener = fn }

// The sheet locks the page (body position: fixed) and restores its scroll itself; the browser restoring scroll on
// back/forward would fight that, and tab changes scroll to the top anyway.
if ("scrollRestoration" in history) history.scrollRestoration = "manual"

const notify = () => dispatchEvent(new HashChangeEvent("hashchange"))

export function openDetail(path: string) {
  const file = redirect?.(path)
  if (file && fileOpener) return fileOpener(file)
  const { tab, detail, depth } = route()
  if (detail === path) return
  history.pushState({ sheet: depth + 1, prev: detail }, "", `#${tab}/${path}`)
  notify()
}

/** One sheet back (the Back button in a stacked sheet). */
export function backDetail() {
  if (route().depth) history.back()
  else closeDetail()
}

// Close: go back past every sheet we pushed. If the page was opened on a sheet's URL (a deep link, so the bottom
// entry is itself a sheet), that entry is then swapped for the bare tab so the sheet really closes.
let closing = false
addEventListener("popstate", () => {
  if (!closing) return
  closing = false
  if (route().detail) { history.replaceState(null, "", `#${route().tab}`); notify() }
})

export function closeDetail() {
  const { depth, tab } = route()
  if (depth) { closing = true; history.go(-depth); setTimeout(() => { closing = false }, 1500) }
  else { history.replaceState(null, "", `#${tab}`); notify() }
}

/** Run `fn` once the open sheets have closed (their history entries popped), so what it shows isn't under a sheet. */
export function afterSheets(fn: () => void) {
  if (!route().detail) return fn()
  if (route().depth) addEventListener("popstate", () => setTimeout(fn), { once: true })
  closeDetail()
  if (!route().depth) fn()
}

/** A file or folder was renamed or moved: a sheet showing it or a file in it (a phone's file sheet) follows, like its
 *  tabs do. */
export function retargetDetail(from: string, to: string) {
  const p = sheetFile()
  if (from === to || p === null) return
  if (p === from || p.startsWith(`${from}/`)) replaceDetail(`file/${encodeURIComponent(to + p.slice(from.length))}`)
}
/** A file or folder was archived or deleted: a sheet showing it or a file in it closes, like its tabs do. */
export function closeDetailOf(path: string) {
  const p = sheetFile()
  if (p !== null && (p === path || p.startsWith(`${path}/`))) backDetail()
}
function sheetFile() {
  const d = route().detail
  if (!d?.startsWith("file/")) return null
  try { return decodeURIComponent(d.slice(5)) } catch { return null }
}

/** Swap the open detail without adding a history entry (picking another note in the desktop reader pane). */
export function replaceDetail(path: string) {
  history.replaceState(history.state, "", `#${route().tab}/${path}`)
  notify()
}

// ---------- whether Back has somewhere to go (the phone's Back button) ----------
// The browser won't say (and Back from Safari's first entry leaves the app), so entries are numbered in sessionStorage.
type Numbered = { n?: number } | null
const SEQ = "vaultite.history.n", FLOOR = "vaultite.history.floor", TOP = "vaultite.history.top"
function session(key: string, v?: number) {
  try {
    if (v === undefined) return Number(sessionStorage.getItem(key)) || 0
    sessionStorage.setItem(key, String(v))
  } catch { /* private mode */ }
  return v ?? 0
}
let seq = session(SEQ)
let top = session(TOP)
const nextN = () => { top = session(TOP, ++seq); return seq }
const numberOf = () => (history.state as Numbered)?.n ?? 0
const rawReplace = history.replaceState.bind(history), rawPush = history.pushState.bind(history)
const withN = (s: unknown, n: number) => ({ ...(s && typeof s === "object" ? s : {}), n })
history.replaceState = (s: unknown, unused: string, url?: string | URL | null) => {
  const n = (s as Numbered)?.n ?? numberOf()
  rawReplace(n ? withN(s, n) : s, unused, url)
}
history.pushState = (s: unknown, unused: string, url?: string | URL | null) => rawPush(withN(s, nextN()), unused, url)
/** Number the entry on screen, if it has no number yet (the first one, or one a link made). */
const numberHere = () => { if (!numberOf()) rawReplace(withN(history.state, nextN()), "") }
numberHere()
// A new session (the installed app opened again, a new browser tab) has nothing before this entry: it's the floor.
let floor = session(FLOOR)
if (!floor || floor > numberOf() || history.length === 1) { floor = session(FLOOR, numberOf()); top = session(TOP, numberOf()) }
addEventListener("hashchange", numberHere)
addEventListener("popstate", numberHere)
/** Whether Back stays in the app. */
export const canGoBack = () => numberOf() > floor
/** Whether there's an entry after this one (Back was used, and nothing new opened since). */
export const canGoForward = () => numberOf() < top

// ---------- where each place was scrolled to (phones: Back returns there) ----------
// Read as the entry comes back, before the browser clamps the scroll to the shorter page being swapped out.
const scrolls = new Map<number, number>()
let back: { n: number; y: number } | null = null
addEventListener("scroll", () => { if (numberOf()) scrolls.set(numberOf(), scrollY) }, { passive: true })
addEventListener("popstate", () => { const y = scrolls.get(numberOf()); back = y ? { n: numberOf(), y } : null })
/** Where the entry on screen was scrolled to when it was left, if Back or Forward just returned to it (once). */
export function takeScroll() {
  const b = back
  back = null
  return b && b.n === numberOf() ? b.y : null
}
