import type { AgentChatNew, Choice } from "../../../core/agents.ts"
import { logger, type Plugin } from "../../../core/plugins.ts"
import type { ChatCore } from "./chat.ts"
import type { Summary } from "./chatprotocol.ts"
import { SESSION } from "./chatwire.ts"
import { isRecord } from "./inputs.ts"
const log = logger("chat")

type Needs = Pick<ChatCore, "asking" | "kept" | "save" | "titleOf" | "readTitle" | "ask" | "can" | "hosted" | "d" | "busyElsewhere" | "send" | "answer" | "start">

export function chatInbox(plugin: Plugin, c: Needs) {
  const { asking, kept, save, titleOf, readTitle, ask, can, hosted, d, busyElsewhere, send, answer, start } = c
  const telling = new Map<string, Promise<void>>()
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
    const tell = plugin.service("inbox:session")
    if (!tell && !s.quiet) return
    if (tell && !s.quiet) {
      const a = [...(asking.get(s.id)?.values() ?? [])].at(-1), cmd = isRecord(a?.input) ? a.input.command : undefined
      const thread = kept()[s.id]?.thread
      const base = { agent: "claude", session: s.id, cwd: s.cwd, ...(thread ? { thread } : {}), ...(titleOf(s.id) ? { title: titleOf(s.id) } : {}) }
      const said = s.state === "working" ? { state: "working" }
        : s.state === "waiting" ? { state: "waiting", ask: a?.kind ?? "permission", ...(a?.questions?.length ? { questions: a.questions } : {}),
          text: a?.kind === "plan" ? a.plan ?? "" : a ? a.title + (typeof cmd === "string" ? `: ${cmd.slice(0, 200)}` : a.detail ? `: ${a.detail}` : "") : "" }
        : s.state === "idle" && s.turn ? { state: "done", text: s.turn.text, prompt: s.turn.prompt }
        : s.state === "error" ? { state: "error", text: s.error ?? s.turn?.text ?? "", prompt: s.turn?.prompt ?? "" } : null
      if (said) void Promise.resolve(tell({ ...base, ...said })).then((e: unknown) => {
        const id = isRecord(e) ? e.id : undefined
        if (typeof id === "string" && kept()[s.id] && kept()[s.id].thread !== id) { kept()[s.id] = { ...kept()[s.id], thread: id }; save() }
      }, (e) => log.error("inbox", e))
    }
    toldInbox.set(s.id, s.seq)
    if (toldInbox.size > 500) toldInbox.delete(toldInbox.keys().next().value!)
    void ask("told", { id: s.id, seq: s.seq }).catch(() => {})
  }

  async function ours(id: string) {
    if (!SESSION.test(id) || !can()) return false
    if (hosted.has(id)) return true
    const f = kept()[id] ? d.sessionFile(id) : null
    return !!f && !f.account.private && !(await busyElsewhere(id))
  }
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
