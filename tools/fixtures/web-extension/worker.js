// The extension's service worker: sets the sync area's colour once, badges its button, answers the page's hello with
// its tab, and opens a tab when asked.
chrome.runtime.onInstalled.addListener(() => { chrome.storage.sync.set({ color: "teal" }) })
chrome.action.setBadgeText({ text: "on" })
chrome.action.setBadgeBackgroundColor({ color: "#2266cc" })
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m?.type === "hello") reply({ tab: sender.tab?.id ?? -1 })
  else if (m?.type === "open") chrome.tabs.create({ url: m.url }).then((t) => reply({ opened: !!t }))
  else if (m?.type === "windows") chrome.windows.getAll({ populate: true }).then((w) => reply({ windows: w.length, tabs: w.flatMap((x) => x.tabs ?? []).length }))
  return true
})
chrome.tabs.onUpdated.addListener((id, change) => { if (change.status === "complete") chrome.storage.local.set({ lastLoaded: id }) })
