// Sharing a screen or window (a call's Present): macOS's own picker (15 and later), which needs no Screen Recording grant;
// elsewhere, and under VAULTITE_QUIET (no picker over a test), the user picks this tab or the screen its window is on.
import { desktopCapturer, dialog, screen, webContents, type DisplayMediaRequestHandlerHandlerRequest, type Streams } from "electron"
import { allPages, eachSession } from "./engine.ts"

async function shareWhat(req: DisplayMediaRequestHandlerHandlerRequest): Promise<Streams | null> {
  const frame = req.frame, wc = frame && webContents.fromFrame(frame), p = wc && allPages().find((x) => x.wc === wc)
  // (an agent's page shares nothing: nobody there picked it)
  if (!frame || !p || !p.tab() || p.win.isDestroyed()) return null
  let site = "This page"
  try { site = new URL(frame.url).hostname.replace(/^www\./, "") || site } catch { /* a blank frame's */ }
  const r = await dialog.showMessageBox(p.win, { type: "question", message: `${site} wants to share your screen`, buttons: ["Entire screen", "This tab", "Cancel"],
    defaultId: 0, cancelId: 2, noLink: true })
  if (r.response === 1) return { video: frame, ...(req.audioRequested ? { audio: frame } : {}) }
  if (r.response !== 0) return null
  const on = String(screen.getDisplayMatching(p.win.getBounds()).id)
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
  const source = sources.find((x) => x.display_id === on) ?? sources[0]
  return source ? { video: source, ...(req.audioRequested && process.platform === "win32" ? { audio: "loopback" as const } : {}) } : null
}

eachSession((s) => s.setDisplayMediaRequestHandler((req, done) => void shareWhat(req).then(done, () => done(null)),
  { useSystemPicker: !process.env.VAULTITE_QUIET }))
