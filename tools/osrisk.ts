// Whether a change is likely to behave differently on another OS than the Mac it was made on (Windows most of all):
// the files it touches and the lines it adds. tools/verify.ts asks, and then recommends a try run (tools/try.ts).
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { gitEnv } from "../core/gitenv.ts"

/** One reason a change is OS-sensitive: the file and what in it. */
export type Risk = { file: string; why: string }
/** A file of a diff and the lines it adds. */
export type Touched = { file: string; added: string[] }

/** What windows.yml's surfaces job exercises and the tests don't (.github/windows/): vau from each shell through its
 *  shims, Set up's PATH, opening files, the service, WSL, the installer. */
const SURFACES = /^(bin\/|\.github\/windows\/|core\/(appentry|cli|service|wslvau|opening)\.ts$|electron\/(setup|install|installed|natives|source|sign|nightly)\.(ts|cjs)$|electron\/win\/|tools\/test_(installer|setup)\.ts$)/

/** Files that are OS-specific whatever their lines: what starts processes or the run itself on each OS. */
const FILES: [RegExp, string][] = [
  [/^bin\//, "the CLI's shims"],
  [/^\.github\//, "CI itself"],
  [SURFACES, "what vau, Set up, the service and the installer do on Windows"],
  [/^package(-lock)?\.json$/, "the packages (native builds, scripts)"],
  [/\.(sh|ps1|cmd|bat)$/, "a shell script"],
  // (the helpers' Swift too: CI's macOS builds it with an older Xcode than the Mac it was made on)
  [/^tools\/build_helpers\.ts$|^electron\/[\w-]+-build\.ts$|^electron\/[^/]+\.(swift|m)$/, "the native helpers"],
  [/^tools\/(test|build)\.ts$|^tools\/test\/(lib|isolate|vault\/harness)\.ts$|^core\/(runtime|testrun|gitenv|sessionenv)\.ts$/, "how tests and the app's runs start"],
]

/** Added lines that do what differs by OS. */
const LINES: [RegExp, string][] = [
  [/\b(spawn|spawnSync|execFile|execFileSync|execSync|fork)\s*\(|\bexec\(\s*["'`]|child_process|node-pty|\bshell:\s*true|process\.kill\(|\bdetached:/, "starts or stops a process"],
  [/process\.platform|\bos\.(platform|type|EOL)\b|["'](win32|darwin|linux)["']/, "branches on the OS"],
  [/\bpath\.(sep|delimiter|resolve|relative|normalize|isAbsolute|posix|win32)\b|fileURLToPath|pathToFileURL|\bos\.(homedir|tmpdir)\(|process\.env\.(HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PATH|TMPDIR|SHELL)\b|realpath|\.split\(\s*["'`]\/["'`]\s*\)/, "builds or compares paths"],
  [/\b(chmod|symlink|link|rename|utimes|lutimes|watch|lstat)(Sync)?\(|\b(mtime|ctime|birthtime)(Ms)?\b|\\r\\n|\bEBUSY\b|\bEPERM\b/, "file system behaviour (modes, links, renames, watching, file times)"],
  [/["'`](cp|rm|mv|ln|which|lsof|pgrep|pkill|ps|osascript|open|xdg-open|pbcopy|pbpaste|xclip|launchctl|systemctl|powershell|pwsh|cmd(\.exe)?)["'`]\s*[,)\]]|["'`](sh|bash|zsh)["'`]\s*,\s*\[\s*["'`]-l?c/, "runs a tool one OS lacks"],
]

/** Where lines run in a browser or only on one machine by hand (not in CI's tests): their APIs aren't the OS's. */
const SKIP = /^web\/(src|qa)\/|\.(md|css|svg|png|jpe?g|txt)$|^CHANGELOG/
const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/

/** What makes a change OS-sensitive, each reason once per file; none: it isn't. */
export function osRisk(touched: Touched[]): Risk[] {
  const out: Risk[] = []
  for (const { file, added } of touched) {
    const byFile = FILES.find(([re]) => re.test(file))
    if (byFile) { out.push({ file, why: byFile[1] }); continue }
    if (SKIP.test(file) || !CODE.test(file)) continue
    const whys = new Set<string>()
    for (const line of added) for (const [re, why] of LINES) if (re.test(line)) whys.add(why)
    for (const why of whys) out.push({ file, why })
  }
  return out
}

/** The files of a unified diff (`git diff -U0`) and the lines each adds. */
export function parseDiff(diff: string): Touched[] {
  const out: Touched[] = []
  let cur: Touched | null = null
  for (const line of diff.split("\n")) {
    const head = /^diff --git a\/.+ b\/(.+)$/.exec(line)
    if (head) { out.push(cur = { file: head[1], added: [] }); continue }
    if (cur && line.startsWith("+") && !line.startsWith("+++")) cur.added.push(line.slice(1))
  }
  return out
}

/** The jobs beyond CI's tests a try of an OS-sensitive change runs: windows.yml's surfaces (11 min) for what only it
 *  exercises. Not arm64 nor the demo: none of last week's breakages was only theirs. */
export function alsoTry(risks: Risk[]): string[] {
  return risks.some((r) => SURFACES.test(r.file)) ? ["surfaces"] : []
}

/** The OS risks of this checkout's change since `base` (its commits, uncommitted edits and new files). */
export function changeRisk(root: string, base: string): Risk[] {
  const git = (...a: string[]) => spawnSync("git", a, { cwd: root, encoding: "utf8", env: gitEnv(), maxBuffer: 256 * 1024 * 1024 }).stdout ?? ""
  const since = git("merge-base", base, "HEAD").trim() || base
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean)
  const read = (f: string) => { try { return fs.readFileSync(path.join(root, f), "utf8").split("\n") } catch { return [] } }
  return osRisk([...parseDiff(git("diff", "-U0", "--no-color", since)), ...untracked.map((file) => ({ file, added: CODE.test(file) ? read(file) : [] }))])
}

/** The risks in a line or two: each reason with the files it's in. */
export function describe(risks: Risk[], max = 3): string {
  const by = new Map<string, Risk[]>()
  for (const r of risks) by.set(r.why, [...by.get(r.why) ?? [], r])
  return [...by].map(([why, rs]) => `${why} (${rs.slice(0, max).map((r) => r.file).join(", ")}${rs.length > max ? ` and ${rs.length - max} more` : ""})`).join("; ")
}
