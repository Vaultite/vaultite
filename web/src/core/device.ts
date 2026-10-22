// This device, as the server knows it: an id kept in this browser (each browser, and each address of the server, is a
// device of its own, as its tabs are). A browser driven by automation (QA, an agent's) is none: it isn't the user's.
export const DEVICE: string = (() => {
  if (typeof navigator !== "undefined" && navigator.webdriver) return ""
  const key = "vaultite.device"
  try {
    const had = localStorage.getItem(key)
    if (had && /^[a-z0-9]{8,32}$/.test(had)) return had
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join("")
    localStorage.setItem(key, id)
    return id
  } catch { return "" }
})()
