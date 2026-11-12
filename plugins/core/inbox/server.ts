// Inbox: what agents tell the user. Events stay on this machine (iCloud would churn), shown with the other machines' as
// one inbox; results are Inbox/ files. A session is one thread (open, working, done), its report file its record.
import { parseTerminal, TERMINAL_AGENT } from "../../../core/agents.ts"
import { HTTPError, type Machine, Plugin, type Request } from "../../../core/plugins.ts"
import { str } from "../../../core/vault.ts"
import { snoozeMs } from "./snooze.ts"

export const plugin = new Plugin(import.meta.url)

export const FOLDER = "Inbox"
export const MAX = 200 // done events kept: the rest stay until they're done
export const MERGE = 60_000 // the same thing again within this long updates the event
export const DAY = 86_400_000

export const dir = () => plugin.localDir(false)

export function settings() {
  const s = plugin.loaded ? plugin.settings({}) : {}
  return { keep: Math.max(1, Number(s.keep_days) || 7), push: ["all", "waiting", "off"].includes(str(s.push)) ? str(s.push) : "waiting",
    audio: s.voice_audio !== false, answers: s.answers === "inbox" ? "inbox" : "quiet",
    muted: (Array.isArray(s.muted) ? s.muted : []).map((x: unknown) => str(x).trim().toLowerCase()).filter(Boolean) as string[],
    dispatch: TERMINAL_AGENT.test(str(s.dispatch).trim()) ? str(s.dispatch).trim() : "",
    prompt: str(s.dispatch_prompt).trim() || str(plugin.manifest.settings?.dispatch_prompt?.default) }
}

export const clip = (v: unknown, n = Infinity) => str(v).replace(/\s+/g, " ").trim().slice(0, n)
export const TERMINAL = /^[\w-]{1,64}(@[a-z0-9][a-z0-9-]{0,62})?$/

export const machineList = () => plugin.ask<Machine[]>("machines", [])

/** Only this machine's owner (core/owner.ts) writes events: they're toasts and notifications on their screen. */
export async function owner(req: Request) {
  if (plugin.isOff()) throw new HTTPError(404, "the Inbox plugin is off (Plugins)")
  await plugin.ownerOnly(req, "the inbox")
}

export type Hold = { until: string; from: string; label?: string }
export function holdNow(now = Date.now()): Hold | null {
  const h = (plugin.loaded ? plugin.kept("hold", {}) : {}) as Partial<Hold>
  return h.until && h.from && snoozeMs(h.until) > now ? h as Hold : null
}

export async function firstMachine() {
  const self = await selfMachine()
  return !self || !(await machineList()).some((m) => !m.self && m.online && m.plugins?.includes(plugin.id) && m.id < self)
}

export const agentOfTerminal = (t: string) => parseTerminal(t)?.agent ?? ""

export const selfMachine = async () => str(await plugin.ask("machines:self", "")) || null
