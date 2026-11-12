/** The page's main video: the biggest playing (else any), or the biggest frame that may go full screen (an embedded
 *  player), or none (the page itself fills the player). */
export const MAIN_VIDEO = `const size = (el) => { const r = el.getBoundingClientRect(); return r.width >= 160 && r.height >= 90 ? r.width * r.height : 0 }
  const videos = [...document.querySelectorAll("video")].map((el) => ({ el, video: el, n: size(el) * (el.paused ? 1 : 2) }))
  const frames = [...document.querySelectorAll("iframe")].filter((f) => f.allowFullscreen || /\\bfullscreen\\b/.test(f.allow)).map((el) => ({ el, video: null, n: size(el) }))
  const best = [...videos, ...frames].filter((c) => c.n > 0).sort((a, b) => b.n - a.n)[0]`
// The video's player (its site's box around it, no bigger: its controls, captions) fills the window as a popover, in
// the top layer over the page, leaving the page's own full screen to the site; answers its aspect (width / height).
export const FILL = `(() => {
  const fill = () => {
    window.__vaultitePlayer?.off()
    ${MAIN_VIDEO}
    if (!best) return null
    const v = best.video, box = (v ?? best.el).getBoundingClientRect()
    const aspect = () => v?.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : null
    // (the box around the video no bigger than it, the nearest that says it's a player, wrappers with no size skipped)
    const holder = () => {
      const n = size(v), boxes = []
      for (let at = v.parentElement; at && at !== document.body; at = at.parentElement) { const s = size(at); if (s > n * 1.25) break; if (s) boxes.push(at) }
      return boxes.find((b) => /player/i.test(b.id + " " + b.className + " " + b.localName)) ?? boxes.at(-1) ?? v
    }
    // (a popover closed is display: none, so it's one only while open)
    let el = null, chosen = null
    const release = () => {
      if (!el) return
      try { if (el.matches(":popover-open")) el.hidePopover() } catch {}
      el.removeAttribute("popover"); el.removeAttribute("data-vaultite-player"); el = null
    }
    const hold = () => {
      release()
      if (v && !size(v)) return // (mid-change, the site laying it out: held as it has a size again)
      // (the box first chosen, while it still holds the video: mid-change, the site's own sizes are a moment behind)
      el = !v ? best.el : chosen?.isConnected && chosen.contains(v) ? chosen : (chosen = holder())
      el.setAttribute("data-vaultite-player", ""); el.setAttribute("popover", "manual")
      try { el.showPopover() } catch { release() }
    }
    // (the site's own full screen draws it: out of the top layer meanwhile, and held again after)
    const full = () => { if (document.fullscreenElement) release(); else if (!el) hold() }
    const fullscreening = () => !!document.fullscreenElement || document.documentElement.hasAttribute("data-vaultite-fullscreening")
    // (a site moving its player in the page, as YouTube does by width, takes it out of the top layer: held again at once)
    const moved = new ResizeObserver(() => {
      if (fullscreening() || !v.isConnected) return
      const r = v.getBoundingClientRect()
      if (r.width < innerWidth - 1 || r.height < innerHeight - 1) hold()
    })
    // (and whatever else undoes it, the site's video replaced: a second later)
    const check = setInterval(() => {
      if (fullscreening()) return
      if (v && !v.isConnected) { const w = wake; wake = null; again(w) }
      else if (!el?.isConnected || !el.matches(":popover-open")) hold()
    }, 1000)
    // (its aspect told to the one waiting for the old video's)
    const again = (w, tries = 10) => {
      const a = fill()
      if (a !== null || !tries) w?.(a ?? undefined)
      else setTimeout(() => { if (!window.__vaultitePlayer) again(w, tries - 1) }, 500)
    }
    let wake = null
    const resized = () => { const w = wake; wake = null; w?.(aspect()) }
    v?.setAttribute("data-vaultite-player-video", "")
    v?.addEventListener("resize", resized)
    document.addEventListener("fullscreenchange", full)
    window.__vaultitePlayer = {
      next: () => new Promise((r) => { wake = r }),
      off: () => {
        clearInterval(check); moved.disconnect(); v?.removeEventListener("resize", resized); document.removeEventListener("fullscreenchange", full)
        release(); v?.removeAttribute("data-vaultite-player-video")
        delete window.__vaultitePlayer; const w = wake; wake = null; w?.(undefined)
      },
    }
    hold()
    if (v) moved.observe(v)
    return aspect() ?? (box.width / box.height)
  }
  return fill()
})()`
export const FILL_CSS = `[data-vaultite-player]:popover-open { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
  min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important; margin: 0 !important; padding: 0 !important;
  border: 0 !important; border-radius: 0 !important; overflow: hidden !important; transform: none !important; background: #000 !important }
[data-vaultite-player]:popover-open { color: inherit }
[data-vaultite-player]::backdrop { background: #000 }
html:has([data-vaultite-player]:popover-open) { scrollbar-width: none !important }
[data-vaultite-player]:popover-open [data-vaultite-player-video], video[data-vaultite-player]:popover-open { position: fixed !important; inset: 0 !important;
  width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; margin: 0 !important; transform: none !important;
  object-fit: contain !important }`
// (the page's world: a popover can't go full screen, so the site's own full screen of the video's player takes it out of
// the popover first (held again as it leaves); a refused one puts it back at once)
export const FULL_GUARD = `(() => {
  for (const name of ["requestFullscreen", "webkitRequestFullscreen", "webkitRequestFullScreen"]) {
    const own = Element.prototype[name]
    if (!own || own.vaultite) continue
    const guarded = function (...a) {
      const ours = this.hasAttribute?.("data-vaultite-player") && this.matches(":popover-open")
      if (ours) { document.documentElement.setAttribute("data-vaultite-fullscreening", ""); this.hidePopover(); this.removeAttribute("popover") }
      const r = own.apply(this, a)
      if (ours) {
        const settled = () => document.documentElement.removeAttribute("data-vaultite-fullscreening")
        for (const e of ["fullscreenchange", "fullscreenerror"]) document.addEventListener(e, settled, { once: true })
        r?.then?.(settled, () => { settled(); if (!document.fullscreenElement && this.hasAttribute("data-vaultite-player")) { this.setAttribute("popover", "manual"); this.showPopover() } })
      }
      return r
    }
    guarded.vaultite = true
    Element.prototype[name] = guarded
  }
})()`
export const UNFILL = `(() => { window.__vaultitePlayer?.off(); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}) })()`
