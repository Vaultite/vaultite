import fs from "node:fs"
import { z } from "zod"
import path from "node:path"
import { agentLines, LOADED, Plugin, ROOT, WriteRefused } from "../../../core/plugins.ts"
import { fetchFromICloud, writeAtomic } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

const ERRNO = z.object({ errno: z.number() })
const MADE = z.array(z.string()).catch([])

export const RULES = ".vaultite/AGENTS.md"
export const OWN = "## Your own rules"
const OWN_NOTE = "<!-- The app rewrites everything above this heading; what you write under it stays. -->"

export const LINES: Record<string, string> = {
  "AGENTS.md": "Before writing in this vault, read `.vaultite/AGENTS.md`: how the Vaultite app reads these files.",
  "CLAUDE.md": "@.vaultite/AGENTS.md",
}

const read = (p: string) => {
  try { return fs.readFileSync(p, "utf8") } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return null
    fetchFromICloud(p, e)
    throw e
  }
}
/** iCloud's placeholder of a file another Mac wrote (errno 11): not yet here, not a failure. */
const notHereYet = (e: unknown) => Math.abs(ERRNO.safeParse(e).data?.errno ?? 0) === 11

function ownPart(text: string | null) {
  if (!text) return ""
  const lines = text.split("\n"), at = lines.findIndex((l) => l.trim() === OWN)
  if (at < 0) return ""
  return lines.slice(at + 1).filter((l) => l.trim() !== OWN_NOTE).join("\n").trim()
}

export function rulesText(own: string) {
  const core = fs.readFileSync(path.join(ROOT, "core", "AGENTS.md"), "utf8").trim()
  const lines = agentLines(plugin.vault, LOADED).filter((l) => l.plugin !== plugin.id).map((l) => `- ${l.text}`)
  return [core, lines.length ? `## Plugins\n${lines.join("\n")}` : "", `${OWN}\n${OWN_NOTE}${own ? `\n\n${own}` : ""}`].filter(Boolean).join("\n\n") + "\n"
}

const made = () => MADE.parse(plugin.settings({}, "made").files ?? [])
const setMade = (files: string[]) => plugin.saveSettings(files.length ? { files } : null, "made")

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
  if (rest.trim() === "" && made().includes(name)) fs.rmSync(file)
  else writeAtomic(file, rest.trim() === "" ? "" : rest + "\n")
  if (made().includes(name)) setMade(made().filter((n) => n !== name))
  return true
}

let wanted: string | null | undefined

function writeRules(on: boolean) {
  const file = plugin.vault.abs(RULES), cur = read(file), own = ownPart(cur)
  const want = on ? rulesText(own) : own ? `${OWN}\n\n${own}\n` : null
  if (want === cur) return void (wanted = want)
  if (want === wanted && cur !== null) return
  if (want === null) fs.rmSync(file, { force: true })
  else writeAtomic(file, want)
  wanted = want
}

let pointed: boolean | null = null
let written = ""
function apply() {
  const v = plugin.vault, on = !plugin.isOff()
  const key = `${v.path}:${on}:${v.settingsVersion}:${LOADED.map((p) => p.id).join(",")}`
  if (key !== written && v.writerHere) { writeRules(on); written = key }
  const pointing = on && plugin.settings().rootFiles === true
  if (pointing === pointed) return
  for (const name of Object.keys(LINES)) point((rel) => v.abs(rel), name, pointing)
  pointed = pointing
}

let failures = 0, retryAt = 0, refusedAt = -1
plugin.onSync(() => {
  if (Date.now() < retryAt) return
  if (refusedAt === plugin.vault.settingsVersion) return
  try {
    apply()
    failures = 0
    refusedAt = -1
  } catch (e) {
    if (notHereYet(e)) { retryAt = Date.now() + 10_000; return }
    if (e instanceof WriteRefused) { refusedAt = plugin.vault.settingsVersion; return }
    retryAt = Date.now() + Math.min(5 * 60_000, 2_000 * 2 ** failures++)
    console.error("agent-files:", e)
  }
})
