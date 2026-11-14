import fs from "./node/fs.ts"
import { PAPER } from "./research.ts"

const FILES = import.meta.glob<string>("./research/**/*", { query: "?raw", import: "default", eager: true })
const VAULT_FILES: [string, string][] = Object.entries(FILES).map(([k, text]) => [k.slice("./research/".length), text])

export const RESEARCH_STAMP = `research:${VAULT_FILES.reduce((n, [rel, text]) => (n * 31 + rel.length * 7 + text.length) % 1_000_000_007, 7)}`

export function makeResearchVault(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true })
  const plugins: [string, string] = [".vaultite/plugins.json", "{\"disabled\": [], \"enabled\": []}\n"]
  const pins: [string, string] = [".vaultite/pages.json", `${JSON.stringify({ pinned: [PAPER, "Teaching/KNOW 214 Media of knowledge/Syllabus.md"] }, null, 2)}\n`]
  for (const [rel, text] of [...VAULT_FILES, plugins, pins]) {
    fs.mkdirSync(`${dir}/${rel}`.replace(/\/[^/]+$/, ""), { recursive: true })
    fs.writeFileSync(`${dir}/${rel}`, text)
  }
}
