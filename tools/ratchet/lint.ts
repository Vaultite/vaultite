import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as z from "zod"
import { ROOT } from "../quality/files.ts"

const Diagnostic = z.object({
  code: z.string(),
  message: z.string(),
  filename: z.string(),
  labels: z.array(z.object({ span: z.object({ line: z.number(), column: z.number() }) })),
})
const Report = z.object({ diagnostics: z.array(Diagnostic) })

/** One rule's finding: where, the text of its line (what matches it across a move), and how much it counts. */
export type Finding = { rule: string; file: string; line: number; text: string; weight: number; message: string }

export const SIZE = /^eslint\((max-lines|max-lines-per-function|complexity)\)$/
const OXLINT = path.join(ROOT, "node_modules", "oxlint", "bin", "oxlint")

/** Size rules count how far past their limit a file or function is, so moving code between files changes nothing. */
function weightOf(rule: string, message: string, limits: Map<string, number>) {
  const m = SIZE.exec(rule)
  if (!m) return 1
  const n = Number(/\((\d+)\)|complexity of (\d+)/.exec(message)?.slice(1).find(Boolean) ?? 0)
  return Math.max(1, n - (limits.get(m[1]) ?? 0))
}

const Config = z.object({ rules: z.record(z.string(), z.unknown()), jsPlugins: z.array(z.object({ name: z.string(), specifier: z.string() })).optional() })

function readConfig() {
  return Config.passthrough().parse(JSON.parse(fs.readFileSync(path.join(ROOT, ".oxlintrc.json"), "utf8")))
}

function limitsOf(config: z.infer<typeof Config>) {
  const limits = new Map<string, number>()
  for (const name of ["max-lines", "max-lines-per-function", "complexity"]) {
    const option = z.tuple([z.string(), z.object({ max: z.number() })]).safeParse(config.rules[name])
    if (option.success) limits.set(name, option.data[1].max)
  }
  return limits
}

function oxlint(cwd: string, config: string, files: string[]) {
  const out: z.infer<typeof Diagnostic>[] = []
  for (let i = 0; i < files.length; i += 100) {
    const run = () => execFileSync(process.execPath, [OXLINT, "-c", config, "--format", "json", ...files.slice(i, i + 100)],
      { cwd, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] })
    let stdout: string
    try { stdout = run() } catch (e) { stdout = z.object({ stdout: z.string() }).parse(e).stdout }
    out.push(...Report.parse(JSON.parse(stdout)).diagnostics)
  }
  return out
}

/** Lints `texts` (path to source) as if they were the repository's files, with its .oxlintrc.json. */
export function lint(texts: Map<string, string>, inPlace: boolean): Finding[] {
  const config = readConfig()
  const limits = limitsOf(config)
  const files = [...texts.keys()]
  if (!files.length) return []
  let cwd = ROOT
  let configPath = path.join(ROOT, ".oxlintrc.json")
  if (!inPlace) {
    cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-ratchet-")))
    for (const [f, text] of texts) {
      fs.mkdirSync(path.dirname(path.join(cwd, f)), { recursive: true })
      fs.writeFileSync(path.join(cwd, f), text)
    }
    const plugins = config.jsPlugins?.map((p) => ({ ...p, specifier: path.join(ROOT, p.specifier) }))
    configPath = path.join(cwd, ".oxlintrc.json")
    fs.writeFileSync(configPath, JSON.stringify({ ...config, jsPlugins: plugins, $schema: undefined }))
  }
  try {
    return oxlint(cwd, configPath, files).map((d) => {
      const line = d.labels[0]?.span.line ?? 1
      const file = path.relative(cwd, path.resolve(cwd, d.filename)).split(path.sep).join("/")
      const text = (texts.get(file) ?? "").split("\n")[line - 1]?.trim() ?? ""
      return { rule: d.code, file, line, text, weight: weightOf(d.code, d.message, limits), message: d.message }
    })
  } finally {
    if (!inPlace) fs.rmSync(cwd, { recursive: true, force: true })
  }
}
