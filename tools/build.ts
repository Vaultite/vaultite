// npm run build: the type check and Vite's build at once, either failing fails it (a script, so any shell runs it:
// npm's on Windows is cmd).
import { spawn } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const run = (bin: string, ...args: string[]) => new Promise<number>((done) =>
  spawn(process.execPath, [path.join(ROOT, "node_modules", bin), ...args], { cwd: ROOT, stdio: "inherit" }).on("exit", (code) => done(code ?? 1)))
const codes = await Promise.all([run("typescript/bin/tsc", "-b"), run("vite/bin/vite.js", "build")])
process.exit(codes.find((c) => c !== 0) ?? 0)
