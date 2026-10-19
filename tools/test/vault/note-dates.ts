import fs from "node:fs"
import path from "node:path"
import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, read, sentBy, vault, write } = $
  // ---------- Note dates: new plain notes get created and updated; an edit of their text in the app moves updated ----------
  vault.setConfig("plugins/note-dates/data", {}) // (the harness turns its dates off: its defaults here)
  const as = (client: string | null, agent: string | null, method: string, p: string, body: unknown) => api(method, p, body, sentBy(client, agent))
  const val = (rel: string, key: string) => /^(\w+): '?([^'\n]*)'?$/m.exec(read(rel).split("\n").find((l) => l.startsWith(`${key}:`)) ?? "")?.[2] ?? null
  const STAMP = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/
  const OLD = "2020-01-02 03:04:05"

  await as("app/desktop", null, "PUT", "file", { path: "Dated/Plain.md", text: "Just text.\n" })
  const made = read("Dated/Plain.md")
  check("note dates: a new plain note gets created and updated (local time, one write), its text kept",
    /^---\ncreated: '\d{4}-\d\d-\d\d \d\d:\d\d:\d\d'\nupdated: '[^']+'\n---\n\nJust text\.\n$/.test(made) && STAMP.test(val("Dated/Plain.md", "created")!)
      && val("Dated/Plain.md", "created") === val("Dated/Plain.md", "updated"), made)
  await as("app/phone", null, "POST", "file", { path: "Dated/Untitled.md", text: "", unique: true })
  await as("cli", "claude-code", "POST", "ops/file.write", { path: "Dated/By agent.md", text: "---\ntags: [A]   # mine\n---\nBody\n" })
  check("note dates: New note in the app, and an agent's through vau, too (the header's own lines kept)",
    STAMP.test(val("Dated/Untitled.md", "created") ?? "") && /^---\ntags: \[A\] {3}# mine\ncreated: '[^']+'\nupdated: '[^']+'\n/.test(read("Dated/By agent.md")),
    [read("Dated/Untitled.md"), read("Dated/By agent.md")])
  await as("mcp", null, "PUT", "file", { path: "Dated/Own.md", text: `---\ncreated: ${OLD}\n---\nImported.\n` })
  check("note dates: a date a new note is given stays", val("Dated/Own.md", "created") === OLD && STAMP.test(val("Dated/Own.md", "updated") ?? ""), read("Dated/Own.md"))

  // Not dated: other kinds, a kind that keeps its own (Notes), templates, hidden folders, other plugins' formats.
  await as("mcp", null, "POST", "people", { name: "Dated Person", relation: "friend" })
  await as("mcp", null, "PUT", "file", { path: "Dated/Board.md", text: "---\ntype: dashboard\n---\n" })
  await as("mcp", null, "PUT", "file", { path: "Templates/Dated template.md", text: "{{title}}\n" })
  await as("mcp", null, "PUT", "file", { path: "Dated/Kanban.md", text: "---\nkanban-plugin: board\n---\n\n## To do\n" })
  check("note dates: not on other kinds, templates or other plugins' formats",
    !/created|updated/.test(read("People/Dated Person.md") + read("Dated/Board.md") + read("Templates/Dated template.md") + read("Dated/Kanban.md")),
    [read("People/Dated Person.md"), read("Dated/Board.md"), read("Dated/Kanban.md")])
  await as("mcp", null, "POST", "notes", { title: "Dated kind note", body: "Hello.", ext_id: "dated-kind" })
  const kn = read("Notes/Dated kind note.md")
  check("note dates: a note of the Notes kind has its dates once, the kind's", kn.match(/^created:/gm)?.length === 1 && kn.match(/^updated:/gm)?.length === 1, kn)

  // Edits through the app: updated moves in the same write, only when the text changed.
  write("Dated/Plain.md", `---\ncreated: '${OLD}'\nupdated: '${OLD}'\n---\n\nJust text.\n`)
  await vault.sync()
  const base = read("Dated/Plain.md")
  let [code, f] = await as("app/desktop", null, "PUT", "file", { path: "Dated/Plain.md", text: base.replace("Just text.", "Just text, edited."), base })
  const bumped = val("Dated/Plain.md", "updated")
  check("note dates: an edit of its text moves updated, and the editor gets it in the save's answer (no second write)",
    code === 200 && bumped !== OLD && STAMP.test(bumped ?? "") && val("Dated/Plain.md", "created") === OLD && f.text === read("Dated/Plain.md"), [code, read("Dated/Plain.md")])
  write("Dated/Plain.md", read("Dated/Plain.md").replace(/updated: '[^']+'/, `updated: '${OLD}'`))
  await vault.sync()
  let cur = read("Dated/Plain.md")
  await as("app/desktop", null, "PUT", "file", { path: "Dated/Plain.md", text: cur.replace("---\n\n", "tags: [Trip]\n---\n\n"), base: cur })
  check("note dates: a change of its properties alone leaves updated", val("Dated/Plain.md", "updated") === OLD && read("Dated/Plain.md").includes("tags: [Trip]"), read("Dated/Plain.md"))
  cur = read("Dated/Plain.md")
  await as("cli", "codex", "PUT", "file", { path: "Dated/Plain.md", text: cur.replace(OLD + "'\ntags", "2021-05-05 05:05:05'\ntags").replace("edited.", "edited twice."), base: cur })
  check("note dates: a save that sets updated itself keeps its own", val("Dated/Plain.md", "updated") === "2021-05-05 05:05:05", read("Dated/Plain.md"))
  // Another device's save made on an older text: merged, then dated, never a conflict.
  write("Dated/Merge.md", `---\ncreated: '${OLD}'\nupdated: '${OLD}'\n---\n\nLine one.\n\nLine two.\n\nLine three.\n`)
  await vault.sync()
  const older = read("Dated/Merge.md")
  await as("app/desktop", null, "PUT", "file", { path: "Dated/Merge.md", text: older.replace("Line three.", "Line three, on the desktop."), base: older })
  ;[code] = await as("app/phone", null, "PUT", "file", { path: "Dated/Merge.md", text: older.replace("Line one.", "Line one, on the phone."), base: older })
  check("note dates: two devices' edits merge around it, no conflict", code === 200 && val("Dated/Merge.md", "updated") !== OLD
    && /on the phone\.\n\nLine two\.\n\nLine three, on the desktop\./.test(read("Dated/Merge.md")), [code, read("Dated/Merge.md")])
  write("Dated/Merge.md", read("Dated/Merge.md").replace(/updated: '[^']+'/, `updated: '${OLD}'`))
  await vault.sync()
  await as("cli", "claude-code", "POST", "ops/file.edit", { path: "Dated/Merge.md", old: "Line two.", new: "Line 2." })
  check("note dates: vau edit moves it too", val("Dated/Merge.md", "updated") !== OLD && read("Dated/Merge.md").includes("Line 2."), read("Dated/Merge.md"))

  // What the app didn't make or edit stays as it is.
  write("Dated/Old.md", "---\ntags: [x]\n---\nWritten before.\n")
  await vault.sync()
  cur = read("Dated/Old.md")
  await as("app/desktop", null, "PUT", "file", { path: "Dated/Old.md", text: cur.replace("before.", "before, edited."), base: cur })
  check("note dates: a note without updated gets none when edited (no backfill)", !/created|updated/.test(read("Dated/Old.md")), read("Dated/Old.md"))
  write("Dated/Own.md", read("Dated/Own.md").replace(/updated: '[^']+'/, `updated: '${OLD}'`).replace("Imported.", "Edited on disk."))
  await api("GET", "vault")
  check("note dates: a file changed on disk isn't dated", val("Dated/Own.md", "updated") === OLD, read("Dated/Own.md"))

  // Its settings: the keys' names (empty: off), and the app shows them as dates.
  check("note dates: the store says which keys it keeps in plain notes", JSON.stringify((await app.state()).noteStamps) === '["created","updated"]', (await app.state()).noteStamps)
  vault.setConfig("plugins/note-dates/data", { created: "date", updated: "" })
  await as("app/desktop", null, "PUT", "file", { path: "Dated/Renamed.md", text: "Hi.\n" })
  check("note dates: its keys are settings, an empty one off", /^---\ndate: '[^']+'\n---\n/.test(read("Dated/Renamed.md")), read("Dated/Renamed.md"))
  vault.setConfig("plugins/note-dates/data", {})
  const conf = vault.config("plugins")
  await api("PUT", "config/plugins", { ...conf, disabled: [...(conf.disabled ?? []), "note-dates"] })
  await as("app/desktop", null, "PUT", "file", { path: "Dated/Off.md", text: "Off.\n" })
  check("note dates: turned off, new notes get none", read("Dated/Off.md") === "Off.\n" && (await app.state()).noteStamps === undefined, read("Dated/Off.md"))
  await api("PUT", "config/plugins", conf)

  vault.setConfig("plugins/note-dates/data", { created: "", updated: "" })
  for (const f of ["Dated", "Templates/Dated template.md", "People/Dated Person.md", "Notes/Dated kind note.md"]) fs.rmSync(path.join(VAULT, f), { recursive: true, force: true })
}
