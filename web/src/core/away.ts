// A gesture's end may never come (iOS's app switcher or a call mid-drag), so whatever a finger holds lets go here. The
// switcher only makes the app inactive, which a page doesn't hear: the iPhone app says so (`vaultite:away`).

/** Call `stop` when the app goes away (hidden, its window losing focus, the page put away, the iPhone app inactive).
 *  Returns the unsubscribe. */
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
