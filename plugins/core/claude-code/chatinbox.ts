// The inbox: each session's news through its intake (inbox:session), once each (the keeper's seq and told), and its
// replies and answers to the sessions the chat runs.
import type { AgentChatNew, Choice } from "../../../core/agents.ts"
import type { Plugin } from "../../../core/plugins.ts"
import type { ChatCore } from "./chat.ts"
import type { Summary } from "./chathost.ts"
import { SESSION } from "./chatwire.ts"

type Needs = Pick<ChatCore, "asking" | "kept" | "save" | "titleOf" | "readTitle" | "ask" | "can" | "hosted" | "d" | "busyElsewhere" | "send" | "answer" | "start">

export function chatInbox(plugin: Plugin, c: Needs) {
  const { asking, kept, save, titleOf, readTitle, ask, can, hosted, d, busyElsewhere, send, answer, start } = c
  /** Each session's news told in turn, its title read first (the name Claude Code gave it). */
  const telling = new Map<string, Promise<void>>()
  /** The news told so far, by session (the keeper's `told` can trail it a moment). */
  const toldInbox = new Map<string, number>()
  const isNews = (s: Summary) => s.seq > Math.max(s.told, toldInbox.get(s.id) ?? 0)
  function tellInbox(s: Summary) {
    if (!isNews(s)) return
    const now = { ...s }
    const p = (telling.get(s.id) ?? Promise.resolve()).then(() => readTitle(s.id).catch(() => null)).then(() => { if (isNews(now)) tellNow(now) })
    telling.set(s.id, p)
    void p.finally(() => { if (telling.get(s.id) === p) telling.delete(s.id) })
  }
  function tellNow(s: Summary) {
    const tell = plugin.service("inbox:session") as ((c: Record<string, unknown>) => Promise<unknown>) | null
    // (the inbox not there yet, as the server starts: told on the next look)
    if (!tell && !s.quiet) return
    if (tell && !s.quiet) {
      const a = [...(asking.get(s.id)?.values() ?? [])].at(-1), cmd = (a?.input as { command?: unknown } | undefined)?.command
      // (its thread's id once the inbox gave it: the same thread whatever becomes of the session's id)
      const thread = kept()[s.id]?.thread
      const base = { agent: "claude", session: s.id, cwd: s.cwd, ...(thread ? { thread } : {}), ...(titleOf(s.id) ? { title: titleOf(s.id) } : {}) }
      const said = s.state === "working" ? { state: "working" }
        : s.state === "waiting" ? { state: "waiting", ask: a?.kind ?? "permission", ...(a?.questions?.length ? { questions: a.questions } : {}),
          text: a?.kind === "plan" ? a.plan ?? "" : a ? a.title + (typeof cmd === "string" ? `: ${cmd.slice(0, 200)}` : a.detail ? `: ${a.detail}` : "") : "" }
        : s.state === "idle" && s.turn ? { state: "done", text: s.turn.text, prompt: s.turn.prompt }
        : s.state === "error" ? { state: "error", text: s.error ?? s.turn?.text ?? "", prompt: s.turn?.prompt ?? "" } : null
      if (said) void tell({ ...base, ...said }).then((e) => {
        const id = (e as { id?: unknown } | null)?.id
        if (typeof id === "string" && kept()[s.id] && kept()[s.id].thread !== id) { kept()[s.id] = { ...kept()[s.id], thread: id }; save() }
      }, (e) => console.error("chat: inbox:", e))
    }
    toldInbox.set(s.id, s.seq)
    if (toldInbox.size > 500) toldInbox.delete(toldInbox.keys().next().value!)
    void ask("told", { id: s.id, seq: s.seq }).catch(() => {})
  }

  /** Whether session `id` is the chat's to talk to: it runs here, or it ran here before (resumed by a message), and no
   *  terminal runs it now. A terminal's session that ended is the inbox's to resume as it sees fit. */
  async function ours(id: string) {
    if (!SESSION.test(id) || !can()) return false
    if (hosted.has(id)) return true
    const f = kept()[id] ? d.sessionFile(id) : null
    return !!f && !f.account.private && !(await busyElsewhere(id))
  }
  // The inbox's replies and answers to a session with no terminal (its host's services): taken here when it's ours.
  plugin.provide("agent-reply:claude", async (id: string, text: string) => {
    if (!(await ours(id))) return false
    await send(id, text)
    return true
  })
  plugin.provide("agent-answer:claude", async (id: string, a: { answer?: "approve" | "deny"; picks?: Choice[]; chat?: boolean }) => {
    if (!hosted.has(id) || !asking.get(id)?.size) return false
    if (a.picks) await answer(id, { answers: a.picks })
    else if (a.chat) await answer(id, { chat: true })
    else if (a.answer) await answer(id, { allow: a.answer === "approve" })
    else return false
    return true
  })
  plugin.provide("agent-chat-new:claude", (async (o) => (can() ? { id: (await start({ prompt: o.prompt, account: o.account, cwd: o.cwd, by: o.by ?? "app" })).id } : null)) satisfies AgentChatNew)

  return { tellInbox }
}
