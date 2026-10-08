// The skills for agents (skills/<name>/SKILL.md): short, pointing at vau docs; their parts that repeat a doc are
// generated here between markers (node tools/skills.ts), checked by npm run check (skillProblems).
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const SKILLS = path.join(ROOT, "skills")
/** Bytes a SKILL.md may have: an agent reads all of it once the skill is picked. */
const SKILL_MAX = 4_000
const START = /<!-- generated: [^\n]*-->\n/, END = "<!-- end generated -->"

/** The vault's rules as a new vault's .vaultite/AGENTS.md has them (the built-in plugins on by default), without its
 *  title and the user's part. Needs the app's plugins loaded (an App made). */
async function rules() {
  const { rulesText, OWN } = await import("../plugins/core/agent-files/plugin.ts")
  const text = rulesText("")
  return text.slice(0, text.indexOf(OWN)).replace(/^# .*\n+/, "").trim()
}

/** Each skill's generated part, by the skill's name. */
const GENERATED: Record<string, () => Promise<string>> = { "vaultite-vault": rules }

const skillFiles = () => (fs.existsSync(SKILLS) ? fs.readdirSync(SKILLS).sort() : [])
  .map((n) => [n, path.join(SKILLS, n, "SKILL.md")] as const).filter(([, f]) => fs.existsSync(f))

/** The text with its generated part replaced, or null when it has no markers. */
function withPart(text: string, part: string) {
  const s = START.exec(text), e = text.indexOf(END)
  if (!s || e < s.index) return null
  return text.slice(0, s.index + s[0].length) + part + "\n" + text.slice(e)
}

/** The `vau ...` command lines in a skill's code (inline or a block), each as its words up to a placeholder or flag. */
function mentions(text: string) {
  const blocks = [...text.matchAll(/^```.*\n([\s\S]*?)^```/gm)].flatMap((b) => [...b[1].matchAll(/^\s*vau (.+)$/gm)].map((m) => m[1]))
  return [...[...text.matchAll(/`vau ([^`\n]+)`/g)].map((m) => m[1]), ...blocks].map((line) => {
    const words: string[] = []
    for (const w of line.trim().split(/\s+/)) {
      if (!/^[a-z][\w.-]*$/.test(w)) break
      words.push(w)
    }
    return words
  })
}

/** What vau has: its own commands, the operations, and whether `vau docs <topic>` answers. */
type Catalog = { commands: string[]; ops: { id: string; cli?: string }[]; topic: (name: string) => Promise<boolean> }

/** Why `vau <words>` wouldn't run, as core/cli.ts reads a command line, or null. */
async function unknown(words: string[], c: Catalog) {
  const [w, ...rest] = words
  if (!w || c.commands.includes(w)) return null
  if (w === "docs" && rest[0] && !await c.topic(rest[0])) return `no docs topic '${rest[0]}'`
  const said = (o: { cli?: string }) => (o.cli ?? "").split(" ").filter(Boolean)
  if (c.ops.some((o) => o.id === w || (o.cli && said(o).every((x, i) => words[i] === x)))) return null
  // (a group's name alone lists its ops: `vau bundle`)
  if (!rest.length && c.ops.some((o) => o.cli?.startsWith(`${w} `) || o.id.startsWith(`${w}.`))) return null
  return `no command 'vau ${words.join(" ")}'`
}

/** What's wrong with the skills. */
export async function skillProblems(c: Catalog) {
  const problems: string[] = []
  for (const [name, file] of skillFiles()) {
    const text = fs.readFileSync(file, "utf8"), at = path.relative(ROOT, file)
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ""
    const field = (k: string) => new RegExp(`^${k}:[ \\t]*(.*)$`, "m").exec(fm)?.[1].trim() ?? ""
    if (field("name") !== name) problems.push(`${at}: its name (frontmatter) is '${field("name")}', not its folder's, ${name}`)
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) problems.push(`${at}: a skill's name is lowercase letters, digits and single dashes, at most 64`)
    const about = field("description")
    if (!about || about.length > 1024) problems.push(`${at}: needs a description (one line, at most 1024 characters): what it does and when to use it`)
    const size = Buffer.byteLength(text)
    if (size > SKILL_MAX) problems.push(`${at} is ${size} bytes (at most ${SKILL_MAX}): point at vau docs rather than say it here`)
    if (GENERATED[name]) {
      const want = withPart(text, await GENERATED[name]())
      if (want === null) problems.push(`${at}: lost its generated part's markers`)
      else if (want !== text) problems.push(`${at}: its generated part is out of date: node tools/skills.ts`)
    }
    for (const words of mentions(text)) {
      const why = await unknown(words, c)
      if (why) problems.push(`${at}: ${why}`)
    }
  }
  return problems
}

/** Write each skill's generated part. */
export async function writeSkills() {
  for (const [name, file] of skillFiles()) {
    if (!GENERATED[name]) continue
    const text = fs.readFileSync(file, "utf8"), want = withPart(text, await GENERATED[name]())
    if (want === null) throw new Error(`${path.relative(ROOT, file)}: no generated part's markers`)
    if (want !== text) {
      fs.writeFileSync(file, want)
      console.log(`Wrote ${path.relative(ROOT, file)}.`)
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // (the app's plugins load into a throwaway vault, like npm run check's)
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-skills-"))
  process.env.VAULTITE_LOCAL = path.join(scratch, "local")
  const { App } = await import("../core/app.ts")
  await new App(path.join(scratch, "vault")).init()
  await writeSkills()
  fs.rmSync(scratch, { recursive: true, force: true })
  process.exit(0)
}
