// Shields in each frame of a web page (electron/browser/adblock.ts): sandboxed, no Node, in the isolated world. It runs
// before the page's first script, so scriptlets (YouTube's video ads) are in the page's world before the page is. The
// user's own rules (Blocked elements) come with Shields', and again whenever they change.
"use strict"
const { contextBridge, ipcRenderer, webFrame } = require("electron")

const url = location.href
let first = null
if (/^https?:/.test(url)) {
  try { first = ipcRenderer.sendSync("vaultite:adblock:frame", url) } catch { /* Shields down */ }
}
/** The user's rules: their stylesheet (replaced as they change) and the ones it can't say, run with Shields'. A page's
 *  own sheet, as Electron can't take a user one back; in a layer, so its !important wins over the page's unlayered. */
let mineCSS = "", mineRun = null, mineDom = "", mineDomCSS = ""
const layered = (css) => webFrame.insertCSS(`@layer vaultite-hidden {\n${css}\n}`)
function setMine(m, lib) {
  if (mineCSS) webFrame.removeInsertedCSS(mineCSS)
  mineCSS = m.styles ? layered(m.styles) : ""
  mineRun = m.extended?.length ? procedural(m.extended, lib) : null
  mineRun?.()
}
/** Their generic rules (`##.sponsor`) for the classes, ids and links the frame has: kept together, to take back. */
function addMineDom(css) {
  if (!css) return
  mineDom += `${css}\n`
  if (mineDomCSS) webFrame.removeInsertedCSS(mineDomCSS)
  mineDomCSS = layered(mineDom)
}
if (first) {
  const shields = first.shields
  if (shields?.styles) webFrame.insertCSS(shields.styles, { cssOrigin: "user" })
  for (const code of shields?.scripts ?? []) {
    // (a function made here keeps the page's CSP from refusing it as eval)
    try { contextBridge.executeInMainWorld({ func: new Function(code) }) } catch { /* a scriptlet that throws stops only itself */ }
  }
  if (first.user) setMine(first.user, first.lib)
  const run = shields?.extended?.length ? procedural(shields.extended, first.lib) : null
  watch(first.watch, () => { run?.(); mineRun?.() })
}
if (/^https?:/.test(url)) ipcRenderer.on("vaultite:adblock:user", (_e, m) => {
  if (!m || typeof m !== "object") return
  setMine(m, m.lib)
  // (their generic rules asked again for everything the frame has)
  if (mineDomCSS) webFrame.removeInsertedCSS(mineDomCSS)
  mineDom = mineDomCSS = ""
  if (!document.documentElement) return
  const all = { classes: new Set(), ids: new Set(), hrefs: new Set() }
  for (const x of document.querySelectorAll("[id],[class],[href]")) {
    if (x.id) all.ids.add(x.id)
    for (const c of x.classList) all.classes.add(c)
    const h = x.getAttribute("href")
    if (h) all.hrefs.add(h)
  }
  const ask = { classes: [...all.classes], ids: [...all.ids], hrefs: [...all.hrefs] }
  ipcRenderer.invoke("vaultite:adblock:dom", url, ask, "user").then((r) => addMineDom(r?.user), () => {})
})

/** Rules a stylesheet can't say (`:has-text()`, `:upward()`, `:remove()`), matched with Ghostery's selectors (`lib`, its
 *  source) as the frame changes: an element matched gets the attribute the frame's styles hide, or the rule's action. */
function procedural(rules, lib) {
  const sel = {}
  try { new Function("exports", "module", lib)(sel, { exports: sel }) } catch { return null }
  return () => {
    for (const r of rules) {
      let found = []
      try { found = sel.querySelectorAll(document.documentElement, r.ast) } catch { /* a rule this version can't run */ }
      for (const el of found) {
        if (r.directive) sel.handlePseudoDirective(el, r.directive)
        else if (r.attribute && !el.hasAttribute(r.attribute)) el.setAttribute(r.attribute, "")
      }
    }
  }
}

/** Generic hiding rules (`##.ad-banner`) are asked for the classes, ids and links the frame has, and gets; procedural
 *  ones run again as it changes. */
function watch(live, run) {
  const known = new Set()
  let found = { classes: [], ids: [], hrefs: [] }, timer = 0, since = 0
  const add = (kind, v) => { if (v && !known.has(kind + v)) { known.add(kind + v); found[kind].push(v) } }
  const scan = (el, deep) => {
    if (el.nodeType !== 1) return
    for (const x of deep ? [el, ...el.querySelectorAll("[id],[class],[href]")] : [el]) {
      add("ids", x.getAttribute("id"))
      for (const c of x.classList) add("classes", c)
      add("hrefs", x.getAttribute("href"))
    }
  }
  const send = () => {
    clearTimeout(timer)
    timer = 0
    since = 0
    run?.()
    if (!found.classes.length && !found.ids.length && !found.hrefs.length) return
    const ask = found
    found = { classes: [], ids: [], hrefs: [] }
    ipcRenderer.invoke("vaultite:adblock:dom", url, ask).then((r) => {
      if (r?.shields) webFrame.insertCSS(r.shields, { cssOrigin: "user" })
      addMineDom(r?.user)
    }, () => {})
  }
  // (a burst of changes is one question: 25 ms after the last, at most a second after the first)
  const soon = () => {
    clearTimeout(timer)
    if (!since) since = Date.now()
    timer = setTimeout(send, Date.now() - since > 1000 ? 0 : 25)
  }
  addEventListener("DOMContentLoaded", () => {
    scan(document.documentElement, true)
    send()
    if (!live) return
    new MutationObserver((changes) => {
      for (const m of changes) {
        if (m.type === "attributes") scan(m.target, false)
        else for (const n of m.addedNodes) scan(n, true)
      }
      soon()
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "id", "href"] })
  }, { once: true })
}
