// Sharing (a call's Present, a room's Share): a menu at the pointer of the other tabs, each with only its own sound (the
// Mac's would send a call its own voices back), a window or screen (macOS's picker on 15+, else this screen), this tab.
import { desktopCapturer, Menu, screen, webContents, type DisplayMediaRequestHandlerHandlerRequest, type MenuItemConstructorOptions, type Session, type Streams } from "electron"
import { allPages, eachSession, type EnginePage } from "./engine.ts"

const MAC = process.platform === "darwin"
/** macOS's own picker: 15 and later, not under a test. */
const SYSTEM_PICKER = MAC && Number(process.getSystemVersion().split(".")[0]) >= 15 && !process.env.VAULTITE_QUIET

// A window source with a negative id is what makes Chromium show macOS's picker (Electron's `useSystemPicker` answers
// with it before our handler, so it couldn't be one choice of several).
let fake = -1
const systemPicker = () => ({ id: `window:${fake--}:0`, name: "" })

type Choice = { tab: EnginePage } | "this" | "screen" | null

const titleOf = (p: EnginePage) => {
  const t = p.wc.getTitle().trim()
  try { return t || new URL(p.wc.getURL()).hostname } catch { return t || "Untitled" }
}
const hostOf = (p: EnginePage) => { try { return new URL(p.wc.getURL()).hostname.replace(/^www\./, "") } catch { return "" } }

/** The menu, at the pointer in `p`'s window: what was picked, or null (dismissed). */
function ask(p: EnginePage, site: string, others: EnginePage[]): Promise<Choice> {
  return new Promise((resolve) => {
    let picked: Choice = null
    const pick = (c: Choice) => () => { picked = c; resolve(c) }
    // (the ones playing sound first: the movie, most likely)
    const tabs = [...others].sort((a, b) => Number(b.wc.isCurrentlyAudible()) - Number(a.wc.isCurrentlyAudible()))
    const items: MenuItemConstructorOptions[] = [
      { label: `${site} wants to share`, enabled: false },
      { type: "separator" },
      ...(tabs.length ? [{ label: "A tab, with its sound", enabled: false }] : []),
      ...tabs.slice(0, 20).map((t): MenuItemConstructorOptions => ({
        label: titleOf(t).slice(0, 70), sublabel: [hostOf(t), t.wc.isCurrentlyAudible() ? "playing sound" : ""].filter(Boolean).join(" · "),
        click: pick({ tab: t }),
      })),
      ...(tabs.length ? [{ type: "separator" as const }] : []),
      { label: SYSTEM_PICKER ? "A window or screen…" : "Entire screen", click: pick("screen") },
      { label: "This tab", click: pick("this") },
    ]
    // (a click comes before the menu says it closed, on every platform: closed with nothing picked is a no)
    Menu.buildFromTemplate(items).popup({ window: p.win, callback: () => setTimeout(() => { if (!picked) resolve(null) }, 0) })
  })
}

async function shareWhat(req: DisplayMediaRequestHandlerHandlerRequest): Promise<Streams | null> {
  const frame = req.frame, wc = frame && webContents.fromFrame(frame), p = wc && allPages().find((x) => x.wc === wc)
  // (an agent's page shares nothing: nobody there picked it)
  if (!frame || !p || !p.tab() || p.win.isDestroyed()) return null
  let site = "This page"
  try { site = new URL(frame.url).hostname.replace(/^www\./, "") || site } catch { /* a blank frame's */ }
  const others = allPages().filter((x) => x !== p && x.tab() && !x.wc.isDestroyed() && /^https?:|^file:/.test(x.wc.getURL()))
  const choice: Choice = others.length || !SYSTEM_PICKER ? await ask(p, site, others) : "screen"
  if (!choice) return null
  const sound = req.audioRequested
  if (choice === "this") return { video: frame, ...(sound ? { audio: frame } : {}) }
  if (typeof choice === "object") {
    const t = choice.tab
    if (t.wc.isDestroyed()) return null
    // (heard here still: Electron mutes a tab whose sound it captures, unless told not to; a test's isn't)
    return { video: t.wc.mainFrame, ...(sound ? { audio: t.wc.mainFrame, enableLocalEcho: !process.env.VAULTITE_QUIET } : {}) }
  }
  if (SYSTEM_PICKER) return { video: systemPicker() }
  const on = String(screen.getDisplayMatching(p.win.getBounds()).id)
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
  const source = sources.find((x) => x.display_id === on) ?? sources[0]
  return source ? { video: source, ...(sound && process.platform === "win32" ? { audio: "loopback" as const } : {}) } : null
}

// Electron's inner setter lets our handler answer with macOS's picker; without it, the public one and no picker.
eachSession((s: Session) => {
  const handler = (req: DisplayMediaRequestHandlerHandlerRequest, done: (s: Streams | null) => void) =>
    void shareWhat(req).then(done, () => done(null))
  const inner = "_setDisplayMediaRequestHandler" in s ? s._setDisplayMediaRequestHandler : undefined
  if (SYSTEM_PICKER && typeof inner === "function") inner.call(s, handler, { useSystemPicker: true })
  else s.setDisplayMediaRequestHandler(handler, { useSystemPicker: false })
})
