/** The vault's rules for AIs, `.vaultite/AGENTS.md`: core/AGENTS.md, each plugin's `forAgents` line, then the user's
 *  own under OWN, always kept. With `rootFiles` on, one pointer line in the vault's AGENTS.md and CLAUDE.md; off, it goes
 *  (and a file the app made for it). */
import fs from "node:fs"
import path from "node:path"
import { agentLines, LOADED, Plugin, ROOT, WriteRefused } from "../../../core/plugins.ts"
import { fetchFromICloud, writeAtomic } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

/** Where the rules are, from the vault's top. */
export const RULES = ".vaultite/AGENTS.md"
/** The heading the user's own rules go under, at the file's end, and the line the app keeps under it. */
export const OWN = "## Your own rules"
const OWN_NOTE = "<!-- The app rewrites everything above this heading; what you write under it stays. -->"

/** The line each file gets: CLAUDE.md imports the rules; AGENTS.md says where they are. */
export const LINES: Record<string, string> = {
  "AGENTS.md": "Before writing in this vault, read `.vaultite/AGENTS.md`: how the Vaultite app reads these files.",
  "CLAUDE.md": "@.vaultite/AGENTS.md",
}

/** The file's text, null when it isn't there. Any other failure throws: read as no file, the rewrite would drop the
 *  user's own rules. */
const read = (p: string) => {
  try { return fs.readFileSync(p, "utf8") } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null
    fetchFromICloud(p, e) // (a placeholder another Mac's write left: asked for, read at a later sync)
    throw e
  }
}
/** iCloud's placeholder of a file another Mac wrote (errno 11): not yet here, not a failure. */
const notHereYet = (e: unknown) => Math.abs((e as NodeJS.ErrnoException)?.errno ?? 0) === 11

/** The user's own rules in the file's text: what's under OWN (the app's note there left out), or "". */
export function ownPart(text: string | null) {
  if (!text) return ""
  const lines = text.split("\n"), at = lines.findIndex((l) => l.trim() === OWN)
  if (at < 0) return ""
  return lines.slice(at + 1).filter((l) => l.trim() !== OWN_NOTE).join("\n").trim()
}

/** The rules as the app writes them: the core's, the plugins' lines (this one's is the pointer, left out here), the
 *  user's own. */
export function rulesText(own: string) {
  const core = fs.readFileSync(path.join(ROOT, "core", "AGENTS.md"), "utf8").trim()
  const lines = agentLines(plugin.vault, LOADED).filter((l) => l.plugin !== plugin.id).map((l) => `- ${l.text}`)
  return [core, lines.length ? `## Plugins\n${lines.join("\n")}` : "", `${OWN}\n${OWN_NOTE}${own ? `\n\n${own}` : ""}`].filter(Boolean).join("\n\n") + "\n"
}

/** The root files the app made for its line (none was there), in `made.json`: only those it may delete again. */
const made = () => (plugin.settings({}, "made").files ?? []) as string[]
const setMade = (files: string[]) => plugin.saveSettings(files.length ? { files } : null, "made")

/** Add the pointer line to the end of `name`, or take it out. Returns whether the file changed. */
export function point(abs: (rel: string) => string, name: string, on: boolean) {
  const file = abs(name), line = LINES[name], cur = read(file)
  const lines = cur === null ? [] : cur.split("\n")
  const has = lines.some((l) => l.trim() === line)
  if (on === has) return false
  if (on) {
    writeAtomic(file, cur === null || cur === "" ? line + "\n" : cur.replace(/\n*$/, "\n\n") + line + "\n")
    if (cur === null && !made().includes(name)) setMade([...made(), name])
    return true
  }
  const rest = lines.filter((l) => l.trim() !== line).join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "")
  // (a file of the user's stays even when only the line was in it: the app deletes only what it made)
  if (rest.trim() === "" && made().includes(name)) fs.rmSync(file)
  else writeAtomic(file, rest.trim() === "" ? "" : rest + "\n")
  if (made().includes(name)) setMade(made().filter((n) => n !== name))
  return true
}

/** Write the rules (on), or leave only the user's part of them (off: none, no file). */
export function writeRules(on: boolean) {
  const file = plugin.vault.abs(RULES), cur = read(file), own = ownPart(cur)
  const want = on ? rulesText(own) : own ? `${OWN}\n\n${own}\n` : null
  if (want === cur) return
  if (want === null) fs.rmSync(file, { force: true })
  else writeAtomic(file, want)
}

let pointed: boolean | null = null
let written = ""
function apply() {
  const v = plugin.vault, on = !plugin.isOff()
  // (what the rules are made of changes only with the settings, the app or the vault's plugins)
  const key = `${v.path}:${on}:${v.settingsVersion}:${LOADED.map((p) => p.id).join(",")}`
  if (key !== written) { writeRules(on); written = key }
  const pointing = on && plugin.settings().rootFiles === true
  if (pointing === pointed) return
  for (const name of Object.keys(LINES)) point((rel) => v.abs(rel), name, pointing)
  pointed = pointing // (after: one refused is tried again)
}

// A failed write is tried again after a wait that doubles up to 5 minutes, not at every sync (which run many times a
// second while files change: a refused write, EPERM, made hundreds of errors in minutes).
let failures = 0, retryAt = 0, refusedAt = -1
plugin.onSync(() => {
  if (Date.now() < retryAt) return
  // (refused by the write gate: again once the settings change, the user's answer among them)
  if (refusedAt === plugin.vault.settingsVersion) return
  try {
    apply()
    failures = 0
    refusedAt = -1
  } catch (e) {
    // (iCloud downloading it: tried again in a moment, quietly; it logged thousands of these on a Mac sharing the vault)
    if (notHereYet(e)) { retryAt = Date.now() + 10_000; return }
    // (the root files wait for the user's yes, asked by the app: core/grants.ts; the gate said so once)
    if (e instanceof WriteRefused) { refusedAt = plugin.vault.settingsVersion; return }
    retryAt = Date.now() + Math.min(5 * 60_000, 2_000 * 2 ** failures++)
    console.error("agent-files:", e)
  }
})
