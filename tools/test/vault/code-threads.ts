import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import { waitFor } from "../lib.ts"
import { fakeSdk } from "./claude-chat.ts"

const PATCH = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,4 @@
 const a = 1
-const b = 2
+const b = 3
+const c = 4
 export { a }
diff --git a/old name.md b/new name.md
similarity 90%
rename from old name.md
rename to new name.md
diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..3333333
Binary files /dev/null and b/logo.png differ
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
\\ No newline at end of file
`

function gitRepo(dir: string, git: (cwd: string, ...a: string[]) => string) {
  fs.mkdirSync(path.join(dir, "sub"), { recursive: true })
  git(dir, "init", "-q", "-b", "main")
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\n")
  fs.writeFileSync(path.join(dir, "sub", "s.txt"), "s\n")
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "First")
}

function fakeBins(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  const log = path.join(dir, "gh.log")
  fs.writeFileSync(path.join(dir, "gh"), `#!/bin/sh\necho "$@" >> "${log}"\necho "https://github.com/lighthouse/app/pull/7"\n`)
  for (const b of ["codex", "agy", "opencode"]) fs.writeFileSync(path.join(dir, b), "#!/bin/sh\necho 1.0\n")
  for (const f of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, f), 0o755)
  return log
}

const all = (...xs: unknown[]) => xs.every(Boolean)
type Ctx = { $: VaultTest; git: (cwd: string, ...a: string[]) => string; repo: string; remote: string; ghLog: string; sdk: Any
  op: (name: string, body: Any) => Promise<[number, Any]>; turns: (dir: string, id: string) => Promise<number[]> }

async function units({ check }: VaultTest) {
  const { parseDiff, splitRows } = await import("../../../plugins/core/claude-code/diffparse.ts")
  const { shellLine, HARNESSES } = await import("../../../plugins/core/claude-code/harness.ts")
  const [app, moved, logo, gone] = parseDiff(PATCH)
  const lines = app.hunks[0].lines.map((l) => `${l.k}${l.a ?? ""}/${l.b ?? ""}`).join()
  check("threads: a diff read as files, numbered lines, a rename, a binary and a deletion", all(app.path === "src/app.ts", app.added === 2, app.removed === 1,
    lines === "ctx1/1,del2/,add/2,add/3,ctx3/4", moved.status === "renamed", moved.from === "old name.md", moved.path === "new name.md", logo.binary === true,
    logo.status === "added", gone.status === "deleted", gone.removed === 2, gone.hunks[0].lines.length === 2), [app, moved, logo, gone])
  const rows = splitRows(app.hunks[0]).map((r) => `${r.left ? r.left.text : "-"}|${r.right ? r.right.text : "-"}`)
  check("threads: side by side, a deletion beside the line it became, the extra addition alone",
    rows.join("\n") === "const a = 1|const a = 1\nconst b = 2|const b = 3\n-|const c = 4\nexport { a }|export { a }", rows)
  const s = (argv: string[]) => shellLine(argv)
  check("threads: each harness's terminal handoff", all(s(HARNESSES.claude.resume("s1")) === "claude --resume s1", s(HARNESSES.codex.resume("s1")) === "codex resume s1",
    s(HARNESSES.antigravity.resume("s1")) === "agy --resume s1", s(HARNESSES.opencode.resume("s1", "http://127.0.0.1:4096")) === "opencode attach http://127.0.0.1:4096 --session s1",
    s(["echo", "it's"]) === `echo 'it'\\''s'`))
}

const runOf = (sdk: Any, id: string) => waitFor(() => sdk.runs.find((r: Any) => r.options.sessionId === id) ?? null, 5000, 50)
const reached = async (c: Ctx, dir: string, id: string, n: number) => !!(await waitFor(async () => (await c.turns(dir, id)).length >= n || null, 8000, 50))

async function started(c: Ctx) {
  const { check } = c.$
  const [st, b] = await c.op("chat-start", { prompt: "Fix the flaky test", cwd: path.join(c.repo, "sub"), worktree: true, mode: "default" })
  const root = path.join(os.tmpdir(), ".vaultite", "worktrees", "lighthouse"), run = await runOf(c.sdk, b.id), cwd: string = run ? run.options.cwd : ""
  const wt = path.dirname(cwd)
  check("threads: a chat started in a repository runs in a worktree of its own, on an agents/ branch, in the same subfolder", all(st === 200,
    /^agents\/fix-the-flaky-test-[0-9a-f]{4}$/.test(b.branch), path.dirname(wt) === root, path.basename(cwd) === "sub",
    c.git(c.repo, "worktree", "list").includes(path.basename(wt)), c.git(wt, "branch", "--show-current").trim() === b.branch), [st, b, cwd])
  check("threads: a checkpoint when it starts and after its first turn", await reached(c, c.repo, b.id, 2), await c.turns(c.repo, b.id))
  return { id: String(b.id), branch: String(b.branch), wt }
}

async function diffs(c: Ctx, { id, branch, wt }: { id: string; branch: string; wt: string }) {
  const { check } = c.$
  fs.writeFileSync(path.join(wt, "a.txt"), "one\nTWO\n")
  fs.writeFileSync(path.join(wt, "new.txt"), "new\n")
  const [st] = await c.op("chat-send", { id, text: "Now the docs" })
  check("threads: its second turn checkpointed", all(st === 200, await reached(c, c.repo, id, 3)), await c.turns(c.repo, id))
  fs.writeFileSync(path.join(wt, "later.txt"), "later\n")
  const files = async (source: string) => { const [s, r] = await c.op("chat-diff", { id, source }); return s === 200 ? r.files.map((f: Any) => `${f.path}:${f.status}`).sort().join() : `${s} ${r.error}` }
  const [latest, first, every, uncommitted] = [await files("latest"), await files("turn:1"), await files("all"), await files("uncommitted")]
  check("threads: its diff by source: the latest turn's, turn 1's (nothing), all since it started, what isn't committed (new files too)",
    all(latest === "a.txt:modified,new.txt:added", first === "", every === "a.txt:modified,later.txt:added,new.txt:added", uncommitted === every), { latest, first, every, uncommitted })
  const [s1, b1] = await c.op("chat-diff", { id, source: "turn:9" }), [s2, b2] = await c.op("chat-thread", { id })
  check("threads: a turn it hasn't had is refused; its checkout as the app reads it", all(s1 === 409, /no turn 9/.test(b1.error), s2 === 200, b2.worktree === true,
    b2.branch === branch, b2.turns.join() === "1,2", b2.dir === wt), [b1, b2])
  check("threads: checkpoints touch neither its index nor its branch", all(c.git(wt, "status", "--porcelain").includes("?? new.txt"),
    c.git(wt, "log", "--oneline").split("\n").filter(Boolean).length === 1))
  return files
}

async function actions(c: Ctx, { id, branch, wt }: { id: string; branch: string; wt: string }, files: (s: string) => Promise<string>) {
  const { check } = c.$
  let [st, b] = await c.op("chat-git", { id, action: "commit", message: "Fix the flaky test" })
  check("threads: Commit commits everything in its worktree on its branch", all(st === 200, /^Committed [0-9a-f]+ on agents\//.test(b.text),
    c.git(wt, "log", "-1", "--format=%s").trim() === "Fix the flaky test", !c.git(wt, "status", "--porcelain").trim(), await files("uncommitted") === ""), [st, b])
  ;[st, b] = await c.op("chat-git", { id, action: "commit" })
  check("threads: nothing to commit is said", all(st === 409, /nothing to commit/.test(b.error)), [st, b])
  ;[st, b] = await c.op("chat-git", { id, action: "push" })
  check("threads: Push pushes its branch to origin", all(st === 200, c.git(c.remote, "branch", "--list", branch).includes(branch)), [st, b])
  if (process.platform === "win32") return
  ;[st, b] = await c.op("chat-git", { id, action: "pr" })
  check("threads: Create pull request runs gh for its branch", all(st === 200, b.url === "https://github.com/lighthouse/app/pull/7",
    fs.readFileSync(c.ghLog, "utf8").includes(`pr create --head ${branch} --fill`)), [st, b])
  ;[st, b] = await c.op("harnesses", {})
  const on = Object.fromEntries(b.harnesses.map((h: Any) => [h.id, h]))
  check("threads: the harnesses on this machine, each with its structured session and handoff", all(st === 200, on.codex.installed, on.antigravity.installed,
    on.opencode.installed, on.codex.command === "codex app-server", on.opencode.serve === "http", on.claude.chat, !on.codex.chat), b)
}

async function tidied(c: Ctx, { id, branch, wt }: { id: string; branch: string; wt: string }) {
  const { check } = c.$
  let [st, b] = await c.op("chat-tidy", {})
  check("threads: an unmerged branch's worktree stays", all(st === 200, fs.existsSync(wt), !b.threads[id]), [st, b])
  c.git(c.repo, "merge", "-q", "--ff-only", branch)
  fs.writeFileSync(path.join(wt, "scratch.txt"), "wip\n")
  ;[st, b] = await c.op("chat-tidy", {})
  check("threads: a merged branch's worktree with uncommitted changes stays", all(st === 200, b.threads[id] === "dirty", fs.existsSync(wt)), [st, b])
  fs.rmSync(path.join(wt, "scratch.txt"))
  ;[st, b] = await c.op("chat-tidy", {})
  check("threads: once merged and clean, its worktree, branch and checkpoints go", all(st === 200, b.threads[id] === "removed", !fs.existsSync(wt),
    !c.git(c.repo, "branch", "--list", branch).trim(), (await c.turns(c.repo, id)).length === 0), [st, b])
}

async function inPlace(c: Ctx) {
  const { check, VAULT } = c.$
  let [st, b] = await c.op("chat-start", { prompt: "Just look", cwd: c.repo, worktree: false })
  const id = String(b.id), run = await runOf(c.sdk, id), [, t] = await c.op("chat-thread", { id })
  check("threads: Run in current checkout runs in the repository itself, on its branch, checkpointed all the same", all(st === 200, !b.branch,
    run && run.options.cwd === c.repo, t.worktree === false, t.branch === "main", await reached(c, c.repo, id, 2)), [b, t])
  ;[st, b] = await c.op("chat-start", { prompt: "In the vault", cwd: VAULT, worktree: true })
  const [, v] = await c.op("chat-thread", { id: b.id })
  check("threads: a chat in the vault gets no worktree", all(st === 200, !b.branch, v.git === false), [b, v])
}

const IDENT = { GIT_AUTHOR_NAME: "Alice Park", GIT_AUTHOR_EMAIL: "alice@example.com", GIT_COMMITTER_NAME: "Alice Park", GIT_COMMITTER_EMAIL: "alice@example.com" }

export default async ($: VaultTest) => {
  await units($)
  const { turnsOf } = await import("../../../plugins/core/claude-code/threads.ts")
  const { gitEnv } = await import("../../../core/plugins.ts")
  const { Host, listen } = await import("../../../plugins/core/claude-code/chathost.ts")
  const { CHAT_SOCKET } = await import("../../../plugins/core/claude-code/chatwire.ts")
  const had = { ...process.env }
  Object.assign(process.env, IDENT)
  const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, env: gitEnv(), encoding: "utf8" })
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-threads-")))
  const repo = path.join(tmp, "lighthouse"), remote = path.join(tmp, "remote.git"), bins = path.join(tmp, "bin")
  gitRepo(repo, git)
  git(tmp, "init", "-q", "--bare", remote)
  git(repo, "remote", "add", "origin", remote)
  const ghLog = fakeBins(bins)
  if (process.platform !== "win32") process.env.PATH = `${bins}${path.delimiter}${process.env.PATH}`
  const sdk = fakeSdk(), host = new Host({ query: sdk.query }), served = listen(host, CHAT_SOCKET)
  await new Promise((r) => served.server.once("listening", r))
  const c: Ctx = { $, git, repo, remote, ghLog, sdk, op: (name, body) => $.api("POST", `ops/claude-code.${name}`, body), turns: turnsOf }
  try {
    const t = await started(c)
    await actions(c, t, await diffs(c, t))
    await tidied(c, t)
    await inPlace(c)
    for (const s of host.list()) host.stop(s.id)
  } finally {
    host.close()
    await served.stop()
    for (const k of Object.keys(process.env)) if (!(k in had)) delete process.env[k]
    Object.assign(process.env, had)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
