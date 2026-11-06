// Take-over's rules, apart from the Mac (tested alone): what it never does, what needs the user's yes each time, and
// how each step is done (Accessibility first, then the pointer or the keys).

export type Rect = { x: number; y: number; width: number; height: number }
/** A step the companion asked for: at an element an ask listed (`el`), a screen point (`at`), or the field with the
 *  keyboard (neither). */
export type Step = { action: string; el?: { frame: Rect; role?: string; label?: string }; at?: { x: number; y: number }
  value?: string; key?: string; direction?: "up" | "down" }
/** What takeover.swift found there (`probe`). */
export type Probe = { ok: boolean; why?: string; bundle?: string; name?: string; pid?: number; vaultite?: boolean; role?: string; roleName?: string; subrole?: string
  secure?: boolean; label?: string; frame?: Rect | null; actions?: string[]; valueSettable?: boolean; checked?: boolean; web?: boolean; window?: number; title?: string
  /** The page or document its window shows (a browser's address): a private site is never acted on. */
  url?: string }
/** One request to takeover.swift. */
export type Call = { op: string } & Record<string, unknown>

export const STEPS = ["click", "dblclick", "rightclick", "hover", "fill", "type", "press", "check", "uncheck", "scroll", "focus"]
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

/** Whether their yes still holds after the driving ends this way: a step done keeps it, them taking over or the
 *  exchange ending doesn't. */
export const keepsYes = (why: string) => why === "done"

/** The middle of where a step goes: its element's (a button's text-sized middle), else its point. */
export function spotOf(step: Step, there?: Probe): { x: number; y: number } | null {
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
    case "dblclick": return pointer({ op: "click", ...at, count: 2 })
    case "rightclick": return [...(step.el ? [[{ op: "press", ...el, action: "AXShowMenu" }]] : []), ...pointer({ op: "click", ...at, right: true })]
    case "hover": return pointer({ op: "hover", ...at })
    case "focus": return focus.length ? focus : [[]]
    case "check": case "uncheck":
      if (there.checked !== undefined && there.checked === (step.action === "check")) return [[]]
      return [...(step.el ? [[{ op: "press", ...el }]] : []), ...pointer({ op: "click", ...at })]
    case "fill": {
      // (a native field takes its value at once; a web page's hears only typing)
      const typed = (pre: Call[]) => [...pre, { op: "key", key: "cmd+a" }, { op: "type", text: step.value }]
      const set = !there.web && there.valueSettable ? [[{ op: "set", ...el, value: step.value }]] : []
      return [...set, ...(focus.length ? focus.map(typed) : [typed([])])]
    }
    case "type": return focus.length ? focus.map((pre) => [...pre, { op: "type", text: step.value }]) : [[{ op: "type", text: step.value }]]
    case "press": return focus.length ? focus.map((pre) => [...pre, { op: "key", key: step.key }]) : [[{ op: "key", key: step.key }]]
    case "scroll": return pointer({ op: "scroll", ...at, dy: step.direction === "up" ? 400 : -400 })
  }
  return []
}
