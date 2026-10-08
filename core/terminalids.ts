// What a terminal's id says it runs, read and made in one place (server, app and plugins): "<agent>-<random>" a coding
// agent, "<agent>_<profile>-…" in one of its accounts, "resume-<agent>-<session>" resuming a session, "@<machine>" after
// any of them on another machine; anything else is a plain shell. Node-free: the web imports it.

/** An agent as a terminal names it: its name ("claude"), or its name and one of its accounts ("claude_personal"). */
export const AGENT = /^[a-z][a-z0-9]*(?:_[a-z0-9]{1,32})?$/
const PROFILE = /^[a-z0-9]{1,32}$/

export type TerminalAgent = { agent: string; profile: string | null; resume: string | null; machine: string | null }

/** The agent terminal `id` runs, in which account, the session it resumes and the machine it's on; null: a shell. */
export function parseTerminal(id: string): TerminalAgent | null {
  const at = id.indexOf("@")
  const own = at < 0 ? id : id.slice(0, at), machine = at < 0 ? null : id.slice(at + 1)
  if (own.startsWith("resume-")) {
    const m = /^([a-z][a-z0-9]*)-([\w.-]{4,100})$/.exec(own.slice(7))
    return m ? { agent: m[1], profile: null, resume: m[2], machine } : null
  }
  const m = /^([a-z][a-z0-9]*)(?:_([a-z0-9]{1,32}))?-[\w-]+$/.exec(own)
  return m ? { agent: m[1], profile: m[2] ?? null, resume: null, machine } : null
}

/** Agent `name` in account `profile` as a terminal names it (no account, or one that can't be named: just `name`). */
export const agentIn = (name: string, profile?: string | null) => (profile && PROFILE.test(profile) ? `${name}_${profile}` : name)

/** A new terminal's id: 8 letters and digits, after `agent` (a name, or a name and account: AGENT) when it runs one. */
export function newTerminalId(agent?: string | null) {
  const id = Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("")
  return agent ? `${agent}-${id}` : id
}

/** The id of a terminal resuming agent `name`'s session `session`. */
export const resumeTerminalId = (name: string, session: string) => `resume-${name}-${session}`
