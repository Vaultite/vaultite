import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { codeOf } from "./values.ts"

export const KEEP_DAYS = 3
const DAY = 86_400_000
const SEEN = "seen.json"
const VITE_CONTENT_HASHED_NAME = /^[\w.~-]+-[\w-]{8}\.[a-z0-9]+$/i
const LastServed = z.record(z.string(), z.number()).catch({})
type Seen = z.infer<typeof LastServed>

function readSeen(dir: string): Seen {
  try { return LastServed.parse(JSON.parse(fs.readFileSync(path.join(dir, SEEN), "utf8"))) } catch { return {} }
}

async function keepOne(from: string, to: string) {
  try { await fs.promises.link(from, to) } catch (e) {
    if (codeOf(e) === "EEXIST") return
    await fs.promises.copyFile(from, to, fs.constants.COPYFILE_FICLONE)
  }
}

export async function keepAssets(dist: string, dir: string, now = Date.now()) {
  let names: string[]
  try { names = (await fs.promises.readdir(path.join(dist, "assets"))).filter((n) => VITE_CONTENT_HASHED_NAME.test(n)) } catch { return }
  await fs.promises.mkdir(dir, { recursive: true })
  const seen = readSeen(dir), have = new Set(await fs.promises.readdir(dir))
  for (const n of names) {
    seen[n] = now
    if (!have.has(n)) await keepOne(path.join(dist, "assets", n), path.join(dir, n)).catch(() => { delete seen[n] })
  }
  for (const n of have) {
    if (n === SEEN || n.endsWith(".tmp")) continue
    if (!(n in seen) || now - seen[n] > KEEP_DAYS * DAY) { await fs.promises.rm(path.join(dir, n), { force: true }); delete seen[n] }
  }
  const tmp = path.join(dir, `${SEEN}.${process.pid}.tmp`)
  await fs.promises.writeFile(tmp, JSON.stringify(seen))
  await fs.promises.rename(tmp, path.join(dir, SEEN))
}

export function keptAsset(dir: string, name: string): { file: string; st: fs.Stats } | null {
  if (!VITE_CONTENT_HASHED_NAME.test(name)) return null
  const file = path.join(dir, name)
  try {
    const st = fs.statSync(file)
    return st.isFile() ? { file, st } : null
  } catch { return null }
}
