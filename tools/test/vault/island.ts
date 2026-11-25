import type { Any, VaultTest } from "./harness.ts"
import { OpError } from "../../../core/plugins.ts"
import { messageOf } from "../../../core/values.ts"

export default async ($: VaultTest) => {
  const { check } = $
  const K = await import("../../../core/desktop/knocks.ts")
  const R = await import("../../../plugins/core/companion/islandrows.ts")
  const O = await import("../../../plugins/core/companion/islandops.ts")
  const C = await import("../../../electron/islandcloud.ts")
  const W = await import("../../../core/desktop/knockwire.ts")
  const T = 5_000_000, at = (rows: Any[], o: Any = {}) => K.presencesOf(rows, o.knocks ?? [], new Map(), T, o)

  {
    const P = (state: Any) => ({ state })
    const n = K.restCounts([P("needs you"), P("working"), P("working"), P("ready"), P("done")])
    check("island rest: counts who needs them and who works", n.needs === 1 && n.working === 2, n)
    check("island rest: nothing with none of them", !K.atRest([]) && !K.atRest([P("ready"), P("done")]) && K.atRest([P("working")]) && K.atRest([P("needs you")]))
  }

  {
    const chat = (o: Any) => R.chatRow({ id: "c1", state: "idle", asks: [], title: "Fix the footer", ...o }, o)
    const ask = { what: "Claude wants to run npm publish", id: "ask:1" }
    const [p] = at([chat({ state: "waiting", asks: ["ask:1"], ask })])
    check("island chats: one asking a permission needs them, with what it asks", p?.id === "chat:c1" && p.state === "needs you" && p.chat === "c1" && !p.terminal && p.ask?.what === ask.what && p.who === "Fix the footer", p)
    check("island chats: the ask reaches the Mac as the server sent it", W.PRESENCE.parse(JSON.parse(JSON.stringify(p))).ask?.id === "ask:1")
    const states = ["starting", "working", "error", "idle"].map((state) => at([chat({ state, at: T - 1000 })])[0]?.state).join()
    check("island chats: starting and working work; an ended turn or a failure is done", states === "working,working,done,done", states)
    check("island chats: one waiting on its own background task works", at([chat({ awaits: { on: "npm test", since: T, n: 1 } })])[0]?.state === "working")
    check("island chats: an answer not read is ready; one idle for long is gone", at([chat({ news: true })])[0]?.state === "ready" && !at([chat({ at: T - K.DONE_MS - 1 })]).length)
    const job: Any = { id: "j1", title: "Footer job", state: "working" }
    check("island chats: a job's session is the job's", at([chat({ state: "working", job })])[0]?.job === "j1")
  }

  {
    const entry = (o: Any) => ({ k: "ask", id: "ask:1", kind: "permission", tool: "Bash", title: "Claude wants to run a command", at: "", ...o })
    check("island asks: a permission's command under its title", R.chatAsk([entry({ input: { command: "git push" } })], ["ask:1"])?.what === "Claude wants to run a command\ngit push")
    check("island asks: said once when its title has it", R.chatAsk([entry({ title: "Claude wants to run git push", input: { command: "git push" } })], ["ask:1"])?.what === "Claude wants to run git push")
    check("island asks: a plan is its words; a question, an answered one or one too long to read there has none", R.chatAsk([entry({ kind: "plan", plan: "Do it" })], ["ask:1"])?.what === "Do it" &&
      !R.chatAsk([entry({ kind: "question" })], ["ask:1"]) && !R.chatAsk([entry({ answer: "Allowed" })], ["ask:1"]) && !R.chatAsk([entry({ input: { command: "x".repeat(700) } })], ["ask:1"]))
    const claude = ["⏺ Pushing", "─".repeat(40), " Bash command", "", "   git push origin main", "   Push the branch", "", " Do you want to proceed?", " ❯ 1. Yes", "   2. No", "", " Esc to cancel"].join("\n")
    check("island asks: Claude Code's dialog: its box, not its options", R.askedOn(claude) === "Bash command\ngit push origin main\nPush the branch", R.askedOn(claude))
    const codex = ["• Looking", "", "  Would you like to run the following command?", "", "  $ curl -sI https://example.com", "", "› 1. Yes, proceed (y)", "  2. No", "", "  Press enter to confirm or esc to cancel"].join("\n")
    check("island asks: Codex's dialog: the command under its question", R.askedOn(codex) === "$ curl -sI https://example.com", R.askedOn(codex))
    check("island asks: no dialog, nothing", R.askedOn("❯ \n  ? for shortcuts") === "" && R.askedOn("Do you want to go on?\n\nsure") === "")
  }

  {
    const job = (id: string, state: string, o: Any = {}): Any => ({ id, title: id, state, terminal: "", where: { machine: "", label: "Cloud", agent: "claude", cloud: true }, now: "", at: T - 1000, seen: false, log: [], ...o })
    const rows = R.jobRows([job("a", "working", { now: "Reading" }), job("b", "needs you", { waits: { question: "Which one?" } }), job("c", "ready for review"), job("d", "waiting"), job("e", "working", { unreachable: "offline" }),
      job("f", "ready for review", { seen: true }), job("g", "working", { terminal: "claude-1" })], (j) => j.terminal, [{ id: "claude-1", agent: "claude", state: "working" }])
    const ps = at(rows)
    check("island jobs: those in no terminal here, by their job", ps.map((p) => `${p.job}:${p.state}`).join() === "b:needs you,c:ready,a:working", ps)
    check("island jobs: each says where it runs and what it's at", ps[2].where === "Cloud" && ps[2].step === "Reading" && ps[0].step === "Which one?" && !ps[0].terminal, ps)
    const k = { ...K.makeKnock({ id: "k9", from: "session_1", who: "x", line: "Ready to show you", hold: 15_000 }, T), state: "told" } satisfies Any
    const one = at(R.jobRows([job("a", "ready for review", { terminal: "session_1" })], (j) => j.terminal, []), { knocks: [k] })
    check("island jobs: a cloud job's knock is its row, not a terminal of its own", one.length === 1 && one[0].job === "a" && one[0].knock === "k9" && !one[0].terminal, one)
  }

  {
    const rows = [{ id: "claude-1", agent: "claude", state: "done", needs: true }, { id: "claude-2", agent: "claude", state: "blocked" }]
    const settled = { "claude-1": T - 10, "claude-2": T - 10, old: T - 8 * 86_400_000 }
    check("island settle: a ready one settled is gone; one needing them isn't hidden by it", at(rows, { settled }).map((p) => p.id).join() === "claude-2")
    const still = K.stillSettled(settled, rows, T)
    check("island settle: it lasts till it works or asks again, and a week at most", Object.keys(still).join() === "claude-1", still)
    check("island settle: working again, it's back", !Object.keys(K.stillSettled({ "claude-1": T }, [{ id: "claude-1", agent: "claude", state: "working" }], T)).length)
  }

  {
    const s = (id: string, state: string, o: Any = {}): Any => ({ id, title: id, state, updated: T - 1000, url: `https://claude.ai/code/${id}`, profile: "", account: "o", ...o })
    const list = [s("s1", "running"), s("s2", "waiting"), s("s3", "idle", { outcome: "review", unread: true, profile: "c-work" }), s("s4", "idle", { outcome: "input", updated: T - K.DONE_MS - 1 }), s("s5", "running")]
    const ps = C.cloudPresences(list, [{ id: "s5", who: "s5", tint: "teal", state: "working", since: T }], {}, T)
    check("island cloud: working, waiting and work to review; not one read long ago, nor a job's own", ps.map((p) => `${p.id}:${p.state}`).join() === "cloud:s1:working,cloud:s2:needs you,cloud:s3:ready", ps)
    check("island cloud: each opens in the logins it's in", ps[0].link === "view:web/https://claude.ai/code/s1" && ps[2].link === "view:web/@work/https://claude.ai/code/s3", ps)
    check("island cloud: settled, it's back once it changes", !C.cloudPresences([list[2]], [], { "cloud:s3": T }, T).length && C.cloudPresences([list[2]], [], { "cloud:s3": T - 5000 }, T).length === 1)
  }

  {
    const ops = new Map<string, Any>(), did: string[] = []
    let ps: Any[] = []
    const plugin: Any = { op: (o: Any) => ops.set(o.id, o), ask: async (_s: string, none: Any, id: string) => (id === "studio" ? { id: "studio", label: "Studio", url: "http://127.0.0.1:9" } : none) }
    O.islandOps(plugin, { presences: () => ps, read: async () => { did.push("read") }, settle: (p) => { did.push(`settle ${p.id}`) }, answered: (p) => { did.push(`answered ${p.id}`) } })
    const ctx = (client: string | null, agent: string | null = null): Any => ({ who: { client, agent, label: "", source: "" }, op: async (id: string, p: Any) => { did.push(`${id} ${JSON.stringify(p)}`); return {} },
      api: async (m: string, r: string, b?: Any) => { did.push(`${m} ${r}${b ? ` ${JSON.stringify(b)}` : ""}`); return { events: [{ id: "e1", kind: "session", state: "open", terminal: "claude-1" }] } } })
    const run = async (id: string, p: Any, c = ctx("app/desktop")) => { did.length = 0; try { return await ops.get(id).run(p, c) } catch (e) { return { error: messageOf(e), status: e instanceof OpError ? e.status : 0 } } }
    ps = [{ id: "claude-1", who: "Deploy", state: "needs you", terminal: "claude-1", agent: "claude", ask: { what: "git push" } }, { id: "chat:c1", who: "Chat", state: "needs you", chat: "c1", ask: { what: "npm publish", id: "ask:1" } },
      { id: "claude-2@studio", who: "Far", state: "needs you", terminal: "claude-2@studio", agent: "claude", ask: { what: "rm" } }, { id: "w", who: "W", state: "working" }]
    const answer = (p: Any, c?: Any) => run("companion.presence-answer", p, c)
    for (const c of [ctx("cli"), ctx("app/desktop", "claude-code"), ctx(null)]) check("island answer: never an agent, nor vau", (await answer({ id: "claude-1", answer: "approve", what: "git push" }, c)).status === 403 && !did.length)
    await answer({ id: "claude-1", answer: "approve", what: "git push" })
    check("island answer: a terminal's dialog, answered there, its knock done", did.join(" | ") === 'read | POST terminals/claude-1/answer {"answer":"approve","agent":"claude"} | answered claude-1 | read', did)
    await answer({ id: "chat:c1", answer: "deny", what: "npm publish" })
    check("island answer: a chat's ask, that one by its id", did[1] === 'claude-code.chat-answer {"id":"c1","ask":"ask:1","allow":false}', did)
    const moved = await answer({ id: "claude-1", answer: "approve", what: "git status" })
    check("island answer: it asks something else now: refused, nothing pressed", moved.status === 409 && did.join() === "read", [moved, did])
    check("island answer: nothing asked, refused", (await answer({ id: "w", answer: "approve", what: "" })).status === 409)
    const far = await answer({ id: "claude-2@studio", answer: "approve", what: "rm" })
    check("island answer: another machine's is answered there, and says when it doesn't answer", far.error === "Studio doesn't answer" && !did.some((d) => d.startsWith("answered")), far)
    const settle = (id: string) => run("companion.presence-settle", { id })
    check("island settle: only one ready or done", (await settle("w")).status === 409 && !did.length)
    ps = [{ id: "claude-1", who: "Deploy", state: "ready", terminal: "claude-1" }]
    await settle("claude-1")
    check("island settle: its inbox thread with it", did[0] === "settle claude-1" && did.at(-1) === 'inbox.settle {"item":"e1"}', did)
    await settle("cloud:s1")
    check("island settle: one the server doesn't list (a cloud session) is kept settled too", did.join() === "settle cloud:s1", did)
  }
}
