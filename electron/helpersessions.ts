import { screen } from "electron"
import { z } from "zod"
import type { Presence } from "../core/desktop/knocks.ts"
import { DONE, host, op, OpFailed } from "./helperbase.ts"
import { WORKSPACES } from "./homewire.ts"

const TERMINAL = z.looseObject({ id: z.string(), ended: z.boolean().optional() })
export const whyNot = async <T>(run: () => Promise<T>) => { const r = await answerOf(run); return "why" in r ? r.why : null }
async function answerOf<T>(run: () => Promise<T>): Promise<{ ok: T } | { why: string }> {
  for (let i = 0; ; i++) {
    try { return { ok: await run() } } catch (e) {
      const failed = e instanceof OpFailed ? e : null, waiting = !failed || /no app window/.test(failed.why) || failed.status >= 500
      if (!waiting || i >= 19) return { why: failed?.why ? failed.why.replace(/ \(.*\)$/, "") : "Vaultite didn't answer" }
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

export const isCode = (name: string | null | undefined) => /^code$/i.test(name?.trim() ?? "")
async function toCode() {
  const r = await op("workspace.list", {}, WORKSPACES).catch(() => null)
  const n = (r?.workspaces.findIndex((w) => isCode(w?.name)) ?? -1) + 1
  if (n && n !== r?.window) await whyNot(() => op("workspace.switch", { n }, DONE))
}

export async function openPresence(p: Presence): Promise<string | null> {
  if (!host) return null
  host.openHome()
  const show = p.open?.startsWith("job:") ? p.open.slice(4) : ""
  const shown = show ? await whyNot(() => op("companion.job-show", { id: show, displays: screen.getAllDisplays().map((d) => d.bounds) }, DONE)) : "nothing to show"
  if (!shown) return null
  if (p.open && !show && !p.terminal && !p.chat && !p.job) return whyNot(() => op("ui.open", { path: p.open }, DONE))
  return openSession(p, show ? shown : null)
}

async function openSession(p: Presence, otherwise: string | null) {
  const path = p.chat ? `view:claude-session/${p.chat}` : p.link
  if (!p.job && !p.terminal && !path) return otherwise
  await toCode()
  if (p.job) {
    const why = await whyNot(() => op("companion.job-open", { id: p.job }, DONE))
    if (!why || (!p.terminal && !path)) return why
  }
  if (p.terminal) return openTerminal(p.terminal, p.who)
  return whyNot(() => op("ui.open", { path }, DONE))
}

async function openTerminal(id: string, who: string) {
  const t = await answerOf(() => op("terminal.get", { id }, TERMINAL))
  if ("why" in t) return /no terminal/.test(t.why) ? `${who} has ended` : t.why
  if (t.ok.ended || t.ok.id !== id.replace(/@.*$/, "")) return `${who} has ended`
  return whyNot(() => op("ui.open", { path: `view:terminal/${id}` }, DONE))
}

export const tell = (p: Presence, text: string) => (p.chat ? op("claude-code.chat-send", { id: p.chat, text }, DONE) : op("terminal.send", { id: p.terminal, text }, DONE))
  .then(() => null, (e) => (e instanceof OpFailed && e.status === 404 ? "That session has ended" : "Couldn't reach that session"))

const refused = (what: string) => (e: Error) => (e instanceof OpFailed && e.why ? `${what}: ${e.why}` : `${what}: Vaultite didn't answer`)
export const answerPresence = (p: Presence, yes: boolean) =>
  op("companion.presence-answer", { id: p.id, answer: yes ? "approve" : "deny", what: p.ask?.what ?? "" }, DONE).then(() => null, refused(`Couldn't answer ${p.who}`))
export const settlePresence = (p: Presence) => op("companion.presence-settle", { id: p.id }, DONE).then(() => null, refused(`Couldn't settle ${p.who}`))
