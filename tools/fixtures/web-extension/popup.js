// Paints the page it's opened over: the active tab of its window, by message, and the colour kept in the sync area.
const out = document.getElementById("out")
document.getElementById("options").onclick = () => chrome.runtime.openOptionsPage()
;(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  await chrome.storage.sync.set({ color: "orange" })
  const r = await chrome.tabs.sendMessage(tab.id, { type: "paint", color: "orange" })
  out.textContent = `painted ${r?.painted ?? "nothing"}`
  out.dataset.done = "1"
})().catch((e) => { out.textContent = `failed: ${e.message}` })
