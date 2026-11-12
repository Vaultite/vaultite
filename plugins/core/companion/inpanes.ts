import { type OpCtx, OpError } from "../../../core/plugins.ts"
import { readText } from "../../../core/vault.ts"
import { paneSource } from "../../../core/desktop/places.ts"
import { doneText, effectOf, stepOf } from "./takeover.ts"
import { check as checkOn, listView, parseCondition, thingFrom, type Verdict } from "../../../core/desktop/uimodel.ts"
import "./propose.ts"
import { plugin } from "./self.ts"
import type { Near } from "./types.ts"
import { str } from "./settings.ts"
import { moments, did, key, agentOf, writingAt } from "./state.ts"
import { takeover, nearBy } from "./windows.ts"
import { paneById, privatePane, paneFocus, pageFor, resolve } from "./windowpanes.ts"
import { cut } from "./edits.ts"
import { AS, PANE, UI, EL, PLACE, target, who } from "./args.ts"
import { awayIn } from "./next.ts"
import { askOf } from "./wiring.ts"

/** A page's tree as the companion is given it, at most this long. */
export const SNAPSHOT = 12_000
plugin.op({
  id: "companion.see",
  cli: "companion see",
  summary: "What a pane of the user's window shows now (a terminal's screen, a web page as its accessibility tree with refs to point at and act on, a note's text), or a part of the app's own UI (a sidebar panel's rows).",
  help: `For an ask or a point about a pane (the look: a snapshot only then, not to keep an eye on it: that's follow). A
private page or note is never shown.

  vau companion see --pane t5x1
  vau companion see --ui panel:files:files`,
  kind: "read",
  lock: false,
  params: { pane: { ...PANE, description: "the pane (its id: vau tabs; default: the one the user is in)" },
    ui: { ...UI, description: "instead of a pane: the app's own UI by its id (panel:files:files, tab:<id>): what it shows now" }, as: AS },
  run: async (p, ctx) => {
    if (str(p.ui)) {
      const ui = str(p.ui), r = await ctx.ui({ action: "companion:read", ui }).catch(() => null) as { found: boolean; label?: string; folded?: boolean; text?: string } | null
      if (!r?.found) throw new OpError(`${ui} isn't on the user's screen (act --ui shows a place)`, 404)
      return { ui, title: r.label || ui, kind: "ui", text: r.folded ? "(folded: only its heading shows; act expand --ui opens it)" : r.text ?? "" }
    }
    const id = str(p.pane) || paneFocus()?.id, pn = paneById(id)
    if (!pn) throw new OpError(id ? `no pane ${id} in the user's window (vau tabs lists them)` : "give `pane`: the user isn't in one", 404)
    if (privatePane(pn)) throw new OpError("that pane is private: the companion never sees it", 403)
    const x = paneSource(pn.to)
    if (x.kind === "terminal") return { pane: pn.id, title: pn.title, kind: "terminal", text: await plugin.ask<string>("terminal:screen", "", x.terminal, 80) }
    if (x.kind === "note") { let text = ""; try { text = readText(plugin.vault.abs(x.path!)) } catch { /* gone */ } return { pane: pn.id, title: pn.title, kind: "note", path: x.path, text: cut(text, SNAPSHOT) } }
    if (x.kind !== "site") return { pane: pn.id, title: pn.title, kind: "view", text: "" }
    const t = await pageFor(pn.id, "read", who(p))
    const r = await plugin.desktop("agent:snapshot", t.tab).catch((e) => { throw new OpError((e as Error).message, 409) }) as { url: string; title: string; snapshot: string }
    return { pane: pn.id, title: r.title || pn.title, kind: "site", url: r.url, access: t.access, text: cut(r.snapshot, SNAPSHOT) }
  },
  text: (r) => `"${r.title}" (${"ui" in r ? r.ui : `pane ${r.pane}`}${"url" in r && r.url ? `, ${r.url}` : ""}${"access" in r && r.access === "read" ? "; you may only read here" : ""}):\n${r.text || "(nothing to read)"}`,
})

type Acted = { url: string; title: string; navigated: boolean; opened?: { tab: number; url: string; title: string }[]; diff?: { page: boolean; lines: string[]; more: number } }
/** What an act in a page did, as told: the page's text is all it sees, so no change there isn't "nothing happened". */
function actText(r: Acted, action: string) {
  const opened = r.opened?.length ? `\nOpened ${r.opened.map((o) => o.title || o.url).join(", ")} in a new tab.` : ""
  const lines = r.diff?.lines?.length ? `\n${r.diff.page ? "The page now" : "What changed (- gone, + new)"}:\n${r.diff.lines.join("\n")}${r.diff.more ? `\n… ${r.diff.more} more lines` : ""}` : ""
  const none = lines || opened ? "" : action === "scroll" ? "\nScrolled; the page's text is the same (see shows what's in view)." : "\nIts text didn't change (a change only its picture shows isn't in it: see, or look at the screen)."
  return `${r.navigated ? "Went to another page: " : ""}${r.title || r.url}${opened}${lines}${none}`
}
type InApp = { ui: string; clicked: string; role?: string; opened?: boolean; already?: boolean; ok?: boolean; saw?: string; shows?: string; notices?: { text: string; kind?: string }[] }
/** What an act in the app did, as read back: done, already so, or plainly not ("nothing changed"), and what shows now. */
function actInAppText(r: InApp, action: string) {
  const what = r.clicked ? JSON.stringify(r.clicked) : r.ui
  const head = r.already ? `Nothing to do: ${r.saw}.` : r.ok === false ? `${r.opened ? "Asked the app to show" : action === "click" ? "Pressed" : `Tried to ${action}`} ${what}, but ${r.saw ?? "nothing changed"}: tell them plainly, or try another way.`
    : `${r.opened ? `Showed ${what}` : action === "click" ? `Pressed ${what}` : `${action[0].toUpperCase()}${action.slice(1)}ed ${what}`} in the app${r.saw ? `: ${r.saw}` : ""}.`
  const notices = r.notices?.length ? ` It then showed: ${r.notices.map((n) => `${JSON.stringify(n.text)}${n.kind === "error" ? " (an error)" : ""}`).join(", ")}.` : ""
  return `${head}${notices}${r.shows ? `\n${r.ui ? `${r.ui} shows now` : "It shows now"} (point at a row by its words, [point "<words>"]):\n${r.shows}` : ""}`
}
/** How long its cursor flies before it clicks, so they see where. */
export const LAND_MS = 450
/** The acts the app's own UI takes: a press, or a state asked for (expand: pressed only when folded). */
const IN_APP = ["click", "dblclick", "expand", "collapse", "check", "uncheck", "select"]
/** An act on the app's own UI, its cursor there first (index.tsx' answers.click): the target by its id or its role and
 *  words, resolved to the part that acts, its state read back. Only what's on screen, or a place the app can show. */
async function actInApp(ctx: OpCtx, name: string, ui: string, find: string, action: string, role = ""): Promise<InApp> {
  if (!IN_APP.includes(action)) throw new OpError(`in the app's own UI it does ${IN_APP.join(", ")}: to write in a note, edit; in a page, give its pane`, 400)
  did(name, "act")
  // (words anywhere in the window: no place to fly to first, as find alone would mean their note's words)
  const done = writingAt(name, { ...(ui ? { ui, ...(find ? { find } : {}) } : {}), pointed: Date.now() })
  try {
    await new Promise((done) => setTimeout(done, LAND_MS))
    const r = await ctx.ui({ action: "companion:click", ui, find, role, how: action }).catch((e) => {
      throw e instanceof OpError && e.status === 409 ? new OpError("no app window is open on this server: open the app first", 409) : e
    }) as ({ found: boolean; label?: string } & Omit<InApp, "ui" | "clicked">) | null
    if (r?.found) { const { found: _f, label, ...rest } = r; return { ui, clicked: label ?? "", ...rest } }
    throw new OpError(find ? `no ${role ? `${role} ` : ""}"${find}" in ${ui || "the app's window"} on the user's screen (use its words as shown)`
      : `${ui} isn't on the user's screen, and the app can't show it (vau tabs lists tabs and panes)`, 404)
  } finally { done() }
}

const ACTS = ["click", "dblclick", "rightclick", "hover", "fill", "type", "press", "check", "uncheck", "select", "scroll", "focus", "expand", "collapse"]
/** A step in another app (take-over): an element their ask listed, a screen point, or (asked there) the field with the keys. */
function onScreen(p: Record<string, unknown>, name: string) {
  if (str(p.ax) || p.sx !== undefined || str(p.app)) return true
  if (str(p.pane) || str(p.el)) return false
  const m = moments.findLast((x) => (x.kind === "ask" || x.kind === "point") && (!x.for || key(x.for) === key(name)))
  return !!m?.summoned && !!m.app && m.app !== "private" && !m.pane && !m.ui
}
async function screenAct(p: Record<string, unknown>, name: string) {
  let step: ReturnType<typeof stepOf>
  try { step = stepOf({ action: str(p.action), ax: str(p.ax) || undefined, sx: p.sx === undefined ? undefined : Number(p.sx), sy: p.sy === undefined ? undefined : Number(p.sy),
    value: p.value === undefined ? undefined : str(p.value), key: str(p.key) || undefined, direction: str(p.direction) || undefined, doing: str(p.doing) || undefined,
    app: str(p.app) || undefined, find: str(p.find) || undefined, role: str(p.role) || undefined }, nearBy.get(key(name)) ?? []) } catch (e) { throw new OpError((e as Error).message, 404) }
  did(name, "act")
  // (its cursor flies there first: the helper waits for it; behind their windows, its card shows where instead)
  const done = writingAt(name, (step.el || step.at) && !step.app ? { ...await resolve(target(p, true), name), pointed: Date.now() } : null)
  try {
    const r = await takeover.act(step, { agent: name, tint: agentOf(name).tint, ask: str(p.ask) || undefined }), was = nearBy.get(key(name)) ?? []
    // (helper's ids are fresh each step: what's near now is what the next points at)
    const near = (r.near ?? []).flatMap((e) => { const t = thingFrom(e); return t?.id ? [t as Near] : [] }), read = { ...r, ...(r.near ? { near } : {}) }
    if (near.length) nearBy.set(key(name), near)
    const effect = effectOf(str(p.action), read, was), effected = effect ? { ...read, effect } : read
    return { screen: true, ...effected, text: doneText(effected) }
  } finally { done() }
}
plugin.op({
  id: "companion.act",
  cli: "companion act",
  owner: "The companion's actions",
  summary: "Act in the user's own web page, the app's UI or (asked on the screen) another app, with your cursor there: click, fill, type, press a key, pick an option, scroll.",
  help: `Their tab, before their eyes: as in their notes, act when that's what they want (they asked, or it's plainly the
next step); a long errand goes to a page of your own instead (vau browser open --task, its tab group yours), told with a
say. Only where its container lets agents act, never on a private page. Answers what changed on the page.

In another app (take-over, an ask on the screen): an element the ask listed (--ax), a point (--sx --sy), or the field
with the keys (neither). With --app, in that app's window behind theirs: their pointer and front app stay theirs, a card
shows its window and what you do; the element by its words (--find), each step read back there, and offered in front
when it can't be confirmed. They're asked first (a card by the pointer, --ask its line), a yes lasting the exchange; a
send, post or delete is asked each time. Your cursor says what it does (--doing, else made from the step); their mouse
or keys pause a step that needs them, a click or Esc stops it. Answers the elements there now, by id.

  vau companion act --pane t5x1 click --el e12
  vau companion act --pane t5x1 fill --el e5 --value "alice@example.com"
  vau companion act click --ax a3 --ask "Want me to turn on dark mode?"
  vau companion act fill --ax a5 --value "Lighthouse" --doing "Typing the title"
  vau companion act press --key cmd+s
  vau companion act click --app Calculator --find "7"
  vau companion act type --app TextEdit --value "Lighthouse notes"`,
  kind: "write",
  lock: false,
  params: { pane: PANE, ui: { ...UI, description: "instead of a page: the app's own UI, by its id (as in look); a place (panel:files:files) is shown, unfolded, and what it shows comes back" },
    find: { type: "string", description: "in the app's UI, or with --app in that app's window: the words of what to act on, as shown (in ui when given, else anywhere in its window)" },
    app: { type: "string", description: "another app to act in behind the user's window (its name: TextEdit), their pointer and front app left alone" },
    role: { type: "string", description: "with find: its role (button, tab, row, switch, checkbox, heading, link, menuitem, textbox), when the words alone could name two things" },
    action: { type: "string", required: true, enum: ACTS, description: "what to do" }, el: EL,
    ax: PLACE.ax, sx: PLACE.sx, sy: PLACE.sy, ask: { type: "string", description: "in another app: the line offering it, when they haven't said yes yet (Want me to...?)" },
    doing: { type: "string", description: "in another app: a few words by your cursor for this step (Typing the title); else made from the step" },
    value: { type: "string", description: "the text to fill or type, or the option to select (scroll: up or down)" }, key: { type: "string", description: "the key to press (Enter, Tab, Escape; in another app with modifiers: cmd+s)" },
    direction: { type: "string", enum: ["up", "down"], description: "which way to scroll" }, as: AS },
  args: ["action", "value"],
  run: async (p, ctx) => {
    const name = who(p)
    if (str(p.ui)) return actInApp(ctx, name, str(p.ui), str(p.find), str(p.action), str(p.role))
    // (an element their ask listed over Vaultite's own window: the same act, through its UI by id or role and name)
    const ask = askOf(name), own = str(p.ax) && ask && !awayIn([ask]) ? nearBy.get(key(name))?.find((e) => e.id === str(p.ax)) : undefined
    if (own) return actInApp(ctx, name, own.ui ?? "", own.ui ? "" : own.label, str(p.action), own.ui ? "" : own.role)
    if (onScreen(p, name)) return screenAct(p, name)
    // (words alone, in a note or a view: a button or row of the app's window saying them)
    if (str(p.find) && !str(p.pane) && !str(p.el) && paneSource(paneFocus()?.to ?? "").kind !== "site") return actInApp(ctx, name, "", str(p.find), str(p.action), str(p.role))
    if (p.action === "rightclick" || p.action === "focus") throw new OpError(`${String(p.action)} is for another app (--ax, --sx --sy)`)
    if (p.action === "expand" || p.action === "collapse") throw new OpError(`in a web page, click what opens or folds it`)
    const id = str(p.pane) || paneFocus()?.id
    if (!id) throw new OpError("give `pane` (a web page) or `ui` (the app's own UI): the user isn't in a web page")
    if (p.action === "scroll" && !p.direction && /^(up|down)$/i.test(str(p.value))) p = { ...p, direction: str(p.value).toLowerCase(), value: undefined }
    const t = await pageFor(id, "act", name)
    did(name, "act")
    const done = writingAt(name, str(p.el) ? await resolve({ pane: id, el: str(p.el) }, name).catch(() => ({ pane: id })) : null)
    try {
      const r = await plugin.desktop("agent:act", t.tab, { action: p.action, ref: str(p.el) || undefined, value: p.value, key: p.key, direction: p.direction, diff: "summary" },
        { name, session: "", task: "", summary: "", remote: false }).catch((e) => { throw new OpError((e as Error).message, 409) }) as Acted
      return { pane: id, ...r }
    } finally { done() }
  },
  text: (r, p) => ("screen" in r ? r.text : "clicked" in r ? actInAppText(r, String(p.action)) : actText(r, String(p.action))),
  did: (p) => ({ action: "ui", text: `${String(p.action)} in ${p.ui ? `the app (${String(p.ui)}${p.find ? ` "${String(p.find)}"` : ""})` : p.app ? `${String(p.app)}, behind their window${p.find ? ` ("${String(p.find)}")` : ""}` : p.ax || p.sx !== undefined ? "another app" : "the user's page"}${p.el || p.ax ? ` (${String(p.el || p.ax)})` : ""}`, paths: [], by: who(p) }),
})

/** What each agent's last check of another app read: what its next `changed` compares with. */
const checked = new Map<string, string>()
/** One condition (core/desktop/uimodel.ts' language: expanded "Files", shows "Saved", selected tab "Notes", changed) checked once where
 *  agent `name`'s last ask was: another app's window (its helper's Accessibility) or Vaultite's (its page). */
export async function checkNow(ctx: OpCtx, name: string, condition: string): Promise<Verdict & { where: string }> {
  let c
  try { c = parseCondition(condition) } catch (e) { throw new OpError((e as Error).message, 400) }
  const ask = askOf(name), away = ask ? awayIn([ask]) : ""
  if (away) {
    if (away === "a private app") throw new OpError("that app is private: the companion never reads it", 403)
    const r = await takeover.things()
    if (!r.ok) throw new OpError(r.text ?? "that app's window can't be read now", 409)
    const view = listView(r.things ?? []), v = checkOn(c, view, checked.get(key(name)))
    checked.set(key(name), view.snapshot())
    return { ...v, where: away }
  }
  const r = await ctx.ui({ action: "companion:check", condition }).catch((e) => {
    throw e instanceof OpError && e.status === 409 ? new OpError("no app window is open on this server: open the app first", 409) : e
  }) as Verdict | null
  // (a window still running the app from before it could check: it answers nothing)
  if (typeof r?.saw !== "string") throw new OpError("the app's window is out of date: it can check once it reloads", 409)
  return { ...r, where: "Vaultite" }
}
plugin.op({
  id: "companion.check",
  cli: "companion check",
  summary: "Check one state on the user's screen now, by reading it back: whether a section is open, a tab selected, a switch on, words shown, or anything changed since your last act.",
  help: `Where their last ask was: Vaultite's window, or the app they asked over. A thing is named by its role and words, as
it shows (role "name" [in "container"]), or by its id (ui:panel:files:files, a3). After an act, to know it worked.

  vau companion check 'expanded "Files"'
  vau companion check 'selected tab "Notes"'
  vau companion check 'not checked switch "Dark mode"'
  vau companion check 'shows "Saved"'
  vau companion check 'value textbox "Title" is "Lighthouse"'
  vau companion check changed`,
  kind: "read",
  lock: false,
  params: { condition: { type: "string", required: true, description: "[not] expanded|collapsed|selected|checked|unchecked|focused|disabled|exists|gone <target>; shows \"<words>\" [in <target>]; value <target> is \"<text>\"; changed" }, as: AS },
  args: ["condition"],
  run: (p, ctx) => checkNow(ctx, who(p), str(p.condition)),
  text: (r) => `${r.ok ? "Yes" : "No"}: ${r.saw} (${r.where}).`,
})
