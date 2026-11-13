import { check } from "../lib.ts"

// The block contract (core/blocks.ts, shared): options checked against a declaration, defaults filled in.
const B = await import("../../../core/blocks.ts")
const decl: import("../../../core/blocks.ts").BlockDecl = { description: "a made-up card", options: {
  limit: { type: "number", default: 5, min: 1, max: 50, description: "how many" },
  view: { type: "enum", values: ["table", "list"], description: "how it's drawn" },
  archived: { type: ["boolean", "enum"], values: ["only"], description: "archived ones too" },
  areas: { type: ["string", "list"], description: "which" },
  relations: { type: "list", values: ["friend", "family"], description: "who" },
  title: { type: "string", default: "Card", description: "its title" },
  area: { type: "string", required: true, description: "the area" },
  where: { type: "map", description: "a map" },
} }
const notes = (o: Record<string, unknown>) => B.optionNotes(decl, o)
check("blocks: fine options have no notes", !notes({ area: "gym", limit: 3, view: "list", archived: "only", areas: "gym", relations: ["friend"], title: 2026, where: { a: 1 }, wide: true, file: "Logs/" }).length,
  notes({ area: "gym" }))
check("blocks: an unknown option, and the closest name", notes({ area: "x", limt: 3 })[0] === "unknown option `limt` (did you mean `limit`?)", notes({ area: "x", limt: 3 }))
check("blocks: an unknown option with nothing close", notes({ area: "x", colour: "red" })[0] === "unknown option `colour`", notes({ area: "x", colour: "red" }))
check("blocks: a wrong type", notes({ area: "x", limit: "ten" })[0] === "`limit` should be a number, not \"ten\"", notes({ area: "x", limit: "ten" }))
check("blocks: out of range", notes({ area: "x", limit: 99 })[0] === "`limit` should be at most 50" && notes({ area: "x", limit: 0 })[0] === "`limit` should be at least 1")
check("blocks: an enum's values", notes({ area: "x", view: "grid" })[0] === "`view` should be one of table, list, not \"grid\"", notes({ area: "x", view: "grid" }))
check("blocks: true, false or a value", !notes({ area: "x", archived: true }).length && notes({ area: "x", archived: "all" })[0] === "`archived` should be true, false or only, not \"all\"",
  notes({ area: "x", archived: "all" }))
check("blocks: a list's items", notes({ area: "x", relations: ["friend", "boss"] })[0] === "`relations` takes only friend, family", notes({ area: "x", relations: ["boss"] }))
check("blocks: a list where a text is wanted", notes({ area: ["x"] })[0] === "`area` should be a text, not [\"x\"]", notes({ area: ["x"] }))
check("blocks: required", notes({})[0] === "`area` is required" && notes({ area: null }).includes("`area` is required"), notes({}))
check("blocks: empty values are unset", !B.optionNotes(decl, { area: "x", limit: null }).length)
check("blocks: no declaration, nothing to check", !B.optionNotes(null, { anything: 1 }).length)
check("blocks: options that aren't YAML or a map", B.parseOptions("a: [").error?.startsWith("its options aren't YAML") && B.parseOptions("- a").error === "its options should be `key: value` lines"
  && !B.parseOptions("").error && B.parseOptions("a: 1").options.a === 1)
const r = B.resolveOptions(decl, { title: 2026, limit: null })
check("blocks: defaults filled in, a number made text where a text is declared", r.limit === 5 && r.title === "2026" && !("view" in r), r)
check("blocks: the closest name", B.closest("isues", ["issues", "stats"]) === "issues" && B.closest("x", ["issues"]) === null)
check("blocks: a sound declaration has no problems", !B.declProblems({ card: decl }, "m").length, B.declProblems({ card: decl }, "m"))
const bad = B.declProblems({ "bad name": { description: "x" }, card: { description: "", options: { wide: { type: "boolean", description: "x" },
  n: { type: "integer", description: "" }, v: { type: "enum", description: "x" }, d: { type: "number", default: "five", description: "x" } } } }, "m")
check("blocks: a declaration's own problems", ["a block's name is letters", "card' needs a description", "option 'wide': every block takes it",
  "option 'n': type must be one of", "option 'n' needs a description", "option 'v': an enum needs its values", "option 'd': its default should be a number"]
  .every((w) => bad.some((b) => b.includes(w))), bad)
check("blocks: where its data comes from, declared", !B.declProblems({ card: { ...decl, live: "GitHub's API", reads: ["Finance/Transactions.csv"] } }, "m").length &&
  B.declProblems({ card: { ...decl, live: "two\nlines", reads: "Finance.csv" } }, "m").length === 2)
check("blocks: the doc for AIs, from the declarations", B.blocksDoc({ card: decl }).startsWith("Block:\n- `card`: a made-up card\n  - `limit` (a number, default 5, 1 to 50): how many"),
  B.blocksDoc({ card: decl }))
check("blocks: a missing text side reads as the description", B.fallbackText("Fake", decl) === "_(Fake: a made-up card; drawn in the app only)_")

// A plugin's settings, declared like block options plus a label (core/blocks.ts SettingDecl).
const setting = { trigger: { type: "enum", values: ["auto", "hover"], default: "auto", preview: true, label: "Show a preview", labels: { auto: "Auto" }, description: "when it shows" },
  delay: { type: "number", default: 500, min: 0, label: "Delay", description: "how long first, in ms" }, file: { type: "string", label: "File", description: "a file" } }
check("settings: a sound declaration has no problems (a key named like a common block option too)", !B.settingDeclProblems(setting, "m").length, B.settingDeclProblems(setting, "m"))
const badSettings = B.settingDeclProblems({ a: { type: "boolean", description: "x" }, b: { type: "enum", values: ["x"], labels: { y: "Y" }, label: "B", description: "x" },
  c: { type: "number", default: "five", label: "C", description: "x" }, d: { type: "boolean", required: true, label: "D", description: "x" }, e: "nope",
  f: { type: "number", preview: true, label: "F", description: "x" } }, "m")
check("settings: a declaration's own problems", ["setting 'a' needs a label", "setting 'b': labels names 'y'", "setting 'c': its default should be a number",
  "setting 'd': a setting is never required", "setting 'e' must be an object", "setting 'f': preview is true, on an enum"].every((w) => badSettings.some((b) => b.includes(w))), badSettings)
const oddValues = (() => { try { return B.settingDeclProblems({ g: { type: "list", values: 5, default: ["a"], label: "G", description: "x" }, h: { type: "enum", values: 7, default: "a", labels: { a: "A" }, label: "H", description: "x" } }, "m") } catch (e) { return [`threw: ${e}`] } })()
check("settings: values that aren't a list are a problem, the default checked without them, never a crash", oddValues.filter((p: string) => p.includes("values must be a list")).length === 2 && !oddValues.some((p: string) => p.startsWith("threw")), oddValues)
check("settings: not an object", B.settingDeclProblems([], "m")[0]?.includes("settings must be an object") && !B.settingDeclProblems(undefined, "m").length)
check("settings: read from a manifest", Object.keys(B.settingsOf({ settings: setting })).join() === "trigger,delay,file" && !Object.keys(B.settingsOf({})).length)
check("settings: the doc for AIs", B.settingsDoc("page-preview", setting as never).startsWith("Settings, `.vaultite/plugins/page-preview/data.json` (each optional; the plugin's settings in the app too):\n- `trigger` (one of auto, hover, default auto): when it shows")
  && B.settingsDoc("x", {}) === "", B.settingsDoc("page-preview", setting as never))

// The editor's suggestions inside a block's fence (web/src/editor/blockOptions.ts).
// (CodeMirror's CompletionContext needs a page; the source reads only its state, pos and explicit)
const { EditorState } = await import("@codemirror/state")
const { blockOptionSource } = await import("../../../web/src/editor/blockOptions.ts")
const source = blockOptionSource((name) => (name === "card" ? decl : null))
const at = (doc: string, explicit = false) => {
  const pos = doc.indexOf("|"), text = doc.replace("|", "")
  const ctx = { state: EditorState.create({ doc: text }), pos, explicit } as unknown as Parameters<typeof source>[0]
  return source(ctx) as { from: number; options: { label: string }[] } | null
}
const keys = at("```block-card\nlimit: 3\nli|\n```")
check("editor: a block's options suggested at a line's start, not the ones it has", !!keys && keys.options.some((o) => o.label === "view")
  && keys.options.some((o) => o.label === "wide") && !keys.options.some((o) => o.label === "limit"), keys?.options.map((o) => o.label))
const vals = at("```block-card\nview: |\n```")
check("editor: an enum's values after its key", vals?.options.map((o) => o.label).join() === "table,list", vals?.options)

// A note's indent is its own when it has one, as VS Code does (web/src/editor/languages.ts); the setting otherwise.
const { ownIndent } = await import("../../../web/src/editor/languages.ts")
check("editor: a note indented with 2 spaces keeps 2", ownIndent("- a\n  - b\n    - c\n", true) === "  ")
check("editor: a note indented with tabs keeps tabs", ownIndent("- a\n\t- b\n", true) === "\t")
check("editor: a note with no indented line has none of its own", ownIndent("# A\n\n- a\n- b\n", true) === null)
check("editor: a note's frontmatter and code blocks don't count", ownIndent("---\ntags:\n  - x\n---\n- a\n```js\n    f()\n```\n", true) === null
  && ownIndent("---\ntags:\n  - x\n---\n- a\n\t- b\n", true) === "\t")
check("editor: true and false with the enum's", at("```block-card\narchived: o|\n```")?.options.map((o) => o.label).join() === "only,true,false")
check("editor: nothing outside a block, in another fence, or in an undeclared block", !at("text\nli|") && !at("```js\nli|\n```") && !at("```block-other\nli|\n```")
  && !at("```block-card\n```\nli|"))
check("editor: an empty line only when asked", !at("```block-card\n|\n```") && !!at("```block-card\n|\n```", true))
