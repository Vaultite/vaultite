import "./core/dev" // keeps the console's messages from here on, and answers the server's asks (vau dev, vau commands)
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import "./core/appearance" // applies the theme, scheme, density and fonts before the first paint
import App from "./App.tsx"
import { startStore } from "./core/data"
import { startDesktop } from "./core/desktop"
import { prefetchShown } from "./core/files"
import { noteAppError, recoverFromStaleBuild, startAppErrors } from "./core/errors"

startStore() // the vault's state and its live changes, on their way while React draws the first frame
prefetchShown() // and the files on screen
startDesktop() // the desktop app's menu and files (nothing in a browser)

// Started: from here an error is the app's, not index.html's boot screen. One nothing below caught unmounts the app,
// so say so (showBootError) rather than leave a blank window.
const boot = window as Window & { __vauStarted?: boolean; showBootError?: (error: unknown, title?: string, opts?: { fresh?: boolean; again?: boolean }) => void }
boot.__vauStarted = true
document.getElementById("vau-boot-error")?.remove()
// Each is kept for the Errors plugin (core/errors.ts); a file of the app that didn't load reloads once the server
// answers. What a tab, a panel or a sheet draws fails alone (components/Guard.tsx): only the rest stops the app.
startAppErrors()
// It stopped within 20 s of starting, the last time too (a minute ago at most): what it opens as it starts may be what
// fails, so the screen leads with Reload with a new tab.
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
  void recoverFromStaleBuild(error).then((reloading) => { if (!reloading) boot.showBootError?.(error, "Vaultite stopped", { fresh: true, again: stoppedEarly() }) })
}
// (React logs a caught error itself unless given onCaughtError: so does this one)
const caught = (error: unknown, info: { componentStack?: string }) => { console.error(error); noteAppError("boundary", error, { component: info.componentStack }) }
createRoot(document.getElementById("root")!, { onUncaughtError: stopped, onCaughtError: caught }).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
