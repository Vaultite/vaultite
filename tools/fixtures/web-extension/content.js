// On the page: its colour from the sync area, its tab from the worker, and a repaint when the popup asks.
const root = document.documentElement
chrome.storage.sync.get({ color: "none" }).then((r) => { root.dataset.painter = r.color })
chrome.runtime.sendMessage({ type: "hello" }).then((r) => { root.dataset.painterTab = String(r?.tab) })
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.color) root.dataset.painter = root.dataset.painterSynced = changes.color.newValue
})
chrome.runtime.onMessage.addListener((m, _sender, reply) => {
  if (m?.type === "paint") { root.dataset.painter = m.color; reply({ painted: location.href }) }
})
// Its own stylesheet, in the page: a web-accessible resource.
const css = Object.assign(document.createElement("link"), { rel: "stylesheet", href: chrome.runtime.getURL("page.css") })
css.onload = () => { root.dataset.painterCss = "loaded" }
css.onerror = () => { root.dataset.painterCss = "failed" }
document.head.append(css)
