import { actionable, check, resolve, type Action, type Condition, type Inside, type Role, type State, type Target, type Thing, type Tree, type Verdict, type View } from "../../../core/desktop/uimodel.ts"

export const DRAWN = ".companion-overlay, [data-companion-bubble], .companion-cursor"
export const OWN = `${DRAWN}, [data-companion-own], [data-ask-line]`
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "svg", "PATH", "path"])
const INPUT: Record<string, Role> = { checkbox: "checkbox", radio: "radio", range: "slider", search: "searchbox", button: "button", submit: "button", reset: "button", number: "spinbutton" }
const BY_TEXT = new Set(["button", "link", "tab", "treeitem", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "heading", "cell", "gridcell", "row", "text", "switch", "checkbox", "radio", "listitem"])
const HOLDERS = new Set(["region", "group", "dialog", "navigation", "tablist", "menu", "list", "tree", "toolbar", "listbox", "form", "radiogroup", "grid", "table", "complementary", "main", "banner"])

export function roleOf(e: Element): Role {
  const r = e.getAttribute("role")
  if (r && r !== "presentation" && r !== "none") return r.split(" ")[0]
  const tag = e.tagName
  if (tag === "BUTTON" || tag === "SUMMARY") return "button"
  if (tag === "A" && e.hasAttribute("href")) return "link"
  if (e instanceof HTMLInputElement) return INPUT[e.type] ?? "textbox"
  if (tag === "TEXTAREA" || e instanceof HTMLElement && e.isContentEditable && e.getAttribute("contenteditable") !== null) return "textbox"
  if (tag === "SELECT") return "combobox"
  if (/^H[1-6]$/.test(tag)) return "heading"
  if (tag === "LI") return "listitem"
  if (tag === "UL" || tag === "OL") return "list"
  if (tag === "NAV") return "navigation"
  if (tag === "DIALOG") return "dialog"
  if (tag === "IMG") return "img"
  if (tag === "SECTION" && (e.hasAttribute("aria-label") || e.hasAttribute("aria-labelledby"))) return "region"
  if (tag === "LABEL") return "text"
  return e.childElementCount === 0 && (e.textContent ?? "").trim() ? "text" : "generic"
}

const hasDataset = (e: Element): e is HTMLElement | SVGElement | MathMLElement => e instanceof HTMLElement || e instanceof SVGElement || e instanceof MathMLElement
const firstLine = (s: string | null | undefined) => (s ?? "").split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 120) ?? ""
export function nameOf(e: Element, role = roleOf(e)): string {
  const by = e.getAttribute("aria-labelledby")
  if (by) { const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim(); if (t) return t.slice(0, 120) }
  const aria = e.getAttribute("aria-label")
  if (aria?.trim()) return aria.trim().slice(0, 120)
  if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement || e instanceof HTMLSelectElement) {
    const l = e.labels?.[0]?.textContent?.trim()
    if (l) return l.slice(0, 120)
    if ("placeholder" in e && e.placeholder) return e.placeholder
  }
  if (BY_TEXT.has(role)) { const t = firstLine((e instanceof HTMLElement ? e.innerText : undefined) ?? e.textContent); if (t) return t }
  return (e instanceof HTMLElement ? e.title : undefined) || (hasDataset(e) ? e.dataset.tip : undefined) || ""
}

const bool = (v: string | null) => (v === "true" ? true : v === "false" ? false : undefined)
export function stateOf(e: Element): State {
  const s: State = {}
  const ex = bool(e.getAttribute("aria-expanded")); if (ex !== undefined) s.expanded = ex
  const sel = e.getAttribute("aria-selected") ?? (e.getAttribute("aria-current") && e.getAttribute("aria-current") !== "false" ? "true" : null)
  if (sel !== null) s.selected = sel === "true"
  const ch = e.getAttribute("aria-checked") ?? e.getAttribute("aria-pressed")
  if (ch !== null) s.checked = ch === "mixed" ? "mixed" : ch === "true"
  else if (e instanceof HTMLInputElement && (e.type === "checkbox" || e.type === "radio")) s.checked = e.checked
  if (e.getAttribute("aria-disabled") === "true" || ("disabled" in e && e.disabled === true) || e.closest("[inert]")) s.disabled = true
  if (document.activeElement === e) s.focused = true
  if (e instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(e.type)) s.value = e.value
  else if (e instanceof HTMLTextAreaElement) s.value = e.value.slice(0, 500)
  else if (e instanceof HTMLSelectElement) s.value = e.selectedOptions[0]?.textContent?.trim() ?? e.value
  else if (e.getAttribute("aria-valuenow") !== null) s.value = e.getAttribute("aria-valuetext") ?? e.getAttribute("aria-valuenow")!
  return s
}
function actionsOf(e: Element, role: Role, s: State): Action[] {
  const a: Action[] = []
  if (s.expanded !== undefined) a.push(s.expanded ? "collapse" : "expand")
  if (actionable({ role, state: {}, actions: [] })) a.push("press")
  if (["tab", "option", "treeitem", "row", "radio", "gridcell"].includes(role)) a.push("select")
  if ((hasDataset(e) && e.tabIndex >= 0) || role === "textbox") a.push("focus")
  return a
}

function showsAt(e: Element): DOMRect | null {
  if (SKIP.has(e.tagName) || e.getAttribute("aria-hidden") === "true") return null
  if (e.getClientRects().length) return e.checkVisibility({ checkVisibilityCSS: true }) ? e.getBoundingClientRect() : null
  return e.childElementCount && getComputedStyle(e).display === "contents" ? new DOMRect() : null
}

export function domTree(): Tree<Element> & { inside(e: Element): Inside[] } {
  const things = new Map<Element, Thing | null>(), holders = new Map<Element, Inside[]>()
  const inside = (e: Element): Inside[] => {
    const p = e.parentElement
    if (!p || p === document.body) return []
    let got = holders.get(p)
    if (!got) {
      const role = roleOf(p), label = HOLDERS.has(role) ? nameOf(p, role) : ""
      got = label ? [{ role, label }, ...inside(p)] : inside(p)
      holders.set(p, got)
    }
    return got
  }
  const thing = (e: Element): Thing | null => {
    if (things.has(e)) return things.get(e)!
    let t: Thing | null = null
    const r = e.closest(OWN) ? null : showsAt(e)
    if (r) {
      const role = roleOf(e), state = stateOf(e), ui = hasDataset(e) ? e.dataset.ui : undefined
      t = { role, label: nameOf(e, role), frame: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }, state, actions: actionsOf(e, role, state), inside: inside(e), ...(ui ? { ui } : {}) }
    }
    things.set(e, t)
    return t
  }
  return {
    parent: (e) => (e.parentElement && e.parentElement !== document.documentElement ? e.parentElement : null),
    children: (e) => [...e.children],
    thing, inside,
    related: (e) => {
      const out: Element[] = []
      if (e instanceof HTMLLabelElement && e.control) out.push(e.control)
      for (const id of (e.getAttribute("aria-controls") ?? "").split(/\s+/).filter(Boolean)) { const c = document.getElementById(id); if (c) out.push(c) }
      if (e.id) for (const c of document.querySelectorAll(`[aria-controls~="${CSS.escape(e.id)}"]`)) out.push(c)
      if (!actionable({ role: roleOf(e), state: {}, actions: [] }) && e.parentElement) {
        const sib = [...e.parentElement.children].filter((c) => c !== e && actionable({ role: roleOf(c), state: stateOf(c), actions: [] }))
        if (sib.length === 1 && !nameOf(sib[0])) out.push(sib[0])
      }
      return out
    },
  }
}

export function domThings(root: Element = document.body, most = 400): Thing[] {
  const tree = domTree(), out: Thing[] = []
  const walk = (e: Element) => {
    if (out.length >= most) return
    const t = tree.thing(e)
    if (!t) return
    if (t.label && t.role !== "generic") out.push(t)
    for (const c of e.children) walk(c)
  }
  walk(root)
  return out
}

export function uiElement(id: string): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>(`[data-ui="${CSS.escape(id)}"]`)].find((e) => e.getClientRects().length > 0) ?? null
}

export function resolveDom(t: Target, want?: Action, root: Element = document.body) {
  const tree = domTree()
  if (t.ui && !t.name) {
    const el = uiElement(t.ui)
    const th = el && tree.thing(el)
    if (!el || !th) return null
    return { ...resolve(tree, el, { ui: t.ui }, want)!, tree }
  }
  const r = resolve(tree, root, t, want)
  return r ? { ...r, tree } : null
}

export function domView(): View {
  return {
    find: (t) => resolveDom(t)?.thing ?? null,
    shows: (text, within) => {
      const root = within ? resolveDom(within)?.e ?? null : document.body
      return !!root && (root as HTMLElement).innerText.toLowerCase().includes(text.toLowerCase())
    },
    snapshot: (within) => {
      const root = (within ? resolveDom(within)?.e : null) ?? document.querySelector("#root") ?? document.body
      return `${(root as HTMLElement).innerText}\n${[...root.querySelectorAll("[aria-expanded],[aria-selected],[aria-checked],[aria-current]")].map((e) => JSON.stringify(stateOf(e))).join("")}`
    },
  }
}
export const checkDom = (c: Condition, before?: string): Verdict => check(c, domView(), before)
