// Runs in the page, sent as source (pagetree.ts): pageAX holds everything it uses. Its roles and names are Chromium's.
import type { AXNode, LineKit, Refs } from "./axlines.ts"

export type Prop = { name: string; value: { value: string | boolean } }
export type PageAX = { roleOf(el: Element): string; nameOf(el: Element, role: string): string; propsOf(el: Element, role: string): { value: string; properties: Prop[] }
  nodes(doc: Document, idOf: (el: Element) => number): AXNode[] }

// oxlint-disable-next-line max-lines-per-function -- the page's code is this function's source, so it can't call out
export function pageAX(): PageAX {
  const isEl = (n: Node | null | undefined): n is Element => n?.nodeType === 1
  const isTag = <K extends keyof HTMLElementTagNameMap>(e: Element | null | undefined, tag: K): e is HTMLElementTagNameMap[K] => e?.localName === tag
  const isHtml = (e: Element): e is HTMLElement => "isContentEditable" in e
  const isShadow = (n: Node): n is ShadowRoot => n.nodeType === 11 && "host" in n
  const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim()
  const up = (e: Element) => { const root = e.getRootNode(); return e.parentElement ?? (isShadow(root) ? root.host : null) }
  const editableRoot = (e: Element) => isHtml(e) && e.isContentEditable && !(e.parentElement && isHtml(e.parentElement) && e.parentElement.isContentEditable)

  const ARIA = new Set(("alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary contentinfo definition " +
    "deletion dialog document emphasis feed figure form generic grid gridcell group heading img insertion link list listbox listitem log main marquee math menu menubar " +
    "menuitem menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader search " +
    "searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem").split(" "))
  const TAGS = new Map(Object.entries({ abbr: "Abbr", address: "group", article: "article", aside: "complementary", audio: "Audio", blockquote: "blockquote", br: "LineBreak",
    button: "button", canvas: "Canvas", caption: "caption", code: "code", datalist: "listbox", dd: "definition", del: "deletion", details: "group", dfn: "term", dialog: "dialog",
    dl: "list", dt: "term", em: "emphasis", fieldset: "group", figcaption: "Figcaption", figure: "figure", h1: "heading", h2: "heading", h3: "heading", h4: "heading",
    h5: "heading", h6: "heading", hr: "separator", iframe: "Iframe", ins: "insertion", label: "LabelText", legend: "Legend", li: "listitem", main: "main", mark: "mark",
    math: "math", menu: "list", meter: "meter", nav: "navigation", ol: "list", optgroup: "group", option: "option", output: "status", p: "paragraph", pre: "Pre",
    progress: "progressbar", s: "deletion", search: "search", strong: "strong", sub: "subscript", summary: "DisclosureTriangle", sup: "superscript", textarea: "textbox",
    time: "time", ul: "list", video: "Video" }))
  const INPUTS = new Map(Object.entries({ button: "button", checkbox: "checkbox", color: "ColorWell", date: "date", "datetime-local": "DateTime", file: "button", image: "button",
    month: "DateTime", number: "spinbutton", radio: "radio", range: "slider", reset: "button", search: "searchbox", submit: "button", time: "InputTime", week: "DateTime" }))
  const FROM_CONTENT = new Set(["button", "cell", "checkbox", "columnheader", "gridcell", "heading", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio",
    "rowheader", "switch", "tab", "tooltip", "treeitem", "DisclosureTriangle", "term"])
  const NAMELESS = new Set(["generic", "none", "paragraph", "Pre", "strong", "emphasis", "code", "deletion", "insertion", "subscript", "superscript", "mark", "time", "LineBreak",
    "definition", "list", "listitem", "rowgroup"])

  const authored = (el: Element) => !!(flat(el.getAttribute("aria-label")) || el.getAttribute("aria-labelledby") || flat(el.getAttribute("title")))
  const ROWS = ":scope > tr, :scope > tbody > tr, :scope > thead > tr, :scope > tfoot > tr", tables = new WeakMap<Element, { at: number; data: boolean }>()
  let snapshot = 0
  const isData = (t: Element) => t.hasAttribute("role") || t.hasAttribute("summary") ||
    !!t.querySelector(":scope > caption, :scope > thead, :scope > tfoot, th, [headers], [scope]") || (!t.querySelector("table") && t.querySelectorAll(ROWS).length >= 20)
  const dataTable = (t: Element | null) => {
    if (!t) return false
    const had = tables.get(t)
    if (had?.at === snapshot) return had.data
    const data = isData(t)
    tables.set(t, { at: snapshot, data })
    return data
  }
  const inSection = (el: Element) => { for (let e = up(el); e; e = up(e)) if (/^(article|aside|main|nav|section)$/.test(e.localName)) return true; return false }
  const landmark = (el: Element, tag: string) => {
    if (tag === "header") return inSection(el) ? "sectionheader" : "banner"
    if (tag === "footer") return inSection(el) ? "sectionfooter" : "contentinfo"
    if (tag === "section") return authored(el) ? "region" : "generic"
    return tag === "form" ? "form" : null
  }
  const tablePart = (el: Element, tag: string) => {
    if (tag === "table") return dataTable(el) ? "table" : "LayoutTable"
    if (tag !== "tr" && tag !== "td" && tag !== "th") return null
    if (!dataTable(el.closest("table"))) return tag === "tr" ? "LayoutTableRow" : "LayoutTableCell"
    return tag === "tr" ? "row" : tag === "td" ? "cell" : el.getAttribute("scope") === "row" ? "rowheader" : "columnheader"
  }
  const field = (el: Element, tag: string) => {
    if (tag === "input") return INPUTS.get((el.getAttribute("type") ?? "text").toLowerCase()) ?? (el.hasAttribute("list") ? "combobox" : "textbox")
    if (tag === "select") return el.hasAttribute("multiple") || Number(el.getAttribute("size")) > 1 ? "listbox" : "combobox"
    return editableRoot(el) ? "textbox" : null
  }
  const media = (el: Element, tag: string) => {
    if (tag === "a" || tag === "area") return el.hasAttribute("href") ? "link" : "generic"
    if (tag === "img") return el.getAttribute("alt") === "" && !authored(el) ? "none" : "image"
    if (tag === "svg") return authored(el) || el.querySelector(":scope > title") ? "image" : "none"
    return null
  }
  const roleOf = (el: Element) => {
    const explicit = (el.getAttribute("role") ?? "").trim().split(/\s+/).find((r) => ARIA.has(r)), tag = el.localName
    if (explicit) return new Map([["img", "image"], ["presentation", "none"]]).get(explicit) ?? explicit
    return landmark(el, tag) ?? tablePart(el, tag) ?? field(el, tag) ?? media(el, tag) ?? TAGS.get(tag) ?? "generic"
  }

  const hidden = (e: Element) => e.getAttribute("aria-hidden") === "true" || /^(script|style|noscript|template)$/.test(e.localName) ||
    (!e.checkVisibility({ visibilityProperty: true }) && getComputedStyle(e).display !== "contents")
  const kids = (n: Node): Node[] => {
    if (isEl(n) && isTag(n, "slot")) { const got = n.assignedNodes({ flatten: true }); return got.length ? got : [...n.childNodes] }
    if (isEl(n) && isTag(n, "iframe")) { try { return n.contentDocument?.body ? [n.contentDocument.body] : [] } catch { return [] } }
    return [...((isEl(n) ? n.shadowRoot : null) ?? n).childNodes]
  }
  const pseudoText = (e: Element, at: string) => { const c = getComputedStyle(e, at); return c.visibility !== "hidden" && c.display !== "none" && /^".*"$/.test(c.content) ? c.content.slice(1, -1) : "" }
  const embedded = (e: Element) => {
    if (isTag(e, "select")) return [...e.options].find((o) => o.selected)?.textContent ?? ""
    if ((isTag(e, "input") || isTag(e, "textarea")) && /^(textbox|searchbox|spinbutton|slider|combobox)$/.test(roleOf(e))) return e.value
    return null
  }
  const said = (e: Element, depth: number) => {
    const label = flat(e.getAttribute("aria-label")), inside = depth > 0 ? embedded(e) : null
    if (depth > 0 && (label || inside !== null)) return label || inside
    if (isTag(e, "img") || isTag(e, "area")) return e.getAttribute("alt") ?? ""
    return e.localName === "svg" ? e.querySelector(":scope > title")?.textContent ?? "" : null
  }
  const content = (n: Node, depth: number, size: { n: number }, shown: boolean): string => {
    if (size.n > 1000) return ""
    if (n.nodeType === 3) { size.n += (n.textContent ?? "").length; return n.textContent ?? "" }
    if (!isEl(n) || (depth > 0 && !shown && hidden(n))) return ""
    const own = said(n, depth)
    if (own !== null) return ` ${own} `
    const inner = pseudoText(n, "::before") + kids(n).map((c) => content(c, depth + 1, size, shown)).join("") + pseudoText(n, "::after")
    const text = isTag(n, "br") ? " " : /\S/.test(inner) ? inner : flat(n.getAttribute("title")) || inner
    return getComputedStyle(n).display === "inline" ? text : ` ${text} `
  }
  const textOf = (e: Element, shown = false) => flat(content(e, 0, { n: 0 }, shown))
  const labelled = (el: Element) => {
    const ids = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean)
    const by = ids.map((id) => el.ownerDocument.getElementById(id)).map((e) => (e ? flat(e.getAttribute("aria-label")) || textOf(e, hidden(e)) : "")).join(" ")
    return flat(by) || flat(el.getAttribute("aria-label"))
  }
  const fieldName = (el: Element) => {
    const labels = isTag(el, "input") || isTag(el, "select") || isTag(el, "textarea") || isTag(el, "meter") || isTag(el, "progress") || isTag(el, "output") ? [...(el.labels ?? [])] : []
    const said = labels.map((l) => flat([...l.childNodes].flatMap((c) => (c === el ? [] : [content(c, 1, { n: 0 }, false)])).join(""))).join(" ")
    return flat(said) || flat(el.getAttribute("title")) || flat(el.getAttribute("placeholder"))
  }
  const buttonName = (el: Element, type: string) => {
    const value = flat(el.getAttribute("value"))
    if (type === "image") return flat(el.getAttribute("alt")) || value || "Submit"
    return value || new Map([["submit", "Submit"], ["reset", "Reset"]]).get(type) || ""
  }
  const nativeName = (el: Element) => {
    const tag = el.localName, type = (el.getAttribute("type") ?? "").toLowerCase()
    if (tag === "input" && /^(submit|reset|button|image)$/.test(type)) return buttonName(el, type)
    if (/^(input|select|textarea|meter|progress|output)$/.test(tag)) return fieldName(el)
    if (tag === "img" || tag === "area") return flat(el.getAttribute("alt"))
    const child = new Map(Object.entries({ fieldset: "legend", table: "caption", svg: "title" })).get(tag)
    return child ? flat(el.querySelector(`:scope > ${child}`)?.textContent) : ""
  }
  const nameOf = (el: Element, role: string) => labelled(el) || nativeName(el) || (FROM_CONTENT.has(role) ? textOf(el) : "") || flat(el.getAttribute("title"))

  const checked = (el: Element, put: (name: string, value: string | boolean) => void) => {
    const type = (el.getAttribute("type") ?? "").toLowerCase()
    if (isTag(el, "input") && (type === "checkbox" || type === "radio")) put("checked", el.indeterminate ? "mixed" : el.checked)
    else if (el.getAttribute("aria-checked")) put("checked", el.getAttribute("aria-checked") ?? "")
  }
  const states = (el: Element, put: (name: string, value: string | boolean) => void) => {
    const a = (n: string) => el.getAttribute(n) ?? ""
    checked(el, put)
    for (const k of ["pressed", "expanded", "selected"]) if (/^(true|mixed)$/.test(a(`aria-${k}`))) put(k, a(`aria-${k}`))
    if (isTag(el, "summary") && isTag(el.parentElement, "details") && el.parentElement.open) put("expanded", true)
    if (isTag(el, "option") && el.selected) put("selected", true)
    if (el.matches(":disabled") || a("aria-disabled") === "true") put("disabled", true)
    if ((isHtml(el) && (el.tabIndex >= 0 || el.isContentEditable)) || el.hasAttribute("tabindex")) put("focusable", true)
  }
  const valueOf = (el: Element, role: string) => {
    const type = (el.getAttribute("type") ?? "").toLowerCase()
    if (isTag(el, "select")) return [...el.options].find((o) => o.selected)?.textContent ?? ""
    if (isTag(el, "input") || isTag(el, "textarea")) return type === "password" ? "•".repeat(el.value.length) : /^(checkbox|radio|submit|reset|button|image|file|hidden)$/.test(type) ? "" : el.value
    if (/^(textbox|searchbox|combobox)$/.test(role) && isHtml(el) && el.isContentEditable) return el.innerText
    if (/^(slider|spinbutton|progressbar|meter|scrollbar)$/.test(role)) return el.getAttribute("aria-valuetext") ?? el.getAttribute("aria-valuenow") ?? ""
    return ""
  }
  const propsOf = (el: Element, role: string) => {
    const properties: Prop[] = []
    states(el, (name, value) => { properties.push({ name, value: { value } }) })
    if (role === "link") properties.push({ name: "url", value: { value: isTag(el, "a") || isTag(el, "area") ? el.href : "" } })
    return { value: valueOf(el, role), properties }
  }

  const ROMAN = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]] as const
  const roman = (n: number) => { let out = "", left = n; for (const [v, r] of ROMAN) while (left >= v) { out += r; left -= v } return out }
  const alpha = (k: number): string => (k > 26 ? alpha(Math.floor((k - 1) / 26)) : "") + String.fromCharCode(97 + ((k - 1) % 26))
  const ordinal = (n: number, type: string) => new Map(Object.entries({ disc: "•", circle: "◦", square: "▪", decimal: `${n}.`, "lower-alpha": `${alpha(n)}.`, "lower-latin": `${alpha(n)}.`,
    "upper-alpha": `${alpha(n).toUpperCase()}.`, "upper-latin": `${alpha(n).toUpperCase()}.`, "lower-roman": `${roman(n)}.`, "upper-roman": `${roman(n).toUpperCase()}.` })).get(type)
  const markerOf = (li: Element) => {
    const style = getComputedStyle(li), list = li.parentElement
    if (style.display !== "list-item" || style.listStyleType === "none" || !list) return null
    const at = [...list.children].filter((c) => c.localName === "li").indexOf(li)
    const n = isTag(list, "ol") ? (list.reversed ? (list.start || list.children.length) - at : (list.start || 1) + at) : 0
    return ordinal(n, style.listStyleType) ?? null
  }

  const LEAF = /^(input|textarea|img|svg|canvas|video|audio|object|embed|math)$/, OUT = /^(script|style|noscript|template|head|title|meta|link|base)$/
  const nodes = (doc: Document, idOf: (el: Element) => number) => {
    const out: AXNode[] = [], top: string[] = []
    let n = 0
    snapshot++
    const text = (into: string[], value: string, id = `t${++n}`, role = "StaticText") => { out.push({ nodeId: id, role: { value: role }, name: { value } }); into.push(id) }
    const pseudo = (el: Element, at: string, into: string[]) => { const t = pseudoText(el, at); if (/\S/.test(t)) text(into, t) }
    const named = (el: Element, role: string) => (!NAMELESS.has(role) || (role !== "generic" && authored(el)) ? nameOf(el, role) : "")
    const node = (el: Element, role: string, visible: boolean): AXNode => {
      const id = idOf(el), made: AXNode = { nodeId: String(id), backendDOMNodeId: id, role: { value: role }, childIds: [], ignored: !visible }
      if (!visible || role === "none") return made
      const { value, properties } = propsOf(el, role)
      return { ...made, name: { value: named(el, role) }, value: { value }, properties }
    }
    const under = (el: Element, into: string[], visible: boolean) => {
      const marker = visible && el.localName === "li" ? markerOf(el) : null
      if (marker) text(into, marker, `m${idOf(el)}`, "ListMarker")
      if (isTag(el, "select")) for (const o of el.options) { const x = node(o, "option", true); out.push(x); into.push(x.nodeId) }
      else if (isTag(el, "img") && el.useMap) for (const area of doc.querySelectorAll(`map[name="${CSS.escape(el.useMap.slice(1))}"] area[href]`)) element(area, into, visible)
      else if (!LEAF.test(el.localName)) {
        if (visible) pseudo(el, "::before", into)
        for (const c of kids(el)) visit(c, into, visible)
        if (visible) pseudo(el, "::after", into)
      }
    }
    const element = (el: Element, into: string[], shown: boolean) => {
      if (OUT.test(el.localName) || el.getAttribute("aria-hidden") === "true" || el.hasAttribute("inert")) return
      const drawn = el.checkVisibility(), contents = !drawn && getComputedStyle(el).display === "contents"
      if (!drawn && !contents) return
      const visible = shown && (contents || el.checkVisibility({ visibilityProperty: true })), x = node(el, visible ? roleOf(el) : "none", visible)
      out.push(x)
      into.push(x.nodeId)
      under(el, x.childIds ?? [], visible)
    }
    const visit = (c: Node, into: string[], shown: boolean) => {
      if (++n > 300_000) return
      if (isEl(c)) return element(c, into, shown)
      if (shown && c.nodeType === 3 && /\S/.test(c.textContent ?? "")) text(into, c.textContent ?? "")
    }
    out.push({ nodeId: "root", role: { value: "RootWebArea" }, name: { value: doc.title }, childIds: top })
    if (doc.body) for (const k of kids(doc.body)) visit(k, top, true)
    return out
  }
  return { roleOf, nameOf, propsOf, nodes }
}

export type Now = null | { gone: true } | { gone: false; role: string; name: string; was?: { role: string; name: string } }
export type AgentWorld = { lines(base: string): string; el(ref: string): Element | null; now(ref: string): Now; secret(el: Element): void }
type Lines = (nodes: AXNode[], r: Refs, filled: (id: number) => boolean, scrub: (s: string) => string, base: string, kit: LineKit) => string[]

export function agentWorld(ax: PageAX, axLines: Lines, kit: { short: LineKit["short"]; interactive: string[] }): AgentWorld {
  const ids = new WeakMap<Element, number>(), els = new Map<number, WeakRef<Element>>(), secrets = new WeakSet<Element>()
  const refs: Refs = { byRef: new Map(), byNode: new Map(), n: 0, what: new Map() }, lineKit = { short: kit.short, interactive: new Set(kit.interactive) }
  let next = 0
  const idOf = (el: Element) => {
    const had = ids.get(el)
    if (had) return had
    ids.set(el, ++next)
    els.set(next, new WeakRef(el))
    return next
  }
  const elOf = (id: number | undefined) => { const el = id ? els.get(id)?.deref() : undefined; return el?.isConnected ? el : null }
  const filled = (id: number) => { const el = elOf(id); return !!el && secrets.has(el) }
  return {
    lines: (base) => axLines(ax.nodes(document, idOf), refs, filled, (s) => s, base, lineKit).join("\n"),
    el: (ref) => elOf(refs.byRef.get(ref)),
    now: (ref) => {
      if (!refs.byRef.has(ref)) return null
      const el = elOf(refs.byRef.get(ref)), role = el ? ax.roleOf(el) : ""
      return el ? { gone: false, role, name: ax.nameOf(el, role).slice(0, 200), was: refs.what.get(ref) } : { gone: true }
    },
    secret: (el) => { secrets.add(el) },
  }
}
