import type { VaultTest } from "./harness.ts"
import type { Moment } from "../../../plugins/core/companion/types.ts"
import fs from "node:fs"
import path from "node:path"
import { elsewhereText, exchanges } from "../../../plugins/core/companion/conversation.ts"
import { localDate } from "../../../core/plugins.ts"

export default async ($: VaultTest) => {
  const now = 10_000_000
  const ask = (seq: number, t: number, text: string): Moment => ({ seq, t, kind: "ask", text, summoned: true, for: "Claude" })
  const edit = (seq: number, t: number, line: string): Moment => ({ seq, t, kind: "edit", path: "Notes/Plan.md", line: 3, hunks: [{ line: 3, added: [line], removed: [] }] })
  const page = exchanges([ask(1, now - 600_000, "tidy this"), edit(2, now - 599_000, "typing while it answers"), edit(3, now - 300_000, "ship on friday"),
    edit(4, now - 299_000, "with Alice"), edit(5, now - 100_000, "nobody answered this")], [
    { t: now - 599_500, as: "Claude", op: "say", text: "Tidied." }, { t: now - 598_000, as: "Claude", op: "done" },
    { t: now - 298_000, as: "Claude", op: "say", text: "Friday is a holiday." },
  ], [], "Claude", { reactions: true })
  $.check("companion: an ask's answer keeps what it said while you typed", page.length === 2 && page[0].said[0] === "Tidied.", page)
  $.check("companion: a burst of edits it answered on its own is one trigger above its answer, an unanswered one isn't shown",
    page[1]?.kind === "edit" && page[1].text === "ship on friday\nwith Alice" && page[1].said[0] === "Friday is a holiday." && page[1].where === "Notes/Plan, line 3", page[1])
  const passed = exchanges([edit(1, now - 300_000, "- [x] Water the fern"), { ...ask(2, now - 100_000, "thanks"), kind: "ask" }], [
    { t: now - 299_000, as: "Claude", op: "look", text: "at Notes/Plan.md" }, { t: now - 298_000, as: "Claude", op: "pass", text: "their own list" },
    { t: now - 297_000, as: "Claude", op: "done" }, { t: now - 99_000, as: "Claude", op: "pass", text: "a thanks" }], [], "Claude", { reactions: true })
  $.check("companion: an edit it let pass isn't an answer, nor an exchange; an ask it let pass still is",
    passed.length === 1 && passed[0].kind === "ask" && passed[0].did[0] === "let it pass: a thanks", passed)
  $.check("companion: without reactions (its prompt's talk), edits aren't exchanges",
    exchanges([edit(1, now, "x")], [{ t: now + 10, as: "Claude", op: "say", text: "hi" }], [], "Claude").length === 0)
  const drawing = (id: string, title: string, n: number) => ({ id, agent: "Claude", tint: "orange", t: now, marks: Array.from({ length: n }, () => ({ type: "paper" as const, title, w: 200, h: 100, items: [] })) })
  const drew = exchanges([ask(1, now - 600_000, "sketch the flow"), ask(2, now - 300_000, "and in words?")], [
    { t: now - 599_000, as: "Claude", op: "draw", text: "a paper on the screen", drawing: "d1" }, { t: now - 598_000, as: "Claude", op: "say", text: "Here." },
    { t: now - 590_000, as: "Claude", op: "draw", drawing: "d1" },
    { t: now - 299_000, as: "Claude", op: "say", text: "Sign in, then home." },
  ], [], "Claude", { drawn: [{ t: now - 599_000, drawing: drawing("d1", "Sign in", 1) }, { t: now - 590_000, drawing: drawing("d1", "Sign in", 2) }] })
  $.check("companion: an answer keeps its drawing as it left it, playable again from the chat",
    drew[0]?.drawings?.length === 1 && drew[0].drawings[0].id === "d1" && drew[0].drawings[0].title === "Sign in" && drew[0].drawings[0].marks === 2, drew[0])
  $.check("companion: a follow-up that only talks keeps its words in the chat, with no drawing of its own",
    drew[1]?.said[0] === "Sign in, then home." && !drew[1].drawings, drew[1])

  await anotherVault($)
}

async function anotherVault($: VaultTest) {
  await import("../../../plugins/core/companion/plugin.ts")
  const other = path.join($.tmp, "Lighthouse Notes"), dir = path.join(process.env.VAULTITE_LOCAL!, "companion", "other0")
  fs.mkdirSync(other, { recursive: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(path.join(other, ".vaultite"))
  fs.writeFileSync(path.join(other, ".vaultite", "vault.json"), JSON.stringify({ name: "Harbour" }))
  const t = Date.now() - 120_000, day = localDate(t)
  fs.writeFileSync(path.join(dir, "vault.txt"), `${other}\n`)
  fs.writeFileSync(path.join(dir, `moments-${day}.jsonl`), JSON.stringify({ seq: 1, t, kind: "ask", text: "when does the ferry to Lighthouse leave", summoned: true, voice: true, for: "Juno", title: "Trips" }) + "\n")
  fs.writeFileSync(path.join(dir, `actions-${day}.jsonl`), [{ t: t + 2000, as: "Juno", op: "say", text: "The 51 ferry leaves at 9:12 from pier 3." }, { t: t + 3000, as: "Juno", op: "done" }].map((r) => JSON.stringify(r)).join("\n") + "\n")
  const [, r] = await $.api("POST", "ops/companion.conversation", { day })
  const x = (r.result?.exchanges ?? r.exchanges ?? []).find((e: { text: string }) => /ferry/.test(e.text))
  $.check("companion: its chat shows an ask made in another vault on this machine, saying which by its nickname", x?.vault === "Harbour" && x.where === "Trips" && x.said[0]?.includes("9:12"), r)
  const { talkElsewhere } = await import("../../../plugins/core/companion/vaults.ts")
  const told = elsewhereText(talkElsewhere(t - 60_000, Date.now()), Date.now())
  $.check("companion: a follow-up in this vault is told what was said there since its last ask", /another vault/.test(told) && /Harbour/.test(told) && /9:12/.test(told), told)
  $.check("companion: nothing said elsewhere since its last ask, nothing told", elsewhereText(talkElsewhere(Date.now() - 1000, Date.now()), Date.now()) === "")
  fs.rmSync(dir, { recursive: true, force: true })
}
