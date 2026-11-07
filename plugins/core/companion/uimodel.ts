// One model of a thing on screen, the same in Vaultite's UI (ARIA) and any app's (Accessibility): role, name, state and
// actions; a target resolves to the part that acts, a condition is checked by reading it back. Node-free.

export type Rect = { x: number; y: number; width: number; height: number }
/** ARIA's words, for both sides: button, link, tab, treeitem, checkbox, switch, radio, menuitem, option, textbox,
 *  combobox, slider, heading, region, group, list, row, cell, window, dialog, menu, toolbar, text, img. */
export type Role = string
export type State = {
  expanded?: boolean; selected?: boolean; checked?: boolean | "mixed"; disabled?: boolean; focused?: boolean
  /** A field's, a slider's or a picker's value. */
  value?: string
}
export type Action = "press" | "expand" | "collapse" | "focus" | "select" | "scroll" | "menu"
export type Inside = { role: Role; label: string }
/** A thing on screen: what look lists, act and check resolve, find answers and the overlay draws round. */
export type Thing = {
  /** Its id in a list an agent was given (a1, e12), when it has one. */
  id?: string
  role: Role; label: string; frame: Rect; state: State; actions: Action[]
  /** The labelled things it's in, nearest first (a row in "Files" in "Left sidebar"). */
  inside: Inside[]
  /** In Vaultite's window: its data-ui id. */
  ui?: string
}

/** What an agent names: by role, name, state and what it's in, or by a data-ui id. */
export type Target = { role?: Role; name?: string; state?: State; inside?: string; ui?: string; id?: string }

/** One state to check, once: `expanded "Files"`, `shows "Saved"`, `selected tab "Notes"`, `changed`. */
export type Condition = {
  kind: "expanded" | "selected" | "checked" | "focused" | "disabled" | "exists" | "shows" | "value" | "changed"
  /** `not expanded`, `collapsed`, `gone`, `unchecked`, `enabled`. */
  not?: boolean
  target?: Target
  /** shows: the words; value: what it should be. */
  text?: string
}
/** A check's answer: whether it holds, what was seen (a plain line for the agent), the thing read. */
export type Verdict = { ok: boolean; saw: string; thing?: Thing }

/** Where a check reads from: Vaultite's window (the DOM) or another app's (Accessibility). */
export interface View {
  find(t: Target): Thing | null
  /** Whether the words show (in `within`, else anywhere it can read). */
  shows(text: string, within?: Target): boolean
  /** What's there now, as text to compare: `changed` holds when it differs from the one taken before. */
  snapshot(within?: Target): string
}

// ---------- names, roles, states in words

export const normWords = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()

/** Roles that do something when pressed; the rest hold or show things. */
const ACTIVE = new Set(["button", "link", "tab", "treeitem", "checkbox", "switch", "radio", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "textbox", "searchbox", "combobox", "slider", "spinbutton", "row", "cell", "gridcell", "disclosure"])
export const actionable = (t: Pick<Thing, "role" | "actions" | "state">) => !t.state.disabled && (t.actions.length > 0 || ACTIVE.has(t.role))

/** macOS Accessibility's roles in ARIA's words (AXButton → button), a subrole first when it says more. */
const AX: Record<string, Role> = {
  AXButton: "button", AXLink: "link", AXCheckBox: "checkbox", AXSwitch: "switch", AXToggle: "switch", AXRadioButton: "radio", AXTabButton: "tab",
  AXPopUpButton: "combobox", AXComboBox: "combobox", AXMenuButton: "button", AXDisclosureTriangle: "button", AXMenuItem: "menuitem",
  AXMenuBarItem: "menuitem", AXMenu: "menu", AXMenuBar: "menubar", AXTextField: "textbox", AXSecureTextField: "textbox", AXSearchField: "searchbox",
  AXTextArea: "textbox", AXStaticText: "text", AXHeading: "heading", AXImage: "img", AXSlider: "slider", AXIncrementor: "spinbutton",
  AXRow: "row", AXOutlineRow: "treeitem", AXCell: "cell", AXList: "list", AXOutline: "tree", AXTable: "table", AXTabGroup: "tablist",
  AXToolbar: "toolbar", AXGroup: "group", AXScrollArea: "region", AXSplitGroup: "group", AXWindow: "window", AXSheet: "dialog",
  AXDialog: "dialog", AXStandardWindow: "window", AXWebArea: "document", AXApplication: "application",
}
export function roleOfAx(role: string, subrole = ""): Role {
  return AX[subrole] ?? AX[role] ?? (role.replace(/^AX/, "").toLowerCase() || "group")
}
/** Accessibility's actions in the model's words. */
export function actionsOfAx(names: string[]): Action[] {
  const m: Record<string, Action> = { AXPress: "press", AXShowMenu: "menu", AXIncrement: "scroll", AXDecrement: "scroll", AXPick: "select", AXConfirm: "press", AXRaise: "focus", AXExpand: "expand", AXCollapse: "collapse" }
  return [...new Set(names.flatMap((n) => (m[n] ? [m[n]] : [])))]
}

/** A thing as one line in a list: `a3 button "Files" (folded) in "Left sidebar"`. */
export function thingText(t: Thing, o: { frame?: boolean } = {}) {
  const s = stateWords(t.state)
  return [t.id, t.role, JSON.stringify(t.label), s && `(${s})`, t.inside[0]?.label && `in ${JSON.stringify(t.inside[0].label)}`, t.ui && `ui:${t.ui}`,
    o.frame ? `at ${t.frame.x},${t.frame.y} ${t.frame.width}×${t.frame.height}` : ""].filter(Boolean).join(" ")
}
export function stateWords(s: State) {
  return [s.expanded === true ? "open" : s.expanded === false ? "folded" : "", s.selected ? "selected" : "", s.checked === "mixed" ? "partly checked" : s.checked === true ? "on" : s.checked === false ? "off" : "",
    s.disabled ? "disabled" : "", s.focused ? "focused" : "", s.value ? `value ${JSON.stringify(s.value.slice(0, 60))}` : ""].filter(Boolean).join(", ")
}

// ---------- the language: targets and conditions as text

/** `button "Files"`, `"Files" in "Left sidebar"`, `ui:panel:files:files`, `a3`, or bare words. */
export function parseTarget(text: string): Target | null {
  const s = text.trim()
  if (!s) return null
  if (/^ui:\S+$/.test(s)) return { ui: s.slice(3) }
  if (/^(a|e)\d+$/.test(s)) return { id: s }
  const m = /^(?:([a-z]+)\s+)?"((?:[^"\\]|\\.)*)"(?:\s+in\s+"((?:[^"\\]|\\.)*)")?$/i.exec(s)
  if (m) return { ...(m[1] ? { role: m[1].toLowerCase() } : {}), name: m[2].replace(/\\(.)/g, "$1"), ...(m[3] ? { inside: m[3].replace(/\\(.)/g, "$1") } : {}) }
  return /"/.test(s) ? null : { name: s }
}

const KINDS: Record<string, Pick<Condition, "kind" | "not">> = {
  expanded: { kind: "expanded" }, open: { kind: "expanded" }, collapsed: { kind: "expanded", not: true }, folded: { kind: "expanded", not: true },
  selected: { kind: "selected" }, checked: { kind: "checked" }, on: { kind: "checked" }, unchecked: { kind: "checked", not: true }, off: { kind: "checked", not: true },
  focused: { kind: "focused" }, disabled: { kind: "disabled" }, enabled: { kind: "disabled", not: true }, exists: { kind: "exists" }, gone: { kind: "exists", not: true },
  shows: { kind: "shows" }, value: { kind: "value" }, changed: { kind: "changed" },
}
/** A condition from its words: `[not] <kind> <target>`; `shows "<words>" [in <target>]`; `value <target> is "<text>"`;
 *  `changed [in <target>]`. Throws with what's wrong. */
export function parseCondition(text: string): Condition {
  let s = text.trim(), not = false
  if (/^not\s+/i.test(s)) { not = true; s = s.replace(/^not\s+/i, "") }
  const word = /^[a-z]+/i.exec(s)?.[0]?.toLowerCase() ?? "", k = KINDS[word]
  if (!k) throw new Error(`no condition "${word || s}": ${Object.keys(KINDS).join(", ")}`)
  const rest = s.slice(word.length).trim(), c: Condition = { kind: k.kind, ...((k.not ?? false) !== not ? { not: true } : {}) }
  const target = (t: string) => { const x = parseTarget(t); if (!x) throw new Error(`can't read the target ${JSON.stringify(t)}: role "name" [in "container"]`); return x }
  if (c.kind === "changed") return rest ? { ...c, target: target(rest.replace(/^in\s+/i, "")) } : c
  if (c.kind === "shows") {
    const m = /^"((?:[^"\\]|\\.)*)"(?:\s+in\s+(.+))?$/.exec(rest)
    if (!m) throw new Error(`shows takes the words in quotes: shows "Saved"`)
    return { ...c, text: m[1].replace(/\\(.)/g, "$1"), ...(m[2] ? { target: target(m[2]) } : {}) }
  }
  if (c.kind === "value") {
    const m = /^(.+?)\s+(?:is|=)\s+"((?:[^"\\]|\\.)*)"$/.exec(rest)
    if (!m) throw new Error(`value takes a target and what it should be: value textbox "Title" is "Lighthouse"`)
    return { ...c, target: target(m[1]), text: m[2].replace(/\\(.)/g, "$1") }
  }
  if (!rest) throw new Error(`${word} needs what to check: ${word} "Files"`)
  return { ...c, target: target(rest) }
}
export function conditionText(c: Condition) {
  const t = c.target ? targetText(c.target) : ""
  const body = c.kind === "shows" ? `shows ${JSON.stringify(c.text ?? "")}${t ? ` in ${t}` : ""}` : c.kind === "value" ? `value ${t} is ${JSON.stringify(c.text ?? "")}` : c.kind === "changed" ? `changed${t ? ` in ${t}` : ""}` : `${c.kind} ${t}`
  return `${c.not ? "not " : ""}${body}`
}
export const targetText = (t: Target) => t.ui ? `ui:${t.ui}` : t.id ? t.id : `${t.role ? `${t.role} ` : ""}${JSON.stringify(t.name ?? "")}${t.inside ? ` in ${JSON.stringify(t.inside)}` : ""}`

/** Check `c` once against `view`; `before` is the snapshot taken before the step, for `changed`. */
export function check(c: Condition, view: View, before?: string): Verdict {
  const flip = (ok: boolean, saw: string, thing?: Thing): Verdict => ({ ok: c.not ? !ok : ok, saw, ...(thing ? { thing } : {}) })
  if (c.kind === "shows") { const ok = view.shows(c.text ?? "", c.target); return flip(ok, ok ? `${JSON.stringify(c.text)} shows` : `no ${JSON.stringify(c.text)} on screen`) }
  if (c.kind === "changed") {
    if (before === undefined) return { ok: false, saw: "nothing to compare with: changed is checked after a step" }
    const ok = view.snapshot(c.target) !== before
    return flip(ok, ok ? "it changed" : "nothing changed")
  }
  const t = c.target ? view.find(c.target) : null
  const name = c.target ? targetText(c.target) : "it"
  if (!t) return flip(false, `no ${name} on screen`)
  const s = t.state, label = JSON.stringify(t.label || name)
  switch (c.kind) {
    case "exists": return flip(true, `${label} is there`, t)
    case "expanded": return s.expanded === undefined ? { ok: false, saw: `${label} doesn't open or fold`, thing: t } : flip(s.expanded, `${label} is ${s.expanded ? "open" : "folded"}`, t)
    case "selected": return flip(!!s.selected, `${label} is ${s.selected ? "" : "not "}selected`, t)
    case "checked": return s.checked === undefined ? { ok: false, saw: `${label} isn't a switch or a box to check`, thing: t } : flip(s.checked === true, `${label} is ${s.checked === true ? "on" : s.checked === "mixed" ? "partly on" : "off"}`, t)
    case "focused": return flip(!!s.focused, `${label} is ${s.focused ? "" : "not "}focused`, t)
    case "disabled": return flip(!!s.disabled, `${label} is ${s.disabled ? "disabled" : "enabled"}`, t)
    case "value": return flip(normWords(s.value ?? "") === normWords(c.text ?? ""), `${label} says ${JSON.stringify(s.value ?? "")}`, t)
  }
}

// ---------- resolving a target to the part that acts

/** A tree of things on screen, whatever draws it (the DOM, an app's Accessibility tree). */
export interface Tree<E> {
  parent(e: E): E | null
  children(e: E): E[]
  /** The thing `e` is, or null when it isn't shown (hidden, off screen, zero size). */
  thing(e: E): Thing | null
  /** What `e` labels or controls (a label's field, a heading's region): followed when `e` itself doesn't act. */
  related?(e: E): E[]
}

/** How well `t` fits the name `want` (normalized): 3 the whole name, 2 its start, 1 inside it, 0 not. */
export function nameFit(label: string, want: string) {
  const l = normWords(label)
  if (!want) return 1
  if (!l) return 0
  if (l === want) return 3
  if (l.startsWith(`${want} `) || l.endsWith(` ${want}`)) return 2
  return ` ${l} `.includes(` ${want} `) ? 1 : 0
}
const fitsState = (s: State, want?: State) => !want || Object.entries(want).every(([k, v]) => v === undefined || (s as Record<string, unknown>)[k] === v)

/** Every shown element of `tree` under `root` fitting `t` (its name, role, state, container), best first. */
export function candidates<E>(tree: Tree<E>, root: E, t: Target): { e: E; thing: Thing; fit: number }[] {
  const want = normWords(t.name ?? ""), inside = normWords(t.inside ?? ""), out: { e: E; thing: Thing; fit: number }[] = []
  const walk = (e: E, depth: number) => {
    if (depth > 60) return
    const th = tree.thing(e)
    if (!th) return
    const fit = t.ui ? (th.ui === t.ui ? 3 : 0) : t.id ? (th.id === t.id ? 3 : 0) : nameFit(th.label, want)
    if (fit && (!t.role || roleFits(th.role, t.role)) && fitsState(th.state, t.state) && (!inside || th.inside.some((i) => nameFit(i.label, inside) > 0))) out.push({ e, thing: th, fit })
    for (const c of tree.children(e)) walk(c, depth + 1)
  }
  walk(root, 0)
  // (the whole name first; then what acts; then the innermost: a row's own button before the list saying the same)
  const real = (x: Thing) => Number(x.role !== "generic" && x.role !== "text")
  return out.sort((a, b) => b.fit - a.fit || Number(actionable(b.thing)) - Number(actionable(a.thing)) || real(b.thing) - real(a.thing) || b.thing.inside.length - a.thing.inside.length)
}
/** A role asked for fits its kin: a button asked for may be a disclosure, a link or a menu item; a row a tree item. */
function roleFits(role: Role, want: Role) {
  if (role === want) return true
  const kin: Record<string, string[]> = { button: ["link", "menuitem", "disclosure", "tab", "switch", "checkbox"], row: ["treeitem", "option", "listitem"], item: ["treeitem", "option", "listitem", "row", "menuitem"], field: ["textbox", "searchbox", "combobox"], textbox: ["searchbox", "combobox"], panel: ["region", "group"], section: ["region", "group"] }
  return kin[want]?.includes(role) ?? false
}

/** The part of `e` that acts on it: itself when it acts; for a container, its control of the same name (a section's
 *  disclosure heading, a label's field), else the one that opens or folds it; for words inside a control, that control. */
export function actingPart<E>(tree: Tree<E>, e: E, want?: Action): E {
  const th = tree.thing(e)
  if (th && actionable(th) && (!wantsFold(want) || th.state.expanded !== undefined)) return e
  const name = normWords(th?.label ?? "")
  for (const r of tree.related?.(e) ?? []) { const x = tree.thing(r); if (x && actionable(x)) return r }
  // (a container: the control inside it naming it, an expandable one first: the panel's heading, not its rows)
  const inner: { e: E; t: Thing; d: number }[] = []
  const walk = (x: E, d: number) => {
    if (d > 6) return
    for (const c of tree.children(x)) {
      const t = tree.thing(c)
      if (!t) continue
      if (actionable(t)) inner.push({ e: c, t, d })
      else walk(c, d + 1)
    }
  }
  walk(e, 0)
  const pick = inner.sort((a, b) => score(b) - score(a) || a.d - b.d)[0]
  function score(x: { t: Thing; d: number }) { return (x.t.state.expanded !== undefined ? 4 : 0) + (name && nameFit(x.t.label, name) ? 2 : 0) + (x.t.role === "heading" || x.t.role === "button" ? 1 : 0) }
  if (pick && (score(pick) >= 2 || inner.length === 1)) return pick.e
  // (words inside a control: that control)
  for (let p = tree.parent(e), n = 0; p && n < 8; p = tree.parent(p), n++) { const t = tree.thing(p); if (t && actionable(t)) return p }
  return e
}
const wantsFold = (a?: Action) => a === "expand" || a === "collapse"

/** `t` resolved in `tree` under `root`: the thing that acts on it, and the thing named (they differ for a container). */
export function resolve<E>(tree: Tree<E>, root: E, t: Target, want?: Action): { e: E; thing: Thing; named: Thing } | null {
  const c = candidates(tree, root, t)[0]
  if (!c) return null
  const e = actingPart(tree, c.e, want), thing = tree.thing(e) ?? c.thing
  return { e, thing, named: c.thing }
}

/** Whether a step did what it meant, from the target's state before and after: what to tell the agent when it didn't. */
export function stepEffect(action: Action | "click", before: Thing | null, after: Thing | null, changed: boolean): { ok: boolean; saw: string } {
  const label = JSON.stringify(after?.label || before?.label || "it")
  if (!after) return before ? { ok: true, saw: `${label} went away` } : { ok: changed, saw: changed ? "it changed" : "nothing changed" }
  const b = before?.state ?? {}, a = after.state
  if (action === "expand" || action === "collapse" || (b.expanded !== undefined && a.expanded !== undefined)) {
    const want = action === "expand" ? true : action === "collapse" ? false : !b.expanded
    return a.expanded === want ? { ok: true, saw: `${label} is ${want ? "open" : "folded"} now` } : { ok: false, saw: `${label} is still ${a.expanded ? "open" : "folded"}` }
  }
  if (b.checked !== undefined && a.checked !== undefined) return a.checked !== b.checked ? { ok: true, saw: `${label} is ${a.checked === true ? "on" : "off"} now` } : { ok: false, saw: `${label} is still ${a.checked === true ? "on" : "off"}` }
  if (action === "select" || (after.role === "tab" && a.selected !== undefined)) return a.selected ? { ok: true, saw: `${label} is selected` } : { ok: false, saw: `${label} isn't selected` }
  return { ok: changed, saw: changed ? "it changed" : "nothing changed" }
}

// ---------- the shape on the wire: what the Mac's helper and the app's page send, read back into things

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "")
/** A state as sent, only its known keys. */
export function stateFrom(v: unknown): State {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>, s: State = {}
  for (const k of ["expanded", "selected", "disabled", "focused"] as const) if (typeof o[k] === "boolean") s[k] = o[k] as boolean
  if (typeof o.checked === "boolean" || o.checked === "mixed") s.checked = o.checked as boolean | "mixed"
  if (typeof o.value === "string") s.value = o.value.slice(0, 200)
  return s
}
const ACTIONS = new Set<Action>(["press", "expand", "collapse", "focus", "select", "scroll", "menu"])
/** An element as the Mac's helper (screen.swift near()) or the app's page lists it, in the model's shape: Accessibility's
 *  roles and actions in ARIA's words, `ax` kept (the helper finds it again by it). Null when it has no frame or words. */
export function thingFrom(v: unknown): (Thing & { ax?: string }) | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>, f = (o.frame ?? {}) as Record<string, unknown>
  const r = [f.x, f.y, f.width, f.height].map(Number), label = clip(o.label, 120)
  if (!label || r.some((n) => !Number.isFinite(n))) return null
  const ax = clip(o.ax, 40), acts = Array.isArray(o.actions) ? o.actions.map(String) : []
  const inside = Array.isArray(o.inside) ? o.inside.slice(0, 4).flatMap((i: Record<string, unknown>) => (i && clip(i.label, 120) ? [{ role: i.ax ? roleOfAx(clip(i.ax, 40)) : clip(i.role, 40) || "group", label: clip(i.label, 120) }] : [])) : []
  return { role: ax ? roleOfAx(ax, clip(o.sub, 40)) : clip(o.role, 40) || "group", label, frame: { x: Math.round(r[0]), y: Math.round(r[1]), width: Math.round(r[2]), height: Math.round(r[3]) },
    state: stateFrom(o.state), actions: ax ? actionsOfAx(acts) : acts.filter((a): a is Action => ACTIONS.has(a as Action)), inside,
    ...(clip(o.ui, 200) ? { ui: clip(o.ui, 200) } : {}), ...(ax ? { ax } : {}), ...(clip(o.id, 8) ? { id: clip(o.id, 8) } : {}) }
}

/** A list of things (an app's, as its helper sent them) as a View: found by role, name, state and what they're in. */
export function listView(things: Thing[]): View {
  const top: Thing = { role: "window", label: "", frame: { x: 0, y: 0, width: 0, height: 0 }, state: {}, actions: [], inside: [] }
  const tree: Tree<Thing> = { parent: (e) => (e === top ? null : top), children: (e) => (e === top ? things : []), thing: (e) => e }
  const within = (t?: Target) => (t ? things.filter((x) => x.inside.some((i) => nameFit(i.label, normWords(t.name ?? "")) > 0)) : things)
  return {
    find: (t) => resolve(tree, top, t)?.thing ?? null,
    shows: (text, w) => within(w).some((x) => nameFit(x.label, normWords(text)) > 0 || normWords(x.state.value ?? "").includes(normWords(text))),
    snapshot: (w) => within(w).map((x) => thingText(x)).join("\n"),
  }
}
