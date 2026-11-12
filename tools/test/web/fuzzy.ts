import { check } from "../lib.ts"
import { web } from "./lib.ts"

// ---------- Fuzzy matching (web/src/core/fuzzy.ts): the palette, the quick switcher and the pickers ----------
type M = { score: number; marks: number[]; tier: number }
const { fuzzy, hasWords, startsWords, stem, TIER }: { fuzzy(q: string, s: string): M | null; hasWords(q: string, s: string): boolean
  startsWords(q: string, s: string): boolean; stem(w: string): string; TIER: Record<string, number> } = await web("core/fuzzy.ts")
const { rankCommands }: { rankCommands<T>(cs: T[], q: string): (T & { name: string; marks: number[] })[] } = await web("core/paletterank.ts")
const shown = (q: string, s: string) => { const m = fuzzy(q, s); return m ? m.marks.map((i) => s[i]).join("") : null }
const rank = (q: string, list: string[]) => list.filter((s) => fuzzy(q, s)).sort((a, b) => fuzzy(q, b)!.score - fuzzy(q, a)!.score)
check("fuzzy: words in any order ('settings graph' finds Open graph view settings), each marked",
  shown("settings graph", "Open graph view settings") === "graphsettings", shown("settings graph", "Open graph view settings"))
check("fuzzy: parts of words, in any order, as typed or by letters", shown("sett gra", "Open graph view settings") === "grasett"
  && shown("vw grph", "Open graph view settings") === "grphvw" && fuzzy("settings graph", "Open settings") === null && fuzzy("graph zzz", "Open graph view") === null,
  [shown("sett gra", "Open graph view settings"), shown("vw grph", "Open graph view settings")])
const cmds = ["Open graph view settings", "Open settings", "Graph settings", "Open local graph", "Toggle line numbers"]
check("fuzzy: the phrase as typed first, then words in order, then out of order",
  rank("graph settings", ["Settings for the graph", "Graph view settings", "Graph settings"]).join("|") === "Graph settings|Graph view settings|Settings for the graph",
  rank("graph settings", ["Settings for the graph", "Graph view settings", "Graph settings"]))
check("fuzzy: every word as typed beats one matched only by its letters",
  rank("open graph", ["Open grand map path", "Open local graph"]).join("|") === "Open local graph|Open grand map path", rank("open graph", ["Open grand map path", "Open local graph"]))
check("fuzzy: the typed order scores more than the same words reversed, on the same name",
  fuzzy("graph settings", cmds[0])!.score > fuzzy("settings graph", cmds[0])!.score)
check("fuzzy: one word: a whole word, the shorter name first; letters in order still match",
  JSON.stringify(fuzzy("graph", "Open graph view")?.marks) === "[5,6,7,8,9]" && JSON.stringify(fuzzy("ogv", "Open graph view")?.marks) === "[0,5,11]"
  && fuzzy("xyz", "Open graph view") === null && rank("graph", cmds).join("|") === "Graph settings|Open local graph|Open graph view settings", rank("graph", cmds))
check("fuzzy: a word marked at a word's start when it's in one ('set': settings, not reset)", shown("set", "Reset settings") === "set" && fuzzy("set", "Reset settings")!.marks[0] === 6)
check("fuzzy: nothing typed matches everything, unmarked", JSON.stringify(fuzzy("  ", "Anything")) === JSON.stringify({ score: 0, marks: [], tier: TIER.NAME }))
// The cause of 2026-11-10's misses: a typed word had to be in the name letter for letter, and the name's start outranked a whole word.
const stems = ["files:file", "terminals:terminal", "opening:open", "opened:open", "matches:match", "entries:entry", "boxes:box", "settings:set", "running:run",
  "status:status", "class:class", "string:string", "speed:speed", "falling:fall", "tab:tab"]
check("fuzzy: a light stem: plurals and -ing/-ed off, short and -ss/-us words kept", stems.every((x) => { const [w, s] = x.split(":"); return stem(w) === s }),
  stems.map((x) => stem(x.split(":")[0])))
check("fuzzy: a plural or another form typed meets the word ('files': File explorer, by its other names)",
  fuzzy("files", "File explorer file tree tree explorer")?.tier === TIER.WORD && shown("terminals", "Open terminal") === "terminal"
  && shown("opening", "Open daily note") === "Open" && fuzzy("notes", "Daily note")?.tier === TIER.WORD, [fuzzy("files", "File explorer file tree tree explorer"), shown("terminals", "Open terminal")])
check("fuzzy: a form typed ranks with the word as typed, above a name that only starts with it",
  rank("tabs", ["Tab switcher", "Tabsy plugin"]).join("|") === "Tab switcher|Tabsy plugin" && rank("file", ["Profile", "Filed away", "File tree"]).join("|") === "File tree|Filed away|Profile",
  [rank("tabs", ["Tab switcher", "Tabsy plugin"]), rank("file", ["Profile", "Filed away", "File tree"])])
check("fuzzy: tiers: whole word > word start > inside a word > letters, whatever the length or place",
  rank("note", ["Xnote", "Notebook", "Open the daily note for today and more", "N o t e"]).join("|") === "Open the daily note for today and more|Notebook|Xnote|N o t e",
  rank("note", ["Xnote", "Notebook", "Open the daily note for today and more", "N o t e"]))
check("fuzzy: the name's start no longer outranks a whole word ('terminal': Open terminal first, the shorter)",
  rank("terminal", ["Terminal cursor", "Open terminal"]).join("|") === "Open terminal|Terminal cursor", rank("terminal", ["Terminal cursor", "Open terminal"]))
check("fuzzy: a name that is all the words typed comes first", fuzzy("terminal", "Terminal")?.tier === TIER.NAME
  && rank("daily note", ["Open daily note", "Daily notes", "Daily note template"]).join("|") === "Daily notes|Open daily note|Daily note template",
  rank("daily note", ["Open daily note", "Daily notes", "Daily note template"]))
check("fuzzy: the weakest word decides: two whole words beat a whole word and loose letters",
  rank("close tabs", ["Close the tag bars", "Close other tabs"]).join("|") === "Close other tabs|Close the tag bars", rank("close tabs", ["Close the tag bars", "Close other tabs"]))
check("fuzzy: camelCase and file names split into words", shown("tree", "FileTree.tsx") === "Tree" && fuzzy("tsx", "FileTree.tsx")?.tier === TIER.WORD)
check("has words: every word as typed or by a stem of 4 letters, any order", hasWords("tabs alice", "Alice Park\nOpen tabs") && !hasWords("tabs bob", "Alice Park\nOpen tabs")
  && hasWords("files", "File explorer") && hasWords("terminals", "Open terminal") && !hasWords("settings", "Reset"))
check("starts words: each typed word starts one, by its stem too", startsWords("files", "file tree") && startsWords("expl tre", "file tree explorer")
  && startsWords("opening", "open") && !startsWords("ree", "file tree"))
// The palette: commands and settings in one list.
const pal = [{ id: "terminal:open", name: "Open terminal" }, { id: "setting:cursor", name: "Terminal cursor", on: () => true },
  { id: "setting:font", name: "Terminal font", value: () => "Menlo" }, { id: "terminal:close", name: "Close all terminals" },
  { id: "panel:files", name: "Show file explorer", words: "file tree explorer" }, { id: "x", name: "Turn on termites" }]
const names = (q: string) => rankCommands(pal, q).map((c) => c.name).join("|")
check("palette: between equal matches what one goes to or does comes before a setting ('terminal')",
  names("terminal") === "Open terminal|Close all terminals|Terminal font|Terminal cursor", names("terminal"))
check("palette: a better match still wins over the kind ('terminal cursor': the setting)", names("terminal cursor").startsWith("Terminal cursor"), names("terminal cursor"))
check("palette: found by its other words, by their stems too, after every match by name", names("files") === "Show file explorer"
  && rankCommands(pal, "files")[0].marks.join() === "5,6,7,8" && names("tre exp") === "Show file explorer", [names("files"), names("tre exp")])
