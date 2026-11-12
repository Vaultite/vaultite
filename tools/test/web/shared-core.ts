import path from "node:path"
import { pathToFileURL } from "node:url"
import { check } from "../lib.ts"
import { fm, type Props, ROOT, same } from "./lib.ts"

// ---------- CSV (core/csv.ts, shared): the separator a spreadsheet used, and how many records ----------
{
  const csv: { parseCsv(t: string): string[][]; csvRecords(t: string): Record<string, string>[] } = await import(pathToFileURL(path.join(ROOT, "core", "csv.ts")).href)
  check("csv: ; and tab separated files read as columns, a ; inside quotes stays", same(csv.parseCsv("a;b\n1;2\n"), [["a", "b"], ["1", "2"]])
    && same(csv.parseCsv("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]) && same(csv.parseCsv('x,y\n"1;2",3\n'), [["x", "y"], ["1;2", "3"]]), csv.parseCsv("a;b\n1;2\n"))
  check("csv: records as parsed (a quoted line break, an empty row)", csv.csvRecords('n,note\r\n"Lee, Sam","a\r\nb"\r\n,,\r\n').length === 1)
  check("csv: a repeated column name is numbered, both values kept", same(csv.csvRecords("n,Tags,Tags,Tags\nA,x,y,z\n"), [{ n: "A", Tags: "x", "Tags 2": "y", "Tags 3": "z" }]))
}

// ---------- Dates (core/dates.ts, shared): moment's formats, weeks from a chosen day, read back strictly or loosely ----------
{
  const { formatDate: f, parseDate: p } = await import(pathToFileURL(path.join(ROOT, "core", "dates.ts")).href) as typeof import("../../../core/dates.ts")
  const d = new Date(2027, 0, 2, 15, 4)
  check("dates: formats, ISO weeks and US ones", f(d, "dddd, MMMM Do YYYY [at] h:mm a") === "Saturday, January 2nd 2027 at 3:04 pm"
    && f(d, "GGGG-[W]WW gggg-[W]ww") === "2026-W53 2026-W53" && f(d, "gggg-[W]ww", { start: 0, jan: 1 }) === "2027-W01", f(d, "GGGG-[W]WW gggg-[W]ww"))
  check("dates: a week's name read as its first day; a name the format doesn't write isn't one", p("2027-W01", "gggg-[W]ww", { start: 0, jan: 1 })?.getDate() === 27
    && p("2026-13-01", "YYYY-MM-DD") === null && p("2026-10-06 Notes", "YYYY-MM-DD") === null && p("2026-10-06 Notes", "YYYY-MM-DD", { loose: true })?.getDate() === 6)
}

// ---------- A file's type and archiving (core/fileprops.ts, shared): one rule on both sides ----------
{
  const fp: { effectiveType(kind: string | null | undefined, fm: Props | null): string | null; isArchived(x: object | null | undefined): boolean; setMarks(m: Record<string, unknown>[]): void } =
    await import(pathToFileURL(path.join(ROOT, "core", "fileprops.ts")).href)
  check("type: a kind's type wins; else the frontmatter's; else none", fp.effectiveType("person", { type: "note" }) === "person" &&
    fp.effectiveType(null, { type: "dashboard" }) === "dashboard" && fp.effectiveType(null, { type: 3 }) === null && fp.effectiveType(null, {}) === null)
  check("type: no mark without a plugin that declares it", fp.effectiveType(null, { "kanban-plugin": "board" }) === null)
  fp.setMarks([{ marks: { "kanban-plugin": "kanban" } }])
  check("type: a plugin's mark types a file without one (kanban-plugin: board is kanban)", fp.effectiveType(null, { "kanban-plugin": "board" }) === "kanban" &&
    fp.effectiveType(null, { type: "note", "kanban-plugin": "board" }) === "note" && fp.effectiveType(null, { "kanban-plugin": "" }) === null && fp.effectiveType(null, { "other-plugin": "x" }) === null)
  fp.setMarks([])
  // The file view works it out for the file being edited: its row's type when a kind owns it, else what's typed.
  const row = { kind: "people", type: "person" }
  check("type: the file being edited keeps its kind's type, whatever is typed", fp.effectiveType(row.kind ? row.type : null, { type: "dashboard" }) === "person")
  check("archived: true or yes archive; a date, false, no or nothing don't", fp.isArchived({ archived: true }) && fp.isArchived({ archived: "yes" }) &&
    !fp.isArchived({ archived: "2026-09-01" }) && !fp.isArchived({ archived: false }) && !fp.isArchived({ archived: "no" }) && !fp.isArchived({}) && !fp.isArchived(undefined))
  // What a file's properties become after Archive and Unarchive (the app's setProperty is setProp on the file's header).
  const head = "---\ntype: note\ntags: [a]  # mine\n---\n"
  const on = fm.setProp(head, "archived", true)
  check("archived: Archive adds one line, Unarchive takes it away", on === "---\ntype: note\ntags: [a]  # mine\narchived: true\n---\n" && fm.setProp(on, "archived", undefined) === head, on)
}

// ---------- Excluded files and the attachment folder (core/fileprops.ts), written as Obsidian writes them ----------
{
  const fp: { excluder(f: unknown): (rel: string) => boolean; attachmentDir(spec: string, from: string): string } =
    await import(pathToFileURL(path.join(ROOT, "core", "fileprops.ts")).href)
  const ex = fp.excluder(["Archive/", "/^Daily\\/\\d{4}-01/", "/(/", 3, " "])
  check("excluded: a path they start with, or a /regex/; a broken one or not text is nothing", ex("Archive/Old.md") && ex("Daily/2026-01-02.md") &&
    !ex("Daily/2026-02-02.md") && !ex("Notes/Archive/Old.md") && !fp.excluder(undefined)("Archive/x.md"))
  check("attachments: / the top, ./ beside the note, ./sub beside it, else that folder", fp.attachmentDir("/", "A/B/N.md") === "" &&
    fp.attachmentDir("./", "A/B/N.md") === "A/B" && fp.attachmentDir("./assets/", "A/N.md") === "A/assets" && fp.attachmentDir("./assets", "N.md") === "assets" &&
    fp.attachmentDir("Files/Pasted/", "A/N.md") === "Files/Pasted")
}

// ---------- File names from titles: ones every system (Windows too, where a vault may sync) can have ----------
{
  const { safeName } = await import(pathToFileURL(path.join(ROOT, "core", "vault.ts")).href)
  const pairs = [["CON", "CON_"], ["nul.md", "nul.md_"], ["Notes...", "Notes"], ["a: b?", "a - b"], ["Trip. ", "Trip"], ["\u0007Bell", "Bell"],
    ["COM1 plan", "COM1 plan"], ["", "Untitled"]]
  const off = pairs.filter(([t, want]) => safeName(t) !== want)
  check("names: no Windows device name, trailing dot or control character", !off.length, off.map(([t]) => [t, safeName(t)]))
}
