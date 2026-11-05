// Dark pages in each frame (electron/browser/darkmode.ts): a main frame finds whether its page is dark itself, before its
// first paint and as it loads, and tints itself while it isn't. Isolated world, no Node.
"use strict"
const { ipcRenderer, webFrame } = require("electron")

if (/^https?:/.test(location.href)) {
  const main = window.top === window
  /** What the engine says applies here (null: dark pages are off for this site). */
  let choice = null
  /** Whether the page is dark of itself, and what the engine was last told (light till then, as it takes it). */
  let dark = false, told = false
  let key = "", sheet = ""
  const put = (css) => {
    if (css === sheet) return
    if (key) webFrame.removeInsertedCSS(key)
    // (author CSS, which Chromium orders first: a layer's !important beats the page's own. Not the user's origin, which
    // Electron can't take out again)
    key = css ? webFrame.insertCSS(`@layer vaultite-dark {\n${css}\n}`) : ""
    sheet = css
  }
  const show = () => put(choice && !(main && dark) ? choice.css : "")

  let ctx = null
  /** A colour as the browser draws it (any syntax: oklch(), color-mix()), [r, g, b, a] 0-255. */
  const rgba = (c) => {
    ctx ??= new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true })
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = "transparent"
    ctx.fillStyle = c
    ctx.fillRect(0, 0, 1, 1)
    return ctx.getImageData(0, 0, 1, 1).data
  }
  const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const luminance = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
  const fill = (el) => { const c = rgba(getComputedStyle(el).backgroundColor); return c[3] > 128 ? c : null }
  /** The page's own background (computed: what the site asks, before auto dark paints it), else what's under the
   *  window's middle, else its canvas (dark when its colour scheme is). The root's is the sheet's while it's in. */
  function ownDark() {
    const root = document.documentElement, body = document.body
    let c = (body && fill(body)) || (sheet ? null : fill(root))
    if (!c && body) {
      for (let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); el && el !== body && el !== root; el = el.parentElement) {
        if ((c = fill(el))) break
      }
    }
    if (c) return luminance(c) < 0.2
    const scheme = getComputedStyle(root).colorScheme
    return /dark/.test(scheme) && (!/light/.test(scheme) || matchMedia("(prefers-color-scheme: dark)").matches)
  }
  function check() {
    if (!main || !choice || !document.documentElement) return
    let d = dark
    try { d = ownDark() } catch { return }
    if (d !== dark) { dark = d; show() }
    if (d !== told) { told = d; ipcRenderer.send("vaultite:darkmode:dark", d) }
  }

  const take = (c) => {
    choice = c && typeof c === "object" && typeof c.css === "string" ? c : null
    show()
  }
  try { take(ipcRenderer.sendSync("vaultite:darkmode:frame", location.href, main)) } catch { /* none */ }
  ipcRenderer.on("vaultite:darkmode:set", (_e, c) => { take(c); check() })
  // (a site style arriving or changing after the page loaded can make it dark, or light again: judged as it now looks)
  ipcRenderer.on("vaultite:sitestyles:css", () => requestAnimationFrame(check))

  if (main) {
    // (the first frame's animation callback runs before it paints: decided by then, no frame shows the other way)
    const first = () => {
      if (!document.body && document.readyState === "loading") requestAnimationFrame(first)
      else check()
    }
    requestAnimationFrame(first)
    document.addEventListener("DOMContentLoaded", check, { once: true })
    addEventListener("load", () => { check(); setTimeout(check, 1000) }, { once: true })
    try { navigation.addEventListener("navigatesuccess", () => requestAnimationFrame(check)) } catch { /* no Navigation API */ }
  }
}
