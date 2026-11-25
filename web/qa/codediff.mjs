// oxlint-disable-next-line vaultite/comment-lines -- qa() reads its arguments from this usage line
//   node web/qa/codediff.mjs <base url> (claude-code DiffView.tsx DiffFile.tsx ThreadButtons.tsx aside.ts chips.ts preview.ts ContextChips.tsx, core/splits.ts)
import { qa, until } from "./lib/qa.mjs"
import { routeSocket } from "./lib/sockets.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url)

const S = { id: "qa-chat", state: "idle", cwd: "/Users/alice/.vaultite/worktrees/lighthouse/fix-the-launch-date-1a2b", account: "default", by: "app", model: "claude-opus-5-5",
  effort: "high", mode: "auto", started: Date.now() - 600_000, at: Date.now() - 5000, asks: [], seq: 1, told: 0, turn: null, background: 0 }
const entries = [{ k: "user", id: "u1", text: "Fix the launch date", at: new Date(Date.now() - 500_000).toISOString() },
  { k: "text", id: "m1:0", text: "Done: the date comes from the front matter now. Running at http://localhost:5173/launch.", at: new Date(Date.now() - 400_000).toISOString() }]
const hello = JSON.stringify({ t: "hello", id: S.id, found: true, s: S, title: "Fix the launch date", cwd: S.cwd, account: "default", model: S.model, effort: "high", tui: null, driven: "",
  history: { entries, start: 0, total: entries.length } })
const THREAD = { id: "qa-chat", git: true, repo: "/Users/alice/lighthouse", dir: S.cwd, cwd: S.cwd, branch: "agents/fix-the-launch-date-1a2b", worktree: true, turns: [1, 2] }
const line = (k, a, b, text) => ({ k, a, b, text })
const FILES = [
  { path: "src/launch.ts", status: "modified", added: 2, removed: 1, hunks: [{ head: "@@ -1,3 +1,4 @@", lines: [line("ctx", 1, 1, "import { page } from './page'"),
    line("del", 2, undefined, "const date = '2026-01-01'"), line("add", undefined, 2, "const date = page.frontmatter.date"), line("add", undefined, 3, "export { date }"),
    line("ctx", 3, 4, "render(date)")] }] },
  { path: "docs/launch.md", status: "added", added: 1, removed: 0, hunks: [{ head: "@@ -0,0 +1 @@", lines: [line("add", undefined, 1, "# Launch")] }] },
]

const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } })
const page = watch(await ctx.newPage(), { ignore: /favicon|Failed to load resource|WebSocket|terminal/i })
const sent = []
await routeSocket(page, /\/api\/claude-code\/chat\/qa-chat$/, (ws) => ws.send(hello))
await page.route(/\/api\/ops\/(claude-code\.chat-|terminal\.start)/, (r) => {
  const op = r.request().url().split("/").pop(), body = r.request().postDataJSON()
  sent.push({ op, body })
  const json = op === "claude-code.chat-thread" ? THREAD : op === "claude-code.chat-diff" ? { id: "qa-chat", source: body.source, branch: THREAD.branch, dir: THREAD.dir, worktree: true,
    turns: [1, 2], truncated: false, files: body.source === "turn:1" ? [] : FILES } : op === "claude-code.chat-git" ? { id: "qa-chat", text: `Committed 1a2b3c4 on ${THREAD.branch}` }
    : op === "terminal.start" ? { id: "qa-shell", shown: false } : { id: "qa-chat", uuid: `sent-${sent.length}` }
  return r.fulfill({ json })
})
const of = (op) => sent.flatMap((s) => (s.op === op ? [s.body] : []))
const frames = () => page.locator("section[data-pane-frame]:not([data-away])").count()

await page.goto("about:blank")
await page.goto(`${B}#view/claude-session%2Fqa-chat`)
await page.locator("[data-chat=qa-chat] [data-entries]").waitFor({ timeout: 20000 })
await page.locator("[data-thread-diff]").waitFor({ timeout: 10000 })
check("header: Diff and Shell beside Open in terminal", await page.locator("[data-thread-shell]").count() === 1 && await page.locator("[data-open-terminal]").count() === 1)
check("composer: no worktree switch", await page.locator("[data-composer] [role=switch]").count() === 0)

await page.locator("[data-thread-diff]").click()
await page.locator("[data-diff-view=qa-chat] [data-diff-file]").first().waitFor({ timeout: 10000 })
const chatBox = await page.locator("[data-chat=qa-chat]").boundingBox(), diffBox = await page.locator("[data-diff-view=qa-chat]").boundingBox()
check("diff: opens in a pane beside the thread, on its right", await frames() === 2 && diffBox.x >= chatBox.x + chatBox.width - 2, { chatBox, diffBox })
check("diff: its files listed, each drawn", await page.locator("[data-diff-files] li").count() === 2 && await page.locator("[data-diff-file]").count() === 2)
check("diff: the Diff button shows it's open", await page.locator("[data-thread-diff]").getAttribute("aria-pressed") === "true")
await page.locator("[data-thread-diff]").click()
await until(async () => await page.locator("[data-thread-diff]").getAttribute("aria-pressed") === "true", 3000)
check("diff: clicked again, the same pane (no second one)", await frames() === 2 && await page.locator("[data-diff-view]").count() === 1)

await page.locator("[data-diff-source]").click()
const sources = await page.getByRole("menu").getByRole("menuitemradio").allInnerTexts()
check("diff: sources: all, latest turn, uncommitted, then each turn, newest first", sources.map((s) => s.trim()).join() === "All changes,Latest turn,Uncommitted,Turn 2,Turn 1", sources)
await page.getByRole("menuitemradio", { name: "Turn 1" }).click()
await until(() => page.locator("[data-diff-empty]").count(), 5000)
check("diff: a turn with no changes says so", of("claude-code.chat-diff").some((b) => b.source === "turn:1") && await page.locator("[data-diff-empty]").count() === 1)
await page.locator("[data-diff-source]").click()
await page.getByRole("menuitemradio", { name: "Latest turn" }).click()
await page.locator("[data-diff-file]").first().waitFor({ timeout: 5000 })

await page.locator("[data-diff-mode=split]").click()
await until(() => page.locator("[data-diff-split]").count(), 3000)
check("diff: side by side", await page.locator("[data-diff-split]").count() >= 4 && await page.locator("[data-diff-line]").count() === 0)
await page.screenshot({ path: new URL("./shots/codediff-split.png", import.meta.url).pathname })
await page.locator("[data-diff-mode=stacked]").click()
await until(() => page.locator("[data-diff-line]").count(), 3000)

const added = page.locator("[data-diff-file='src/launch.ts'] [data-diff-line=add]").first()
await added.hover()
await added.locator("[data-diff-comment]").click()
await page.locator("[data-diff-note] textarea").fill("Fall back to the config when it's missing")
await page.locator("[data-diff-note-add]").click()
await until(() => page.locator("[data-composer] [data-context-chip]").count(), 3000)
check("comment: a chip in the thread's composer", await page.locator("[data-composer] [data-context-chip]").innerText() === "launch.ts:2")
await page.locator("[data-composer] textarea").fill("And add a test")
await page.keyboard.press("Enter")
await until(() => of("claude-code.chat-send").length, 4000)
const said = of("claude-code.chat-send")[0]?.text ?? ""
check("comment: sent with the next message, the line quoted, and taken from the composer", /About these lines:\n- src\/launch\.ts:2 \(`const date = page\.frontmatter\.date`\): Fall back/.test(said) &&
  said.endsWith("And add a test") && await page.locator("[data-context-chip]").count() === 0, said)

await page.locator("[data-git-commit]").click()
await until(() => of("claude-code.chat-git").length, 4000)
check("git: Commit commits the thread's checkout", of("claude-code.chat-git")[0]?.action === "commit", of("claude-code.chat-git"))
await page.locator("[data-git-more]").click()
const acts = await page.getByRole("menu").getByRole("menuitem").allInnerTexts()
check("git: and beside it Push, Create pull request, Copy branch", acts.map((s) => s.trim()).join() === "Commit,Push,Create pull request,Copy branch", acts)
await page.keyboard.press("Escape")

await page.locator("[data-thread-shell]").click()
await until(() => of("terminal.start").length, 4000)
await until(async () => await page.locator("[data-thread-shell]").getAttribute("aria-pressed") === "true", 5000)
const diffPane = page.locator("section[data-pane-frame]:not([data-away])").nth(1)
check("shell: a terminal in its worktree, stacked with the diff in the same pane", of("terminal.start")[0]?.cwd === THREAD.dir && await frames() === 2 &&
  await diffPane.locator("[data-place]").count() === 2, { start: of("terminal.start"), frames: await frames() })
check("shell: the Shell button shows it's open", await page.locator("[data-thread-shell]").getAttribute("aria-pressed") === "true")
await page.locator("[data-thread-preview]").click()
await until(async () => await page.locator("[data-thread-preview]").getAttribute("aria-pressed") === "true", 5000)
check("preview: opens the detected preview URL stacked beside Diff and Shell in the same pane", await frames() === 2 &&
  await diffPane.locator("[data-place]").count() === 3 && await page.locator("[data-thread-preview]").getAttribute("aria-pressed") === "true",
  { frames: await frames(), places: await diffPane.locator("[data-place]").count() })
await page.screenshot({ path: new URL("./shots/codediff-shell.png", import.meta.url).pathname })

await page.goto(`${B}#view/claude-session%2Fnew`)
await page.locator("[data-composer] [aria-label=Folder]").click()
check("new thread: Run in current checkout, quiet in the Folder menu", await page.getByRole("menuitemradio", { name: "Run in current checkout" }).count() === 1)
await page.keyboard.press("Escape")
await ctx.close()
await done()
