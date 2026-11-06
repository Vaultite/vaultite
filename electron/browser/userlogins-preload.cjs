// Your own logins in each frame of a web page (electron/browser/userlogins.ts): sandboxed, no Node, in the isolated
// world. It says whether the frame shows a login form, and what a sign-in sent (for the app to offer to save it).
"use strict"
const { ipcRenderer } = require("electron")

if (/^https?:/.test(location.href)) {
  const CODE = /one[-_ ]?time|\botp\b|totp|2fa|mfa|verification[-_ ]?code|security[-_ ]?code|passcode/i
  const USER = /user|e-?mail|login|account|identifier|phone|signin/i
  const SUBMIT = /^(sign ?in|log ?in|login|continue|next|submit|sign ?up|register|create( an)? account|save|change password|update password|reset password)$/i
  const TEXT = new Set(["", "text", "email", "tel"])
  const hint = (i) => `${i.name} ${i.id} ${i.getAttribute("aria-label") || ""} ${i.placeholder || ""}`
  const ac = (i) => (i.getAttribute("autocomplete") || "").toLowerCase()
  const shown = (i) => i.isConnected && !i.disabled && i.getClientRects().length > 0
    && (!i.checkVisibility || i.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))

  // ---------- whether the frame shows a login form: a password field, a username's or a one-time code's ----------
  // (each document says its state once, even none: a late word from the page before it would stand otherwise)
  let told = null, timer = 0
  const scan = () => {
    timer = 0
    let form = false, password = false
    for (const i of document.querySelectorAll("input")) {
      const pw = i.type === "password"
      if (!pw && !TEXT.has(i.type) && i.type !== "number") continue
      if (!pw && !/username|one-time-code/.test(ac(i)) && !CODE.test(hint(i))) continue
      if (!shown(i)) continue
      form = true
      if (pw) { password = true; break }
    }
    if (!told || form !== told.form || password !== told.password) {
      told = { form, password }
      ipcRenderer.send("vaultite:logins:form", told)
    }
  }
  // (at most a scan in a while, however busy the page: a query of its inputs)
  const soon = () => { if (!timer) timer = setTimeout(scan, 500) }
  new MutationObserver(soon).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["type", "style", "class", "hidden", "disabled"] })
  addEventListener("DOMContentLoaded", scan)
  addEventListener("focusin", soon, true)

  // ---------- a sign-in sent: its password (the new one of a change) and the username before it ----------
  let last = "", lastAt = 0
  const send = (username, password) => {
    const key = `${username}\n${password}`
    if (key === last && Date.now() - lastAt < 2000) return
    last = key; lastAt = Date.now()
    ipcRenderer.send("vaultite:logins:submitted", { username, password })
  }
  const capture = (from) => {
    const form = from && from.closest ? from.closest("form") : null
    const root = from && from.getRootNode ? from.getRootNode() : document
    const inputsOf = (scope) => [...scope.querySelectorAll("input")]
    let all = inputsOf(form || (root.querySelectorAll ? root : document))
    let pws = all.filter((i) => i.type === "password" && i.value && shown(i))
    if (!pws.length && (form || root !== document)) { all = inputsOf(document); pws = all.filter((i) => i.type === "password" && i.value && shown(i)) }
    const texts = all.filter((i) => TEXT.has(i.type) && i.value && shown(i) && !/search|\bq\b/i.test(hint(i)))
    // (a page that names the username in a hidden field, as a password step after a username-first one does)
    const named = all.find((i) => /username|email/.test(ac(i)) && i.value && i.type !== "password")
    if (!pws.length) {
      // A username-first step: its username alone, for the password step after it.
      const one = texts.length === 1 ? texts[0] : null
      const u = named || (one && (one.type === "email" || USER.test(hint(one))) ? one : null)
      if (u) send(u.value.trim(), "")
      return
    }
    // (a change of password: the new one, typed twice, or the field marked new)
    let pw = pws[0]
    if (pws.length > 1) {
      const a = pws[pws.length - 1], b = pws[pws.length - 2]
      pw = a.value === b.value ? a : pws.find((i) => ac(i) === "new-password") || pws[0]
    }
    const before = texts.filter((i) => i.compareDocumentPosition(pws[0]) & Node.DOCUMENT_POSITION_FOLLOWING)
    const user = before.find((i) => /username|email/.test(ac(i))) || named || before[before.length - 1]
    send(user ? user.value.trim() : "", pw.value)
  }
  addEventListener("submit", (e) => capture(e.composedPath()[0]), true)
  addEventListener("keydown", (e) => {
    if (!e.isTrusted || e.key !== "Enter" || e.isComposing) return
    const t = e.composedPath()[0]
    if (t instanceof HTMLInputElement) capture(t)
  }, true)
  addEventListener("click", (e) => {
    if (!e.isTrusted) return
    const t = e.composedPath().find((n) => n instanceof Element && n.matches("button, input[type=submit], input[type=button], [role=button]"))
    if (!t) return
    const type = (t.getAttribute("type") || "").toLowerCase()
    const labels = [t.textContent, t.value, t.getAttribute("aria-label")].map((x) => String(x || "").replace(/\s+/g, " ").trim())
    if (type === "submit" || (t.tagName === "BUTTON" && !type && t.closest("form")) || labels.some((x) => SUBMIT.test(x))) capture(t)
  }, true)
}
