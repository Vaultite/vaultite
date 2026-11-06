// The app filling a login into a page: agents' (logins.ts) and the user's own (passwordfill.ts) alike. Fields are read
// and typed over the DevTools protocol, never by the page's scripts; what's filled is kept from agents (pagesecrets.ts).
import type { WebContents } from "electron"
import crypto from "node:crypto"
import { press } from "./agent.ts"
import { cdp, type EnginePage } from "./engine.ts"
import type { Secrets } from "./keepass.ts"
import { loginForm, type Input } from "./loginform.ts"
import { docOf, filling, keep, markFilled, markHeld, ranNear, siteOf } from "./pagesecrets.ts"

const keepass = () => import("./keepass.ts")

type DomNode = { backendNodeId: number; nodeName: string; attributes?: string[]; documentURL?: string; children?: DomNode[]
  contentDocument?: DomNode; shadowRoots?: DomNode[]; templateContent?: DomNode }
type Field = { input: Input; frame: string }

type AxNode = { ignored?: boolean; properties?: { name: string; value: { value?: unknown } }[] }
/** An accessibility node's boolean property (`focusable`, `focused`). */
const axProp = (n: AxNode | undefined, name: string) => { const v = n?.properties?.find((x) => x.name === name)?.value?.value; return v === true || v === "true" }

/** Every input of the page and its frames in this process, with the address of the document it's in. */
async function fieldsOf(p: EnginePage): Promise<Field[]> {
  const { root } = await cdp<{ root: DomNode }>(p.wc, "DOM.getDocument", { depth: -1, pierce: true })
  const out: Field[] = []
  const walk = (n: DomNode, frame: string, form: number) => {
    const name = n.nodeName.toUpperCase()
    if (name === "#DOCUMENT") frame = n.documentURL || frame
    if (name === "FORM") form = n.backendNodeId
    if (name === "INPUT") {
      const a: Record<string, string> = {}
      for (let i = 0; i + 1 < (n.attributes ?? []).length; i += 2) a[n.attributes![i].toLowerCase()] = n.attributes![i + 1]
      out.push({ frame, input: { id: n.backendNodeId, type: (a.type ?? "").toLowerCase(), hint: [a.name, a.id, a["aria-label"], a.placeholder].filter(Boolean).join(" "),
        autocomplete: (a.autocomplete ?? "").toLowerCase(), form, visible: false, disabled: "disabled" in a || "readonly" in a,
        maxLength: /^\d+$/.test(a.maxlength ?? "") ? Number(a.maxlength) : -1, inputMode: a.inputmode } })
    }
    for (const c of [...(n.shadowRoots ?? []), ...(n.children ?? []), ...(n.contentDocument ? [n.contentDocument] : [])]) walk(c, frame, name === "#DOCUMENT" ? 0 : form)
  }
  walk(root, p.wc.getURL(), 0)
  // (shown: it has a box on the page, and a person could type in it, as the accessibility tree says (not hidden from
  // it, inert or unfocusable); others are decoys, or another step's: a username-first page's password field)
  await Promise.all(out.map(async (f) => {
    if (f.input.type === "hidden") return
    const box = await cdp<{ model: { width: number; height: number } }>(p.wc, "DOM.getBoxModel", { backendNodeId: f.input.id }).catch(() => null)
    if (!box || box.model.width <= 0 || box.model.height <= 0) return
    const ax = await cdp<{ nodes: AxNode[] }>(p.wc, "Accessibility.getPartialAXTree", { backendNodeId: f.input.id, fetchRelatives: false }).catch(() => null)
    const node = ax?.nodes[0]
    f.input.visible = !!node && !node.ignored && axProp(node, "focusable") === true
  }))
  return out
}

/** Focus a field, and say whether it has the focus now (a page may move it elsewhere as it gets it). */
async function focus(p: EnginePage, id: number) {
  await cdp(p.wc, "DOM.scrollIntoViewIfNeeded", { backendNodeId: id }).catch(() => {})
  await cdp(p.wc, "DOM.focus", { backendNodeId: id })
  const { nodes } = await cdp<{ nodes: AxNode[] }>(p.wc, "Accessibility.getPartialAXTree", { backendNodeId: id, fetchRelatives: false })
  return axProp(nodes[0], "focused")
}

/** The passwords the app filled in each page lately, as hashes: its sign-in then offers no save (passwordfill.ts). */
const LATELY_MS = 10 * 60_000
const lately = new WeakMap<WebContents, { at: number; sums: Set<string> }>()
const sum = (s: string) => crypto.createHash("sha256").update(s).digest("base64")
/** Whether the app filled `password` into page `wc` in the last minutes. */
export const filledLately = (wc: WebContents, password: string) => { const m = lately.get(wc); return !!m && Date.now() - m.at < LATELY_MS && m.sums.has(sum(password)) }

/** A login to fill: its name (for errors), the addresses it's for, and its secrets. */
export type Login = { title: string; urls: string[] }
export type FillOpts = { submit?: boolean
  /** Called once it starts typing (an agent's: what it's doing, for its pointer and the pages' list). */
  started?: () => void
  /** What's said when the page has no login form. */
  noForm?: string }

/** Fill the page's login form (a password and the username before it, a username alone, or a one-time code) with `s`,
 *  then press Enter if `submit`. Says which it filled; throws, saying why, when it can't (nothing more is filled then). */
export async function fillLogin(p: EnginePage, e: Login, s: Secrets, o: FillOpts = {}): Promise<string[]> {
  const { matchesSite, totp } = await keepass()
  const url = p.wc.getURL(), doc = docOf(p.wc)
  const fields = await fieldsOf(p)
  const form = loginForm(fields.map((f) => f.input))
  const frameOf = (i: Input) => fields.find((f) => f.input === i)!.frame
  type Put = { input: Input; value: string; what: string }
  let puts: Put[]
  /** What's filled that agents never read, and how long it's worth hiding (a code's good for a minute or two). */
  let secret: { value: string; ms?: number } | null = null
  if (form.kind === "password") {
    puts = [...(form.username && s.username ? [{ input: form.username, value: s.username, what: "username" }] : []),
      { input: form.password, value: s.password, what: "password" }]
    secret = { value: s.password }
  } else if (form.kind === "username") {
    if (!s.username) throw new Error(`the page asks for a username, and ${e.title} has none`)
    puts = [{ input: form.username, value: s.username, what: "username" }]
  } else if (form.kind === "otp") {
    if (s.otp === "steam") throw new Error(`${e.title}'s one-time code is Steam's, which the app can't fill`)
    if (!s.otp) throw new Error(`the page asks for a one-time code, and ${e.title} has none`)
    const code = totp(s.otp)
    puts = form.otp.length > 1 ? form.otp.map((input, i) => ({ input, value: code[i] ?? "", what: "one-time code" }))
      : [{ input: form.otp[0], value: code, what: "one-time code" }]
    secret = { value: code, ms: 10 * 60_000 }
  } else throw new Error(o.noForm ?? "no login form on this page (a username, a password or a one-time code to fill): open its sign-in page")
  // Every field in a document of the entry's own site, a frame's too.
  const away = puts.find((x) => !e.urls.some((u) => matchesSite(u, frameOf(x.input))))
  if (away) throw new Error(`the form is in a frame of ${new URL(frameOf(away.input)).host}, which ${e.title} isn't for`)

  // From here till it's filled: no script of an agent's in the site's pages (checked, then held, with no wait between)
  const sites = new Set([siteOf(url), ...puts.map((x) => siteOf(frameOf(x.input)))])
  const ran = [...sites].map((site) => ranNear(p, site)).find(Boolean)
  if (ran) throw new Error(ran)
  filling.add(p.id)
  const did = new Set<string>()
  try {
    if (secret) {
      keep(secret.value, secret.ms)
      for (const site of sites) markHeld(p, site)
    }
    if (form.kind === "password") {
      const m = lately.get(p.wc)
      lately.set(p.wc, { at: Date.now(), sums: new Set([...(m && Date.now() - m.at < LATELY_MS ? m.sums : []), sum(s.password)]) })
    }
    o.started?.()
    for (const x of puts) {
      if (docOf(p.wc) !== doc || !e.urls.some((u) => matchesSite(u, p.wc.getURL()))) throw new Error("the page changed while the app was filling it: nothing more was filled")
      if (!await focus(p, x.input.id)) throw new Error("the page moved the focus away from its field: nothing more was filled")
      if (x.input.maxLength !== 1) { await press(p, process.platform === "darwin" ? "Meta+a" : "Control+a"); await press(p, "Backspace") }
      if (docOf(p.wc) !== doc) throw new Error("the page changed while the app was filling it: nothing more was filled")
      if (x.what !== "username") markFilled(p, x.input.id)
      await cdp(p.wc, "Input.insertText", { text: x.value })
      did.add(x.what)
    }
    if (o.submit === true) await press(p, "Enter")
  } finally { filling.delete(p.id) }
  return [...did]
}
