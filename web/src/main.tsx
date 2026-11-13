import "./core/dev"
import { StrictMode } from "react"
import { createRoot, type RootOptions } from "react-dom/client"
import "./index.css"
import "./core/shifts"
import "./core/appearance"
import "./core/selectAll"
import "./core/windowfocus"
import App from "./App.tsx"
import { startStore } from "./core/data"
import { startDesktop } from "./core/desktopapp"
import { prefetchShown, watchOpeningSoon } from "./core/files"
import { noteAppError, recoverFromStaleBuild, startAppErrors } from "./core/errors"

document.body.dataset.arriving = ""
startStore()
prefetchShown()
watchOpeningSoon()
startDesktop()

window.__vauStarted = true
document.getElementById("vau-boot-error")?.remove()
startAppErrors()
const STOPS = "vaultite.stops"
const stoppedEarly = () => {
  const now = Date.now(), early = performance.now() < 20_000
  try {
    const last = Number(sessionStorage.getItem(STOPS)) || 0
    if (early) sessionStorage.setItem(STOPS, String(now)); else sessionStorage.removeItem(STOPS)
    return early && now - last < 60_000
  } catch { return false }
}
const stopped = (error: unknown, info?: { componentStack?: string }) => {
  console.error(error)
  noteAppError("stopped", error, { component: info?.componentStack, fatal: true })
  void recoverFromStaleBuild(error).then((reloading) => { if (!reloading) window.showBootError?.(error, "Vaultite stopped", { fresh: true, again: stoppedEarly() }) })
}
// React stops logging caught errors once given onCaughtError: log them as it would.
const caught = (error: unknown, info: { componentStack?: string }) => { console.error(error); noteAppError("boundary", error, { component: info.componentStack }) }
const recovered: NonNullable<RootOptions["onRecoverableError"]> = (error, info) =>
  noteAppError("boundary", error instanceof Error && error.cause !== undefined ? error.cause : error, { component: info.componentStack })
createRoot(document.getElementById("root")!, { onUncaughtError: stopped, onCaughtError: caught, onRecoverableError: recovered }).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
