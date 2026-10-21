// Blocking listeners on the QA's site: /ext-block/ is cancelled, /ext-redirect/ goes to /redirected.js, /echo gets a
// request header and a response header. What each saw is kept in `seen` for the QA to read.
const seen = (globalThis.seen = { before: 0, cancelled: [], redirected: [], sendHeaders: 0, headers: 0 })
const urls = ["http://127.0.0.1/*"]
chrome.webRequest.onBeforeRequest.addListener((d) => {
  seen.before++
  if (d.url.includes("/ext-block/")) { seen.cancelled.push(d.url); return { cancel: true } }
  if (d.url.includes("/ext-redirect/")) { seen.redirected.push(d.url); return { redirectUrl: new URL("/redirected.js", d.url).href } }
}, { urls }, ["blocking"])
chrome.webRequest.onBeforeSendHeaders.addListener((d) => {
  if (!d.url.includes("/echo")) return
  seen.sendHeaders++
  return { requestHeaders: [...d.requestHeaders, { name: "X-Bender", value: "yes" }] }
}, { urls, types: ["xmlhttprequest"] }, ["blocking", "requestHeaders"])
chrome.webRequest.onHeadersReceived.addListener((d) => {
  if (!d.url.includes("/echo")) return
  seen.headers++
  return { responseHeaders: [...d.responseHeaders, { name: "X-Bent", value: "yes" }] }
}, { urls }, ["blocking", "responseHeaders"])
