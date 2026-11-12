import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { tempDir } from "../lib.ts"

export const ROOT = path.resolve(import.meta.dirname, "..", "..", "..")
export const WEB = path.join(ROOT, "web", "src")
export type Any = any
export type Props = Record<string, unknown>
// The web modules are loaded through test_web.ts' hook (tsconfig.app.json type-checks them), so they're typed here by hand.
export const web = (rel: string) => import(pathToFileURL(path.join(WEB, rel)).href)
// By URL, untyped: plugin modules import "@vaultite", which only test_web.ts' hook resolves (the backend's tsc can't)
export const plugin = (rel: string) => import(pathToFileURL(path.join(ROOT, "plugins", "core", rel)).href)
export const fm: {
  readProps(block: string): { props: Props; error: string | null }
  setProp(block: string, key: string, value: unknown): string
  renameProp(block: string, from: string, to: string): string
  dumpKey(key: string, value: unknown): string
  typedNumber(s: string): number | string | null
  toLocal(v: string): string
  fromLocal(s: string, was: string): string
} = await web("core/frontmatter.ts")
export const merge: { merge3(base: string, mine: string, actual: string): string | null; opcodes<T>(a: T[], b: T[]): [string, number, number, number, number][]
  textChanges(a: string, b: string): { from: number; to: number; insert: string }[]
  mergeClashes(base: string, mine: string, theirs: string): { text: string; clashes: { at: number; mine: string[]; theirs: string[] }[] } } =
  await web("core/merge.ts")

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const tmp = tempDir("vaultite-web-")
export const VAULT = path.join(tmp, "vault")
fs.mkdirSync(VAULT)
process.env.VAULTITE_VAULT = VAULT
process.env.VAULTITE_LOCAL = path.join(tmp, "local")
