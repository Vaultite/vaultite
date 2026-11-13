import type { VaultTest } from "./harness.ts"

type Check = VaultTest["check"]
type Style = { display: string; visibility: string; content: string; listStyleType: string }

const INLINE = /^(a|b|i|em|strong|span|label|code|small|sup|sub)$/
const styleFromMarkup = (el: Element, pseudo?: string): Style => ({
  display: pseudo ? "none" : el.localName === "li" ? "list-item" : INLINE.test(el.localName) ? "inline" : "block",
  visibility: el.closest("[data-invisible]") ? "hidden" : "visible", content: "none", listStyleType: el.parentElement?.localName === "ol" ? "decimal" : "disc",
})

async function pageOf(html: string) {
  const { parseHTML } = await import("linkedom")
  const { document, window } = parseHTML(`<html><head><title>Lighthouse</title></head><body>${html}</body></html>`)
  Object.defineProperty(window.Element.prototype, "checkVisibility", { configurable: true, value(this: Element, o?: { visibilityProperty?: boolean }) {
    return !this.closest("[hidden]") && !(o?.visibilityProperty && this.closest("[data-invisible]"))
  } })
  return document
}

async function inPage<T>(doc: Document, run: () => Promise<T> | T): Promise<T> {
  const was = { document: Reflect.getOwnPropertyDescriptor(globalThis, "document"), style: Reflect.getOwnPropertyDescriptor(globalThis, "getComputedStyle") }
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc })
  Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: styleFromMarkup })
  try { return await run() } finally {
    for (const [k, d] of Object.entries(was)) if (d) Object.defineProperty(globalThis, k === "style" ? "getComputedStyle" : k, d); else Reflect.deleteProperty(globalThis, k === "style" ? "getComputedStyle" : k)
  }
}

async function world() {
  const { agentWorld, pageAX } = await import("../../../electron/browser/axdom.ts")
  const { axLines, INTERACTIVE } = await import("../../../electron/browser/axlines.ts")
  const { shortUrl } = await import("../../../electron/browser/linktext.ts")
  return agentWorld(pageAX(), axLines, { short: shortUrl, interactive: [...INTERACTIVE] })
}

async function secrets(check: Check) {
  const S = "hunter2-secret"
  const doc = await pageOf(`<form><input id="pw" type="password" value="${S}" aria-label="Password">
    <div id="filled" role="textbox" aria-label="Code" contenteditable="true">${S}</div><input aria-label="Email" value="alice@example.com"></form>`)
  const lines = await inPage(doc, async () => {
    const w = await world()
    const filled = doc.getElementById("filled")
    if (filled) w.secret(filled)
    return w.lines("https://example.com/")
  })
  check("browser agents: a snapshot made in the page shows no filled secret, no password nor its length, the rest as it is",
    !lines.includes(S) && /textbox "Password" \[ref=e\d+\]: •••( |$)/m.test(lines) && /textbox "Code" \[ref=e\d+\]: •••( |$)/m.test(lines) && lines.includes("alice@example.com"), lines)
}

async function rolesAndNames(check: Check) {
  const doc = await pageOf(`<nav aria-label="Site"><a href="/posts/why">Why we built it</a></nav><main><h1>Lighthouse</h1>
    <button>Save <span aria-hidden="true">✓</span></button><div role="checkbox" tabindex="0" aria-checked="true">Remember me</div>
    <select aria-label="Plan"><option>Free</option><option selected>Pro</option></select><img alt="A lighthouse at dusk">
    <p hidden>Not shown</p><p data-invisible>Invisible</p><ol><li>First</li><li>Second</li></ol></main>`)
  const lines = await inPage(doc, async () => (await world()).lines("https://example.com/"))
  const has = [/^- RootWebArea "Lighthouse"/, /navigation "Site"\n\s+- link "Why we built it" \(→ \/posts\/why\) \[ref=e\d+\]/, /heading "Lighthouse"/, /button "Save" \[ref=e\d+\]/,
    /checkbox "Remember me" \[ref=e\d+\] \[checked\]/, /combobox "Plan" \[ref=e\d+\]: Pro/, /image "A lighthouse at dusk"/, /ListMarker "1\."/, /ListMarker "2\."/]
  check("browser agents: an in-page snapshot has Chromium's roles, names, values and states, and leaves out what's hidden or invisible",
    has.every((r) => r.test(lines)) && !lines.includes("Not shown") && !lines.includes("Invisible") && !lines.includes("✓"), lines)
}

async function refsAndTables(check: Check) {
  const rows = Array.from({ length: 3 }, (_, i) => `<tr><td>Row ${i}</td><td><a href="/r${i}">open</a></td></tr>`).join("")
  const doc = await pageOf(`<table id="layout">${rows}</table><table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>Alice Park</td></tr></tbody></table>
    <button id="go">Go</button>`)
  const r = await inPage(doc, async () => {
    const w = await world(), first = w.lines("https://example.com/"), again = w.lines("https://example.com/")
    const ref = /button "Go" \[ref=(e\d+)\]/.exec(first)?.[1] ?? "", now = w.now(ref)
    doc.getElementById("go")?.remove()
    return { first, again, ref, now, gone: w.now(ref), none: w.now("e999") }
  })
  check("browser agents: a ref stays its element's across snapshots, says what it is now, and says when it's gone",
    !!r.ref && r.first === r.again && r.now?.gone === false && r.now.role === "button" && r.now.name === "Go" && r.now.was?.name === "Go" &&
    r.gone?.gone === true && r.none === null, r)
  check("browser agents: a table only laying a page out isn't one in its snapshot, a data table is",
    !/LayoutTable|- row: "Row 0"/.test(r.first) && /- link "open" \(→ \/r0\)/.test(r.first) && /- table/.test(r.first) && /columnheader "Name"/.test(r.first), r.first)
}

export default async ($: VaultTest) => {
  for (const t of [secrets, rolesAndNames, refsAndTables]) await t($.check)
}
