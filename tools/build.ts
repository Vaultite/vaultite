// npm run build: the type check and Vite's build at once, either failing fails it (a script, so any shell runs it:
// npm's on Windows is cmd).
import { spawn } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { z } from "zod"
import { CODE_CACHE } from "../core/codecache.ts"

const ROOT = path.resolve(import.meta.dirname, "..")
const run = (bin: string, ...args: string[]) => new Promise<number>((done) =>
  spawn(process.execPath, [path.join(ROOT, "node_modules", bin), ...args], { cwd: ROOT, stdio: "inherit" }).on("exit", (code) => done(code ?? 1)))
const codes = await Promise.all([run("typescript/bin/tsc", "-b"), run("vite/bin/vite.js", "build")])
const failed = codes.find((c) => c !== 0)
if (!failed && process.env.VAULTITE_CLEAN_BUILD) await fillCompileCache()
process.exit(failed ?? 0)

async function fillCompileCache() {
  let electron: string
  try { electron = z.string().parse(createRequire(path.join(ROOT, "package.json"))("electron")) } catch { return }
  const { execIn, mainCompiles, serverBoots, writable } = await import("../core/update/store.ts")
  writable(path.join(ROOT, "dist-app"), true)
  fs.rmSync(path.join(ROOT, CODE_CACHE), { recursive: true, force: true })
  const ctx = { root: ROOT, store: "", helpers: "", node: electron, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, exec: execIn }
  await Promise.all([serverBoots.run(ctx), mainCompiles.run(ctx)])
}
