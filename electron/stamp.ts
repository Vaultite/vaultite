// Part of npm run app:build: the code's and the app's stamps (build.json, shell.json: identity.ts) and electron/cli.json
// (what core/appsource.ts reads from the source, which the packaged app ships without).
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { sourceSnapshot } from "../core/appsource.ts"
import { gitEnv } from "../core/gitenv.ts"
import { stamps } from "./identity.ts"

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const git = (...args: string[]) => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", env: gitEnv() }).trim()
const write = (name: string, o: object) => fs.writeFileSync(path.join(ROOT, "electron", name), JSON.stringify(o, null, 2) + "\n")
const { code, shell } = stamps({ commit: git("rev-parse", "HEAD"), repo: git("remote", "get-url", "origin"),
  branch: git("rev-parse", "--abbrev-ref", "HEAD"), env: process.env })
write("build.json", code)
write("shell.json", shell)
fs.writeFileSync(path.join(ROOT, "electron", "cli.json"), JSON.stringify(sourceSnapshot()) + "\n")
