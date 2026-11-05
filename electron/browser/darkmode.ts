// Dark pages: while the app's look is dark, pages follow it (a dark one, by its site or the vault's style for it, keeps
// its own look): Chromium's auto dark mode over the DevTools protocol, plus the theme's tint (darkcolors.ts) on light pages.
import { ipcMain, type Session } from "electron"
import { fileURLToPath } from "node:url"
import { AUTO_BG, tintFilter } from "./darkcolors.ts"
import { canvasChanged, canvasFrom, cdp, eachPage, eachSession, handle, type EnginePage, type EngineWindow } from "./engine.ts"

const PRELOAD = fileURLToPath(new URL("./darkmode-preload.cjs", import.meta.url))

type Look = "theme" | "dark"
/** What a window's app tells: whether pages go dark (its look is dark and the Browser's setting on), how, its colours, and
 *  the sites turned off for. */
type Choice = { on: boolean; look: Look; bg: string; fg: string; off: string[] }
const NONE: Choice = { on: false, look: "theme", bg: "#000000", fg: "#ffffff", off: [] }
const choices = new Map<number, Choice>()
let lastChoice = NONE
/** A window's; pages outside one (a sign-in popup) follow the last told. */
const choiceOf = (win?: EngineWindow | null) => (win && choices.get(win.id)) || lastChoice

/** A page as dark pages see it: where its main frame is (or is going), whether that site is dark itself (its main frame
 *  says), what the DevTools protocol was last told, and its frames of other sites' sessions (auto-attached). */
type State = { p: EnginePage; url: string; native: boolean; applied: string; frames: Set<string>; attached: boolean }
const states = new Map<number, State>() // by the page's id
const byContents = new Map<number, State>() // by its contents' id

const hostOf = (url: string) => {
  try {
    const u = new URL(url)
    return u.protocol === "https:" || u.protocol === "http:" ? u.hostname.toLowerCase().replace(/^www\./, "") : ""
  } catch { return "" }
}
const onSite = (list: string[], host: string) => list.some((s) => host === s || host.endsWith(`.${s}`))
/** Whether pages at `host` go dark: a web page, not turned off for. (A site's style is judged page by page, as the page
 *  looks with it: Docs' editor dark by its style, its sign-in and error pages light, darkened.) */
const darkens = (c: Choice, host: string) => c.on && !!host && !onSite(c.off, host)

// ---------- the sheet ----------

/** Canvases: auto dark never reaches what a script draws (Google Docs' text), so they're inverted onto auto dark's ramp,
 *  hues kept. */
const CANVAS = `canvas { filter: invert(${(1 - AUTO_BG).toFixed(4)}) hue-rotate(180deg) !important }`
/** A light page's sheet, in "theme": the tint over the page, the canvas (the root's background, which no filter reaches)
 *  in the theme's background, and the top layer (dialogs, popovers, full screen), drawn outside the root, tinted too. */
const themed = (c: Choice) => {
  const t = tintFilter(c.bg, c.fg)
  return `html { filter: ${t} !important; background-color: ${c.bg} !important }
:is(:modal, :popover-open, :fullscreen):not(video, img) { filter: ${t} !important }
${CANVAS}`
}
const sheets = new Map<string, string>()
const themedOf = (c: Choice) => {
  const k = `${c.bg} ${c.fg}`
  let s = sheets.get(k)
  if (!s) { if (sheets.size > 20) sheets.clear(); sheets.set(k, (s = themed(c))) }
  return s
}

/** What a frame of page `s` applies: null, nothing (dark pages are off for its site); else its sheet, a main frame's
 *  only while its page is light (which it finds out itself), another frame's while the page is. */
function frameChoice(s: State | undefined, url: string, main: boolean) {
  const c = choiceOf(s?.p.win)
  if (!darkens(c, hostOf(main ? url : s?.url ?? url))) return null
  if (c.look !== "theme") return { css: "" }
  return { css: main ? themedOf(c) : s?.native ? "" : CANVAS }
}

// ---------- the DevTools protocol: prefers-color-scheme and auto dark, the page's and its other sites' frames ----------

/** What page `s` should be told: "" nothing, "media" prefers dark (a site dark itself), "auto" that and auto dark. */
const wanted = (s: State) => (!darkens(choiceOf(s.p.win), hostOf(s.url)) ? "" : s.native ? "media" : "auto")
const commands = (want: string): [string, Record<string, unknown>][] => [
  ["Emulation.setEmulatedMedia", { features: want ? [{ name: "prefers-color-scheme", value: "dark" }] : [] }],
  ["Emulation.setAutoDarkModeOverride", want === "auto" ? { enabled: true } : {}],
]
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }

async function apply(s: State) {
  const want = wanted(s)
  if (want === s.applied || s.p.wc.isDestroyed()) return
  // (never attaching to a page that was never darkened: the protocol costs nothing there)
  if (!want && !s.applied) return
  s.applied = want
  try {
    for (const [m, params] of commands(want)) await cdp(s.p.wc, m, params)
    if (want && !s.attached) { s.attached = true; await cdp(s.p.wc, "Target.setAutoAttach", AUTO_ATTACH) }
    for (const id of s.frames) void toFrame(s, id, want)
  } catch {
    // (its DevTools open, or a load swapping its process: tried again as the load commits, or at the next)
    if (s.applied === want) s.applied = "?"
  }
}
/** A frame of another site (its own process: the page's overrides don't reach it). */
async function toFrame(s: State, session: string, want: string) {
  const dbg = s.p.wc.debugger
  try { for (const [m, params] of commands(want)) await dbg.sendCommand(m, params, session) } catch { /* gone */ }
}
function watchFrames(s: State) {
  const dbg = s.p.wc.debugger
  dbg.on("message", (_e, method, params: { sessionId?: string; targetInfo?: { type?: string } }) => {
    if (method === "Target.attachedToTarget" && params.sessionId && params.targetInfo?.type === "iframe") {
      const id = params.sessionId
      s.frames.add(id)
      void dbg.sendCommand("Target.setAutoAttach", AUTO_ATTACH, id).catch(() => {})
      if (s.applied && s.applied !== "?") void toFrame(s, id, s.applied)
    } else if (method === "Target.detachedFromTarget" && params.sessionId) s.frames.delete(params.sessionId)
  })
  // (detached, as a page's DevTools can: the overrides are gone with it)
  dbg.on("detach", () => { s.applied = ""; s.attached = false; s.frames.clear() })
}

// ---------- pages and their frames ----------

const sessions = new Set<Session>()
eachSession((ses) => {
  sessions.add(ses)
  ses.registerPreloadScript({ type: "frame", filePath: PRELOAD })
})

/** Every frame of page `s` hears what it applies now. */
function tellFrames(s: State) {
  if (s.p.wc.isDestroyed()) return
  for (const fr of s.p.wc.mainFrame.framesInSubtree) {
    try { if (/^https?:/i.test(fr.url)) fr.send("vaultite:darkmode:set", frameChoice(s, fr.url, fr === s.p.wc.mainFrame)) } catch { /* a frame going away */ }
  }
}

eachPage((p) => {
  const s: State = { p, url: p.url, native: false, applied: "", frames: new Set(), attached: false }
  const wcId = p.wc.id
  states.set(p.id, s)
  byContents.set(wcId, s)
  p.wc.once("destroyed", () => { states.delete(p.id); byContents.delete(wcId) })
  watchFrames(s)
  // (before the site answers: its first paint is dark already. Taken as light till its main frame says: a dark page
  // darkened a moment shows little, a light one not darkened would flash)
  const going = (url: string) => {
    if (!hostOf(url)) return
    // (another site is another process, which the overrides told the last one don't reach: told again)
    if (hostOf(s.url) !== hostOf(url) && s.applied) s.applied = "?"
    s.url = url
    s.native = false
    void apply(s)
    canvasChanged(p.id)
  }
  p.wc.on("did-start-navigation", (d) => { if (d.isMainFrame && !d.isSameDocument) going(d.url) })
  p.wc.on("did-redirect-navigation", (d) => { if (d.isMainFrame) going(d.url) })
  p.wc.on("did-navigate", () => { if (s.applied === "?") void apply(s) })
  going(p.url)
})

/** The colour under a darkened page: the theme's background (a dark site's own canvas, a light one's tinted). */
canvasFrom((id) => {
  const s = states.get(id), c = choiceOf(s?.p.win)
  return s && darkens(c, hostOf(s.url)) ? c.bg : null
})

// (sync: the preload applies it before the page's first paint)
ipcMain.on("vaultite:darkmode:frame", (e, url, main) => {
  e.returnValue = typeof url === "string" && sessions.has(e.sender.session) ? frameChoice(byContents.get(e.sender.id), url, main === true) : null
})
/** A main frame found its page dark of itself (or not, any more). */
ipcMain.on("vaultite:darkmode:dark", (e, dark) => {
  const s = byContents.get(e.sender.id)
  if (!s || typeof dark !== "boolean" || e.senderFrame !== s.p.wc.mainFrame) return
  if (s.native === dark) return
  s.native = dark
  void apply(s)
  tellFrames(s)
})

const site = (x: unknown): x is string => typeof x === "string" && /^[a-z0-9.-]{1,253}$/.test(x)
const sites = (x: unknown) => (Array.isArray(x) ? x.filter(site).slice(0, 2000) : [])
const hex = (x: unknown, or: string) => (typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x) ? x.toLowerCase() : or)

/** The window's dark pages (the app's stylestate.ts): its pages follow at once, no reload. */
handle("darkmode:set", (win, x) => {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
  const c: Choice = { on: o.on === true, look: o.look === "dark" ? "dark" : "theme", bg: hex(o.bg, NONE.bg), fg: hex(o.fg, NONE.fg),
    off: sites(o.off) }
  const id = win.id, was = choices.get(id)
  if (was && JSON.stringify(was) === JSON.stringify(c)) return
  if (!was) win.once("closed", () => choices.delete(id))
  choices.set(id, lastChoice = c)
  for (const s of states.values()) if (s.p.win === win) {
    void apply(s)
    tellFrames(s)
    canvasChanged(s.p.id)
  }
})
