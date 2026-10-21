// Observers of every event on the QA's site, the sign-in that /auth asks for (once per request, as KeePassXC-Browser
// answers: asyncBlocking with a callback), and a blocking listener Manifest V3 refuses. Its pages ask for `seen`.
const seen = { events: {}, urls: [], tabs: [], errors: [], sendHeaders: false, responseHeaders: false, auth: [], refused: false }
const urls = ["http://127.0.0.1/*"]
const count = (name) => (d) => {
  seen.events[name] = (seen.events[name] ?? 0) + 1
  if (name === "onBeforeRequest") { seen.urls.push(d.url); if (d.type === "main_frame") seen.tabs.push(d.tabId) }
  if (name === "onSendHeaders" && d.requestHeaders?.some((h) => h.name.toLowerCase() === "user-agent")) seen.sendHeaders = true
  if (name === "onCompleted" && d.responseHeaders?.some((h) => h.name.toLowerCase() === "content-type")) seen.responseHeaders = true
  if (name === "onErrorOccurred") seen.errors.push(`${d.url} ${d.error}`)
}
chrome.webRequest.onBeforeRequest.addListener(count("onBeforeRequest"), { urls })
chrome.webRequest.onSendHeaders.addListener(count("onSendHeaders"), { urls }, ["requestHeaders"])
chrome.webRequest.onHeadersReceived.addListener(count("onHeadersReceived"), { urls })
chrome.webRequest.onResponseStarted.addListener(count("onResponseStarted"), { urls })
chrome.webRequest.onBeforeRedirect.addListener(count("onBeforeRedirect"), { urls })
chrome.webRequest.onCompleted.addListener(count("onCompleted"), { urls }, ["responseHeaders"])
chrome.webRequest.onErrorOccurred.addListener(count("onErrorOccurred"), { urls })
const tried = new Set()
chrome.webRequest.onAuthRequired.addListener((d, callback) => {
  seen.auth.push({ url: d.url, realm: d.realm, isProxy: d.isProxy, tabId: d.tabId, again: tried.has(d.requestId) })
  if (tried.has(d.requestId) || !d.url.includes("/auth")) return callback({})
  tried.add(d.requestId)
  setTimeout(() => callback({ authCredentials: { username: "alice", password: d.url.includes("wrong") ? "nope" : "lighthouse" } }), 50)
}, { urls }, ["asyncBlocking"])
try { chrome.webRequest.onBeforeRequest.addListener(() => ({ cancel: true }), { urls }, ["blocking"]) } catch { seen.refused = true }
chrome.runtime.onMessage.addListener((m, _sender, reply) => { if (m?.type === "seen") reply(seen) })
