// Take-over's rules, apart from the Mac (tested alone): what it never does, what needs the user's yes each time, and
// how each step is done (Accessibility first, then the pointer or the keys).
import { actionsOfAx, roleOfAx, type Thing } from "../core/desktop/uimodel.ts"
import { z } from "zod"

export type Rect = { x: number; y: number; width: number; height: number }
/** A step the companion asked for: at an element an ask listed (`el`), a screen point (`at`), or the field with the
 *  keyboard (neither). */
export type Step = { action: string; el?: { frame: Rect; role?: string; label?: string }; at?: { x: number; y: number }
  value?: string; key?: string; direction?: "up" | "down"
  /** What it's doing, in a few words (Typing the title): its cursor's caption; else made from the step. */
  doing?: string
  /** Behind their windows: the app it acts in (its front window), by name; the element there by its words (`find`). */
  app?: string; find?: string; role?: string }
const RECT = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
const WORDS = z.string().optional()
export const STEP: z.ZodType<Step> = z.object({
  action: z.string(), el: z.object({ frame: RECT, role: WORDS, label: WORDS }).optional(), at: z.object({ x: z.number(), y: z.number() }).optional(),
  value: WORDS, key: WORDS, direction: z.enum(["up", "down"]).optional().catch("down"), doing: WORDS, app: WORDS, find: WORDS, role: WORDS,
})
/** What takeover.swift found there (`probe`). */
export type Probe = { ok: boolean; why?: string; bundle?: string; name?: string; pid?: number; vaultite?: boolean; role?: string; roleName?: string; subrole?: string
  secure?: boolean; label?: string; frame?: Rect | null; actions?: string[]; valueSettable?: boolean; checked?: boolean; web?: boolean; window?: number; title?: string
  /** Its state, read back after a step (core/desktop/uimodel.ts). */
  expanded?: boolean; selected?: boolean; disabled?: boolean; value?: string
  /** The page or document its window shows (a browser's address): a private site is never acted on. */
  url?: string }
/** One request to takeover.swift. */
export type Call = { op: string } & Record<string, unknown>

export const STEPS = ["click", "dblclick", "rightclick", "hover", "fill", "type", "press", "check", "uncheck", "expand", "collapse", "scroll", "focus"]
const TYPING = new Set(["fill", "type"])
/** Apps where Return sends what's written: a message. */
const SENDS_ON_RETURN = new Set(["com.apple.MobileSMS", "com.apple.mail", "com.tinyspeck.slackmacgap", "net.whatsapp.WhatsApp", "desktop.WhatsApp", "com.hnc.Discord",
  "ru.keepcoder.Telegram", "org.telegram.desktop", "com.microsoft.teams2", "com.microsoft.Outlook", "com.facebook.archon", "org.whispersystems.signal-desktop", "com.readdle.smartemail-Mac"])
/** Browsers: a button with no words there may be a page's send. */
const BROWSERS = new Set(["com.google.Chrome", "com.apple.Safari", "org.mozilla.firefox", "company.thebrowser.Browser", "com.brave.Browser", "com.microsoft.edgemac",
  "com.vivaldi.Vivaldi", "com.operasoftware.Opera", "app.zen-browser.zen", "com.kagi.kagimacOS"])
/** Fields where Return may send what's written (a chat's box, a web form). */
const FIELDS = new Set(["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"])
/** What a press sends out of the Mac, or can't be taken back. */
const OUTWARD = /^(send|post|publish|tweet|reply|reply all|forward|submit|share|comment|pay|buy|purchase|order|place order|checkout|check out|subscribe|delete|remove|erase|transfer|sign|confirm|invite|merge|deploy)\b/i
/** Words that look like a key or a password: never typed, whoever asks. */
const SECRET = /(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/

/** Why this step is never done (null: it may be, with their yes). */
export function refusal(step: Step, there: Probe, isPrivate: (a: { bundle: string; name: string; url?: string }) => boolean): string | null {
  if (!STEPS.includes(step.action)) return `no step "${step.action}" on the screen (${STEPS.join(", ")})`
  if (!there.ok) return there.why === "gone" ? "that element isn't there any more: point again from a fresh ask" : "nothing to act on there"
  if (there.vaultite) return "that's Vaultite's own window: act there with --ui or --pane"
  if (isPrivate({ bundle: there.bundle ?? "", name: there.name ?? "", url: there.url })) return "that app or site is private: the companion never acts there"
  if (TYPING.has(step.action) && there.secure) return "that's a password field: the companion never types secrets"
  if (TYPING.has(step.action) && SECRET.test(step.value ?? "")) return "those words look like a key or a password: the companion never types secrets"
  if (TYPING.has(step.action) && !step.value) return "give the words to type (value)"
  if (step.action === "press" && !step.key) return "give the key to press (key: Enter, Tab, cmd+s)"
  // (Esc is the user's: it ends the exchange, and the take-over with it)
  if (step.action === "press" && /^(esc|escape)$/i.test(step.key ?? "")) return "Esc is the user's way to stop you: to close something, press its Cancel or Close"
  return null
}

/** What this step sends out (a message, a post, a payment) or deletes: it asks each time, naming it, whatever was
 *  agreed before. A Return in a field, a new line typed, a button with no words in a messenger or a page count. */
export function outward(step: Step, there: Probe): string | null {
  const app = there.name || "the app", bundle = there.bundle ?? "", key = (step.key ?? "").toLowerCase().replace(/\s+/g, "")
  if (step.action === "press") {
    if (/^((cmd|command|meta|ctrl|control|shift|alt|option|opt)\+)*(return|enter)$/.test(key) && (SENDS_ON_RETURN.has(bundle) || FIELDS.has(there.role ?? "") || !!there.web)) return `Send it in ${app}?`
    if (/(^|\+)(cmd|command|meta)\+(.+\+)?(backspace|delete|forwarddelete)$/.test(key)) return `Delete it in ${app}?`
  }
  if ((step.action === "type" || step.action === "fill") && /[\r\n]/.test(step.value ?? "")) return `Type it and send it in ${app}?`
  if (step.action === "click" || step.action === "dblclick") {
    const words = (step.el?.label || there.label || "").trim()
    if (OUTWARD.test(words)) return `Press "${words.slice(0, 40)}" in ${app}?`
    if (!words && (SENDS_ON_RETURN.has(bundle) || BROWSERS.has(bundle) || !!there.web)) return `Press that button in ${app}?`
  }
  return null
}

/** How long after their click on Do it a mouse move is their hand coming off the button, not them taking over (a
 *  click or a key still is). */
export const HAND_MS = 1500
/** What's left of that grace when the guard goes on (a spoken yes, or one long ago: none). */
export const handGrace = (clickedAt: number, now: number) => (clickedAt > 0 ? Math.max(0, HAND_MS - (now - clickedAt)) : 0)

/** An offer waits while they could still answer: till Do it, Not now, Esc, a click elsewhere, another app, or their
 *  next ask (`asked`); OFFER_MS ends only one forgotten on screen (`forgotten`). */
export const OFFER_MS = 10 * 60_000
export type Answer = "yes" | "no" | "asked" | "forgotten"
/** What act answers for an offer that ended without their yes. */
export const declined: Record<Exclude<Answer, "yes">, string> = {
  no: "they didn't say yes: don't do it; tell them how in a few words instead, or ask again only if they ask you to",
  asked: "they asked something else before answering (your next message): don't do it; answer that, and offer again only if they still want it",
  forgotten: "no answer for minutes, the offer is gone: don't do it; offer again only if they ask you to",
}

/** The offer a spoken yes or no is for, when several are up: the one under their pointer, else the nearest to it. */
export function aimedAt(cards: { id: string; rect: Rect }[], p: { x: number; y: number }): string | null {
  let best: { id: string; d: number } | null = null
  for (const c of cards) {
    const r = c.rect, dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width)), dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height))
    const d = dx * dx + dy * dy
    if (!best || d < best.d) best = { id: c.id, d }
  }
  return best?.id ?? null
}

/** Where a new card goes: by `at`, moved down past the cards already up that it would cover. */
export function cardSpot(at: { x: number; y: number }, size: { width: number; height: number }, area: Rect, up: Rect[]): { x: number; y: number } {
  const x = Math.round(Math.min(Math.max(at.x + 18, area.x + 8), area.x + area.width - size.width - 8))
  let y = Math.round(Math.max(at.y + 18, area.y + 8))
  const covers = (r: Rect) => x < r.x + r.width && r.x < x + size.width && y < r.y + r.height && r.y < y + size.height
  for (let hit = up.find(covers); hit; hit = up.find(covers)) y = hit.y + hit.height + 6
  return { x, y: Math.round(Math.min(y, area.y + area.height - size.height - 8)) }
}

/** Whether their yes still holds after the driving ends this way: a step done keeps it, them taking over or the
 *  exchange ending doesn't. */
export const keepsYes = (why: string) => why === "done"

/** Where a step goes: its element's middle, a point itself (never the middle of what's hit there: a page's), else the
 *  field with the keys' middle; a scroll with no place goes where their pointer is (null). */
export function spotOf(step: Step, there?: Probe): { x: number; y: number } | null {
  if (step.action === "scroll" && !step.el && !step.at) return null
  if (step.at && !step.el) return step.at
  const f = step.el?.frame ?? there?.frame
  if (f) return { x: Math.round(f.x + f.width / 2), y: Math.round(f.y + f.height / 2) }
  return step.at ?? null
}

/** How a step is done, in the order tried: Accessibility first (sure, no pointer), the pointer or the keys if it can't. */
export function plan(step: Step, there: Probe): Call[][] {
  const el = step.el ? { frame: step.el.frame, role: step.el.role ?? "", label: step.el.label ?? "" } : step.at ? { frame: { ...step.at, width: 1, height: 1 }, role: "", label: "" } : { focused: true }
  const p = spotOf(step, there)
  const at = p ? { x: p.x, y: p.y } : null
  const pointer = (c: Call): Call[][] => (at ? [[c]] : [])
  const focus: Call[][] = step.el || step.at ? [[{ op: "focus", ...el }], ...pointer({ op: "click", ...at })] : []
  switch (step.action) {
    // (a button's words are pressed as their button: takeover.swift looks up its parents)
    case "click": return [...(step.el ? [[{ op: "press", ...el }]] : []), ...pointer({ op: "click", ...at })]
    // (an item's double-click is its open: Finder's, a list's)
    case "dblclick": return [...(step.el ? [[{ op: "press", ...el, action: "AXOpen" }]] : []), ...pointer({ op: "click", ...at, count: 2 })]
    case "rightclick": return [...(step.el ? [[{ op: "press", ...el, action: "AXShowMenu" }]] : []), ...pointer({ op: "click", ...at, right: true })]
    case "hover": return pointer({ op: "hover", ...at })
    case "focus": return focus.length ? focus : [[]]
    case "check": case "uncheck": case "expand": case "collapse":
      // (already so: nothing pressed)
      if (step.action.endsWith("check") ? there.checked !== undefined && there.checked === (step.action === "check") : there.expanded !== undefined && there.expanded === (step.action === "expand")) return [[]]
      return [...(step.el ? [[{ op: "press", ...el }]] : []), ...pointer({ op: "click", ...at })]
    case "fill": {
      // (a native field takes its value at once; a web page's hears only typing)
      const typed = (pre: Call[]) => [...pre, { op: "key", key: "cmd+a" }, { op: "type", text: step.value }]
      const set = !there.web && there.valueSettable ? [[{ op: "set", ...el, value: step.value }]] : []
      return [...set, ...(focus.length ? focus.map(typed) : [typed([])])]
    }
    case "type": return focus.length ? focus.map((pre) => [...pre, { op: "type", text: step.value }]) : [[{ op: "type", text: step.value }]]
    case "press": return focus.length ? focus.map((pre) => [...pre, { op: "key", key: step.key }]) : [[{ op: "key", key: step.key }]]
    // (its scroll bar through Accessibility first, takeover.swift's; with no place, where their pointer is: it doesn't move)
    case "scroll": return [[{ op: "scroll", ...(at ?? {}), dy: step.direction === "up" ? 400 : -400 }]]
  }
  return []
}

/** What a call needs of the Mac: Accessibility only (their hands don't matter), the pointer, or the keys. */
export type Kind = "ax" | "pointer" | "keys"
export const kindOf = (op: string): Kind => (["click", "hover", "scroll"].includes(op) ? "pointer" : ["key", "type"].includes(op) ? "keys" : "ax")
/** Whether a step types (their typing then goes where it types, and stops it). */
export const types = (step: Step) => ["fill", "type", "press"].includes(step.action)

/** How long they must be still before a step with the pointer or the keys goes on, and how long it waits for that. */
export const REST_MS = 1000, PAUSED_MS = 45_000
/** Its cursor's caption while it waits for their hands. */
export const pausedLine = (hands: "mouse" | "keys") => (hands === "mouse" ? "Paused, you're using the mouse" : "Paused, you're typing")
/** Its cursor's caption for a step (Clicking Files, Typing in Title): its own words, else made from the step. */
export function intentOf(step: Step, there?: Probe): string {
  const own = step.doing?.trim()
  if (own) return cap(own)
  const raw = (step.el?.label || (step.el || step.at ? there?.label : "") || "").replace(/\s+/g, " ").trim()
  const name = raw && raw.length <= 30 ? raw : "", on = name ? ` ${name}` : ""
  const words = (step.value ?? "").replace(/\s+/g, " ").trim()
  switch (step.action) {
    case "click": case "select": return cap(`Clicking${on || " here"}`)
    case "dblclick": return cap(`Opening${on || " it"}`)
    case "rightclick": return cap(`Opening the menu${name ? ` of ${name}` : ""}`)
    case "hover": return cap(`Pointing at${on || " it"}`)
    case "fill": return cap(name ? `Typing in ${name}` : "Filling it in")
    case "type": return cap(words && words.length <= 24 ? `Typing "${words}"` : name ? `Typing in ${name}` : "Typing")
    case "press": return cap(`Pressing ${keyName(step.key ?? "")}`)
    case "check": return cap(`Checking${on || " it"}`)
    case "uncheck": return cap(`Unchecking${on || " it"}`)
    case "expand": return cap(`Opening${on || " it"}`)
    case "collapse": return cap(`Folding${on || " it"}`)
    case "scroll": return step.direction === "up" ? "Scrolling up" : "Scrolling down"
    case "focus": return cap(`Going to${on || " the field"}`)
  }
  return ""
}
/** A caption is at most 52 characters, as Figma's are. */
const cap = (s: string) => (s.length > 52 ? `${s.slice(0, 51).trimEnd()}…` : s)
const KEY_NAMES: Record<string, string> = { cmd: "⌘", command: "⌘", meta: "⌘", ctrl: "⌃", control: "⌃", alt: "⌥", option: "⌥", opt: "⌥", shift: "⇧", enter: "Return", return: "Return",
  esc: "Esc", escape: "Esc", backspace: "Delete", delete: "Delete", tab: "Tab", space: "Space", pagedown: "Page Down", pageup: "Page Up" }
const keyName = (combo: string) => combo.split("+").map((k) => KEY_NAMES[k.trim().toLowerCase()] ?? (k.trim().length === 1 ? k.trim().toUpperCase() : k.trim())).join("")

/** What act answers when it stopped because of them (`why`: user-click, user-esc, user-typing), or waited too long. */
export function tookText(why: string): string {
  if (why === "user-click") return "they clicked, so it stopped there: don't act again unless they ask"
  if (why === "user-esc") return "they pressed Esc, so it stopped: don't act again unless they ask"
  if (why === "user-typing") return "they started typing where it was typing, so it stopped: don't act again unless they ask"
  if (why === "paused") return "they kept using the mouse or keys, so it stopped waiting for them: ask whether to go on"
  if (why === "helper") return "its helper on this Mac stopped mid-way: look again before going on"
  return "the exchange ended: stop"
}

/** What a probe found, as a thing (core/desktop/uimodel.ts): what a step's effect is read from. */
export function probeThing(p: Probe | null): Thing | null {
  if (!p?.ok || !p.frame) return null
  const state: Thing["state"] = {}
  for (const k of ["expanded", "selected", "checked", "disabled"] as const) if (typeof p[k] === "boolean") state[k] = p[k]
  if (typeof p.value === "string" && !p.secure) state.value = p.value
  return { role: roleOfAx(p.role ?? "", p.subrole), label: p.label ?? "", frame: p.frame, state, actions: actionsOfAx(p.actions ?? []), inside: [] }
}

// ---------- behind their windows: a step in an app they aren't looking at, their pointer and front app left alone

/** An app's front window, as takeover.swift found it (`window`). */
export type Window = { ok: boolean; why?: string; pid?: number; window?: number; frame?: Rect; title?: string; bundle?: string; name?: string
  /** Their front app, and how much of the window others hide (0 to 1). */
  front?: boolean; covered?: number
  /** Whether this Mac can act behind (its private SkyLight calls found). */
  behind?: boolean; vaultite?: boolean }
/** Why a step can't go to `app`'s window (null: it can). */
export function behindRefusal(app: string, w: Window): string | null {
  const name = w.name || app
  if (w.vaultite) return "that's Vaultite itself: act there with --ui"
  if (w.ok) return null
  if (w.why === "not-running") return `${app} isn't open: open it first (vau companion open), then act there`
  if (w.why === "hidden") return `${name} is hidden: ask them to show it, or act once they do`
  return `${name} has no window open to act in`
}
/** Their own front app, in view: no need to act behind it, the take-over in front does it as they watch. */
export const inFront = (w: Window) => !!w.front && (w.covered ?? 0) < 0.05
/** How a step is done behind: as in front (Accessibility first, then the pointer or the keys), but every event goes to
 *  that window alone; a hover needs the real pointer, so it isn't done there. */
export const behindPlan = (step: Step, there: Probe): Call[][] => plan(step, there).filter((a) => !a.some((c) => c.op === "hover"))
/** What's read back around a step behind: its window's digest (takeover.swift), its element's value and state. */
export type Readback = { digest?: string; value?: string; checked?: boolean; expanded?: boolean }
/** Whether a step's effect shows in what's read back: its field's value, its state, else its window changed at all. */
export function verified(step: Step, before: Readback, after: Readback): boolean {
  if (step.action === "fill" && after.value !== undefined) return after.value === (step.value ?? "")
  if (step.action === "type" && after.value !== undefined && before.value !== undefined && after.value !== before.value) return true
  if ((step.action === "check" || step.action === "uncheck") && after.checked !== undefined) return after.checked === (step.action === "check")
  if ((step.action === "expand" || step.action === "collapse") && after.expanded !== undefined) return after.expanded === (step.action === "expand")
  return !!before.digest && !!after.digest && before.digest !== after.digest
}
/** How long a step's effect may take to show (a web page's, an app's redraw), and how often it's looked for. */
export const SETTLE_MS = 1500, LOOK_MS = 150
/** The offer when a step behind couldn't be confirmed: today's take-over, in front, as they watch. */
export const unsureLine = (app: string) => `I couldn't confirm that in ${app} from behind. Bring it forward and do it while you watch?`
/** Where a step acts in its window, as fractions of it (its card's cursor). */
export function cursorIn(p: { x: number; y: number } | null, f: Rect | undefined): { x: number; y: number } | null {
  if (!p || !f || f.width <= 0 || f.height <= 0) return null
  const k = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000
  return { x: k((p.x - f.x) / f.width), y: k((p.y - f.y) / f.height) }
}
