// iOS's app switcher or a call mid-drag may never end a gesture, and the switcher only makes the app inactive, which a
// page doesn't hear: the iPhone app sends `vaultite:away`.

export function onAway(stop: () => void) {
  const hidden = () => { if (document.hidden) stop() }
  document.addEventListener("visibilitychange", hidden)
  addEventListener("blur", stop)
  addEventListener("pagehide", stop)
  addEventListener("vaultite:away", stop)
  return () => {
    document.removeEventListener("visibilitychange", hidden)
    removeEventListener("blur", stop)
    removeEventListener("pagehide", stop)
    removeEventListener("vaultite:away", stop)
  }
}
