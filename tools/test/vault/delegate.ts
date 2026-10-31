import path from "node:path"
import type { IncomingMessage } from "node:http"
import type { Any, VaultTest } from "./harness.ts"
import { waitFor } from "../lib.ts"
import { fakeSdk } from "./claude-chat.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check } = $
  const { cascade, childrenOf, clampMode, taskOf } = await import("../../../plugins/core/delegate/graph.ts")
  const { changedFiles, HOME } = await import("../../../core/agents.ts")
  const { modeOf } = await import("../../../plugins/core/codex/plugin.ts")
  const { Conversation } = await import("../../../plugins/core/codex/rollout.ts")

  // The graph: what a child may do, never more than its parent; a cancel's order, deepest first.
  {
    const c = (ceiling: Any, asked?: Any, user = false) => { const r = clampMode(ceiling, asked, user); return `${r.mode}${r.clamped ? "!" : ""}` }
    check("delegate: a child inherits its parent's mode, may ask less, never more (clamped), an unknown parent counts as default, the user's runs as asked",
      c("acceptEdits") === "acceptEdits" && c("acceptEdits", "plan") === "plan" && c("acceptEdits", "bypassPermissions") === "acceptEdits!" &&
      c("plan", "default") === "plan!" && c(null) === "default" && c(null, "auto") === "default!" && c("dontAsk", "default") === "default" &&
      c(undefined, undefined, true) === "null" && c(undefined, "bypassPermissions", true) === "bypassPermissions",
      [c("acceptEdits", "bypassPermissions"), c("plan", "default"), c(null, "auto")])
    const t = (id: string, parent: Any, child: Any) => ({ id, parent, child, task: id, title: id, cwd: "/", mode: "default", state: "working", started: Number(id.slice(1)), at: 0, turn: 0 }) as Any
    const tasks = [t("a1", null, { agent: "claude", session: "s-root" }), t("b2", { agent: "claude", session: "s-root" }, { agent: "codex", terminal: "codex-x1" }),
      t("c3", { agent: "codex", terminal: "codex-x1" }, { agent: "claude", session: "s-leaf" }), t("d4", { agent: "claude", session: "s-root" }, { agent: "claude", session: "s-two" }),
      // (a loop: a session its own ancestor is visited once)
      t("e5", { agent: "claude", session: "s-leaf" }, { agent: "codex", terminal: "codex-x1" })]
    check("delegate: a cancel goes deepest first, each subtree before the task above it, a loop once",
      cascade(tasks, "b2").map((x: Any) => x.id).join() === "e5,c3,b2" && cascade(tasks, "d4").map((x: Any) => x.id).join() === "d4" &&
      childrenOf(tasks, { agent: "claude", session: "s-root" }).map((x: Any) => x.id).join() === "d4,b2" && taskOf(tasks, { agent: "", session: "s-two" })?.id === "d4",
      cascade(tasks, "b2").map((x: Any) => x.id))
    const tool = (name: string, input: string, error = false) => ({ kind: "tool", id: name, name, summary: "", input, result: null, error, at: "" }) as Any
    check("delegate: the files a turn changed, from Claude Code's edits (an input cut short too) and Codex's file changes",
      changedFiles([tool("Edit", '{\n  "file_path": "/w/a.ts",\n  "old_string": "x"'), tool("Write", '{"file_path": "/w/b.md", "content": "…'), tool("Bash", '{"command": "rm /w/c"}'),
        tool("Edit", "update ~/w/d.ts\n@@ -1 +1 @@\n-a\n+b\n\nadd /w/new file.ts\nhello\ndelete C:\\w\\e.ts"), tool("Edit", '{"file_path": "/w/failed.ts"}', true)]).join() ===
        ["/w/a.ts", "/w/b.md", path.join(HOME, "w/d.ts"), "/w/new file.ts", "C:\\w\\e.ts"].join())
    check("delegate: Codex's sandbox and approvals as a permission mode", modeOf("on-request", "workspace-write", "auto_review") === "auto" &&
      modeOf("on-request", "workspace-write") === "acceptEdits" && modeOf("on-request", "read-only") === "default" && modeOf("never", "read-only") === "plan" &&
      modeOf("never", "danger-full-access") === "bypassPermissions" && modeOf("", "") === null)
    const cx = new Conversation(), ev = (type: string) => cx.line(JSON.stringify({ timestamp: new Date().toISOString(), type: "event_msg", payload: { type } }))
    ev("task_started")
    const during = cx.done
    ev("task_complete")
    const after = cx.done
    ev("task_started")
    check("delegate: a Codex turn's end, from its rollout (what Codex says before it speaks OSC 7501)", !during && after && !cx.done)
  }

  const { Host, listen } = await import("../../../plugins/core/claude-code/chathost.ts")
  const { CHAT_SOCKET } = await import("../../../plugins/core/claude-code/chat.ts")
  const { settled } = await import("../../../plugins/core/inbox/plugin.ts")
  // An agent's vau: Claude Code's, from inside session `session` (its variables filled in, as vau does).
  const agent = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8793", "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code" } } as unknown as IncomingMessage
  const as = (session: string) => ({ session, from: "claude" })
  const asApp = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:8793", "x-vaultite-client": "app/desktop" } } as unknown as IncomingMessage
  const rows = async () => { await settled(); return (await api("GET", "inbox/events"))[1].events as Any[] }
  const sdk = fakeSdk()
  const host = new Host({ query: sdk.query as Any })
  const served = listen(host, CHAT_SOCKET)
  await new Promise((r) => served.server.once("listening", r))
  const cc = app.plugins.find((p) => p.id === "claude-code")!
  const was = cc.services.sample
  cc.services.sample = async () => ({ text: "DONE", truncated: false })
  const idle = (id: string) => waitFor(() => host.list().find((s) => s.id === id)?.state === "idle", 5000, 50)
  const runOf = (id: string) => sdk.runs.find((r: Any) => (r.options.sessionId ?? r.options.resume) === id)
  try {
    // A parent: a chat in default mode.
    // (the chat's link to a keeper before this one, an area's earlier, may still be going away)
    let [st, b] = await waitFor(async () => { const r = await api("POST", "ops/claude-code.chat-start", { prompt: "Say hello", cwd: VAULT, mode: "default" }); return r[0] === 200 && r }, 3000, 100) || [0, {}]
    const parent = b.id
    check("delegate: a parent chat", st === 200 && !!parent, [st, b])
    await idle(parent)

    // Wait: a Claude child runs as a chat, its answer comes back once its turn ends.
    ;[st, b] = await api("POST", "ops/delegate.start", { agent: "claude", task: "Count the notes", mode: "wait", timeout: 10, permissions: "bypassPermissions", ...as(parent) }, agent)
    const child = b.session, first = b
    const crun = runOf(child)
    check("delegate wait: a Claude child is a chat, told its task and who reads its answer, its answer and state back when its turn ends",
      st === 200 && b.state === "done" && b.result === `Done: ${crun?.said[0]?.text}` && /^Count the notes\n\n\(Claude Code delegated this to you/.test(crun?.said[0]?.text ?? "") &&
      b.agent === "claude" && b.link === `view:claude-session/${child}` && b.timedOut === false, [st, b])
    check("delegate: a child asking for more than its parent may gets its parent's mode at most, and is told so", crun?.options.permissionMode === "default" && first.mode === "default" &&
      first.clamped === true, [crun?.options.permissionMode, first.mode])
    let row = (await rows()).find((e) => e.session === child)
    check("delegate: the child is its own thread, called by its task, from its parent, done quietly (its answer was the parent's to read)",
      row?.kind === "session" && row.title === "Count the notes" && row.state === "done" && row.read === true && row.parent?.session === parent && !!row.parent.title, row)
    ;[st, b] = await api("POST", "ops/delegate.list", as(parent), agent)
    check("delegate list: the caller's children", st === 200 && b.children.length === 1 && b.children[0].id === first.id && !b.parent, b)
    ;[st, b] = await api("POST", "ops/delegate.list", { of: child }, asApp)
    check("delegate list: a session's parent for the app (the chat tab's header), linked", st === 200 && b.parent?.session === parent && b.parent.link === `view:claude-session/${parent}`, b)
    ;[st] = await api("POST", "ops/delegate.status", { id: first.id, ...as("another-session") }, agent)
    const [stUser] = await api("POST", "ops/delegate.status", { id: first.id }, asApp)
    check("delegate: only its parent (and the user) may see or steer a task", st === 403 && stUser === 200, [st, stUser])

    // A follow-up in the same session.
    ;[st, b] = await api("POST", "ops/delegate.send", { id: first.id, text: "Now count the people", timeout: 10, ...as(parent) }, agent)
    check("delegate send: told in the same session, its next answer back", st === 200 && b.state === "done" && b.result === "Done: Now count the people" &&
      runOf(child)?.said.length === 2, [st, b])

    // A question: the wait ends with it, the parent answers, the child goes on.
    ;[st, b] = await api("POST", "ops/delegate.start", { agent: "claude", task: "Ask me a question", timeout: 10, ...as(parent) }, agent)
    const q = b
    check("delegate: a question ends the wait with it, for the parent to answer", st === 200 && q.state === "waiting" && q.ask === "question" && q.questions?.[0]?.question === "Tea or coffee?", [st, q])
    ;[st, b] = await api("POST", "ops/delegate.answer", { id: q.id, picks: ["2"], ...as(parent) }, agent)
    await waitFor(() => runOf(q.session)?.question, 3000, 50)
    ;[st, b] = await api("POST", "ops/delegate.status", { id: q.id, wait: 10, ...as(parent) }, agent)
    check("delegate answer: the parent's pick is the child's answer, and it finishes", runOf(q.session)?.question?.updatedInput?.answers?.["Tea or coffee?"] === "Coffee" &&
      b.state === "done", [b, runOf(q.session)?.question])

    // A permission is the user's: the wait doesn't end on it, the parent can't answer it, the inbox asks the user.
    ;[st, b] = await api("POST", "ops/delegate.start", { agent: "claude", task: "Clean up, ask permission", timeout: 1, ...as(parent) }, agent)
    const perm = b
    const [stAns] = await api("POST", "ops/delegate.answer", { id: perm.id, picks: ["1"], ...as(parent) }, agent)
    row = (await rows()).find((e) => e.session === perm.session)
    check("delegate: a child's permission goes to the user (its thread needs them), not to its parent", perm.state === "waiting" && perm.ask === "permission" && perm.timedOut === true &&
      stAns === 409 && row?.state === "open" && row.ask === "permission" && row.parent?.session === parent, [perm, stAns, row])

    // Async, and a grandchild: cancel stops both, deepest first; the parent's thread works while they do.
    ;[st, b] = await api("POST", "ops/delegate.start", { agent: "claude", task: "Something slow", mode: "async", ...as(parent) }, agent)
    const slow = b
    await waitFor(() => host.list().find((s) => s.id === slow.session)?.state === "working", 3000, 50)
    ;[st, b] = await api("POST", "ops/delegate.start", { agent: "claude", task: "Also slow", mode: "async", ...as(slow.session) }, agent)
    const grand = b
    check("delegate async: its id at once, still working", slow.state === "working" && grand.state === "working" && !slow.timedOut, [slow, grand])
    await api("POST", "ops/claude-code.chat-send", { id: parent, text: "Carry on meanwhile" })
    await waitFor(async () => (await rows()).find((e) => e.session === parent)?.state === "working", 3000, 100)
    row = (await rows()).find((e) => e.session === parent)
    check("delegate: a session whose subagents still work shows working, not needing the user", row?.state === "working", row)
    ;[st, b] = await api("POST", "ops/delegate.cancel", { id: slow.id, ...as(parent) }, agent)
    await waitFor(() => !host.list().some((s) => s.id === slow.session || s.id === grand.session), 3000, 50)
    const [, g] = await api("POST", "ops/delegate.status", { id: grand.id }, asApp)
    check("delegate cancel: the child and its own subagent stopped, deepest first", st === 200 && b.stopped.join() === `${grand.id},${slow.id}` && g.state === "cancelled" &&
      !host.list().some((s) => s.id === slow.session || s.id === grand.session), [b, g])
    row = (await rows()).find((e) => e.session === slow.session)
    check("delegate cancel: a cancelled child's thread is done", !row || row.state === "done", row)

    // The user cancels the last one a parent waited for: its thread isn't left working.
    await api("POST", "ops/delegate.cancel", { id: perm.id, ...as(parent) }, agent)
    await idle(parent)
    ;[st, b] = await api("POST", "ops/delegate.start", { agent: "claude", task: "Slow again", mode: "async", ...as(parent) }, agent)
    const last = b
    await waitFor(() => host.list().find((s) => s.id === last.session)?.state === "working", 3000, 50)
    await api("POST", "ops/claude-code.chat-send", { id: parent, text: "Wait for it" })
    await waitFor(async () => (await rows()).find((e) => e.session === parent)?.state === "working", 3000, 100)
    ;[st] = await api("POST", "ops/delegate.cancel", { id: last.id }, asApp)
    row = await waitFor(async () => { const r = (await rows()).find((e) => e.session === parent); return r?.state !== "working" && r }, 8000, 100)
    check("delegate cancel by the user: a parent left with no subagent at work isn't working any more", st === 200 && !!row && row.state !== "working", row)

    // An async child that finishes tells its parent.
    await idle(parent)
    const before = runOf(parent).said.length
    ;[st, b] = await api("POST", "ops/delegate.start", { agent: "claude", task: "Tell me the date", mode: "async", ...as(parent) }, agent)
    const told = await waitFor(() => runOf(parent).said.slice(before).find((x: Any) => /^\[Vaultite\] Claude Code finished "Tell me the date"/.test(x.text)), 5000, 50)
    check("delegate async: its answer comes to its parent as a message when it's done", !!told && told.text.includes("Done: Tell me the date"), runOf(parent).said.slice(before))
    for (const s of host.list()) host.stop(s.id)
    await waitFor(() => !host.list().length, 3000, 50)
  } finally {
    cc.services.sample = was
    host.close()
    await served.stop()
  }
}
