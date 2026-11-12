import { check } from "../lib.ts"

// ---------- Shortcodes: :fire: and :LiCalendar: while typing (plugins/core/shortcodes) ----------
const c = await import("../../../plugins/core/shortcodes/codes.ts")
const { gemoji } = await import("gemoji")
// (by a name in a variable: the server's type check doesn't follow them into the web's modules)
const LUCIDE = "lucide-react/dist/esm/icons/index.mjs", EDITOR = "../../../plugins/core/shortcodes/editor.ts"
const lucide = Object.keys(await import(LUCIDE)).sort()
const names = (typed: string, recent: string[] = []) => c.matches(typed, gemoji, lucide, recent, 5).map((f) => f.kind === "emoji" ? f.emoji : `icon:${f.name}`)
check("shortcodes: :fir finds 🔥 first, then icons", names("fir")[0] === "🔥" && names("fir").includes("icon:flame") === false && names("fire").some((n) => n.startsWith("icon:")), names("fir"))
check("shortcodes: :icon-cal and Iconize's :LiCal are only icons", names("icon-cal").every((n) => n.startsWith("icon:")) && names("icon-cal")[0] === "icon:calendar"
  && names("LiCal")[0] === "icon:calendar", [names("icon-cal"), names("LiCal")])
check("shortcodes: a recently used match comes first", names("sm")[0] !== "😏" && names("sm", ["😏"])[0] === "😏", [names("sm"), names("sm", ["😏"])])
check("shortcodes: icons written as Iconize writes them", c.iconCode("CalendarDays") === ":LiCalendarDays:" && c.kebab("ArrowUp01") === "arrow-up-01"
  && [..."a :LiCalendar: b :Lifoo: `:LiSun:`".matchAll(c.ICON_CODE)].map((m) => m[1]).join() === "Calendar,Sun")
check("shortcodes: typing starts after a space or a line's start, not in a time or a URL", c.TYPING.test("a :fi") && c.TYPING.test(":+1") && !c.TYPING.test("10:30")
  && !c.TYPING.test("https://x") && !c.TYPING.test("a:fi") && !c.TYPING.test("a :f"))
check("shortcodes: a whole code closed", c.CLOSED.exec("so :fire:")?.[1] === "fire" && !c.CLOSED.test("10:30:") && !c.CLOSED.test("a::"))
check("shortcodes: remembered latest first, once", c.remember(["a", "b"], "b").join() === "b,a")
// Icons are drawn from each Lucide component's own drawing (editor.ts iconSvg reads it the same way).
const comp = (await import(LUCIDE) as Record<string, { render(p: object, r: null): { props: { icon: { node: unknown[] } } } }>).Calendar
check("shortcodes: a Lucide component gives its drawing", Array.isArray(comp.render({}, null).props.icon.node) && comp.render({}, null).props.icon.node.length > 0)

// The suggestions in a note, and a pick put in.
const { iconName, suggest }: { iconName(n: string): string | null; suggest(ctx: never, on: object): Promise<{ from: number; options: import("@codemirror/autocomplete").Completion[] } | null> | { from: number; options: import("@codemirror/autocomplete").Completion[] } | null } = await import(EDITOR)
const { EditorState } = await import("@codemirror/state")
const { markdown } = await import("@codemirror/lang-markdown")
const ask = async (doc: string, on = {}) => {
  const pos = doc.indexOf("|"), text = doc.replace("|", "")
  const state = EditorState.create({ doc: text, extensions: [markdown()] })
  const ctx = { state, pos, explicit: false, matchBefore(re: RegExp) {
    const l = state.doc.lineAt(pos), t = l.text.slice(0, pos - l.from), m = new RegExp(`(?:${re.source})$`, re.flags).exec(t)
    return m ? { from: l.from + m.index, to: pos, text: m[0] } : null
  } } as never
  const r = await suggest(ctx, on)
  if (!r) return null
  const view = { state, dispatch(tr: import("@codemirror/state").TransactionSpec) { this.state = this.state.update(tr).state } }
  const first = r.options[0].apply as (v: never, c: unknown, from: number, to: number) => void
  first(view as never, null, r.from, pos)
  return { labels: r.options.map((o) => o.label), picked: view.state.doc.toString() }
}
const fi = await ask("Hot :fir|")
check("shortcodes: :fir suggests :fire: and picking it puts 🔥 in", fi?.labels[0] === ":fire:" && fi.picked === "Hot 🔥", fi)
const cal = await ask("Due :icon-calendar|")
check("shortcodes: picking an icon writes :LiCalendar:", cal?.picked === "Due :LiCalendar:", cal)
check("shortcodes: an icon's old name or another case still draws it (Iconize's Obsidian may know older names)",
  iconName("Smile") === "FaceSlightlySmiling" && iconName("calendardays") === "CalendarDays" && iconName("NoSuchIcon") === null, [iconName("Smile"), iconName("calendardays")])
check("shortcodes: none in code or the frontmatter, nor for a namespace switched off", await ask("`a :fi|`") === null && await ask("---\nx: :fi|\n---\n") === null
  && await ask("a :icon-cal|", { icons: false }) === null && (await ask("a :fir|", { emoji: false }))?.labels.every((l) => !l.startsWith(":")) === true)
