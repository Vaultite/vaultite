// Part of npm run app:build: electron/build.json (commit, repo, channel: what updates and Machines read) and
// electron/cli.json (what core/appsource.ts reads from the source, which the packaged app ships without).
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { sourceSnapshot } from "../core/appsource.ts"

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const git = (...args: string[]) => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8" }).trim()
fs.writeFileSync(path.join(ROOT, "electron", "build.json"),
  JSON.stringify({ commit: git("rev-parse", "HEAD"), repo: git("remote", "get-url", "origin"),
    ...(process.env.VAULTITE_RELEASE ? { release: true } : {}),
    ...(process.env.VAULTITE_CHANNEL === "dev" ? { channel: "dev", branch: git("rev-parse", "--abbrev-ref", "HEAD") } : {}) }, null, 2) + "\n")
fs.writeFileSync(path.join(ROOT, "electron", "cli.json"), JSON.stringify(sourceSnapshot()) + "\n")
