// What the Inbox keeps in the store (/api/state's `inbox`: the results in Inbox/), and its events as the server sends
// them (/api/inbox/live: kept on the machine they happened on, not in the vault; the server shows its other machines' too).

/** A result to review: Inbox/<Title>.md. */
export type InboxItem = {
  id: string; title: string; status: "new" | "done"
  /** Who put it there (an agent, the web clipper). */
  from: string
  /** Where it came from (a page's address), or "". */
  source: string
  created: string | null
  /** "" once archived: the state leaves it out (its file has it). */
  body: string
  /** Its thread's latest report (an agent's reply in the same file), a local stamp like created. */
  updated?: string | null
  archived?: boolean
  /** Snoozed until then (a local stamp): out of what's to review till it comes back. */
  snoozed?: string | null
  /** Pinned on top of the inbox till it's done. */
  pinned?: boolean
  /** A suggestion: the task its Do it hands to a worker. */
  do?: string
  /** An agent's report (inbox.report): who wrote it, its session, the app terminal and the machine it ran on, for the reply. */
  agent?: string; session?: string; terminal?: string; machine?: string
  /** A decision (decisions.ts): its question, options, default, whether its agent waits on it; then the answer or why
   *  it closed; the report that asked it, and others that asked it too (merged). */
  question?: string; options?: string[]; default?: string; blocking?: boolean
  /** What each option causes, by its index (none on older ones). */
  effects?: string[]
  /** What its report said when it asked (that round's TL;DR), and the session that asked by the name the user knows it
   *  by: filled in when it's asked (none on older ones). */
  gist?: string; where?: string
  answer?: string; answered?: string | null; closed?: string; report?: string; also?: string[]
  /** A report's work (inbox.report: feature, fix, change, research, plan, answer). */
  work?: string
  /** A report's TL;DR (its callout), one line: what the morning brief and the Reports list show. */
  tldr?: string
}

/** A question an agent asks (core/agents.ts' Question): `closed`, only its options (no answer typed, no Chat about this). */
export type Question = { question: string; header?: string; multi?: boolean; closed?: boolean; options: { label: string; description?: string }[] }

/** Where an event stands for the user (plugin.ts' State): open (a session or an ask needs them, a message is to read),
 *  working (they answered, its agent is on it), done (dealt with). */
export type State = "open" | "working" | "done"

/** Something an agent said, or an agent's session (one thread each): plugin.ts' InboxEvent. */
export type InboxEvent = {
  id: string; t: number; source: string
  /** session (a coding agent's thread), waiting (something asks the user), else a message (info, error...). */
  kind: string
  state: State
  title: string; body?: string
  /** What a click opens; a session's report (Inbox/<Title>.md) is its record, listed as the thread. */
  link?: string; terminal?: string; session?: string
  /** Its host answers it (an agent run outside a terminal), not a terminal. */
  host?: boolean
  /** Seen: drawn plain, not bold. Only a message is dealt with by it. */
  read?: boolean
  /** One of a kind (its source's): a new one took the place of the one before. */
  key?: string
  /** Marked unread by hand: seeing the Inbox doesn't read it. */
  kept?: boolean
  /** Why it needs the user: permission, question, auth, plan, answer, report, error. */
  ask?: string
  /** What a session asks, in its own words: picked in its sheet (Questions.tsx). */
  questions?: Question[]
  /** Its body as one plain line. */
  preview?: string
  /** When it last told the user (toast, notifications): announced when this changes. */
  nt?: number
  /** A permission the server waits on (an app connected to the MCP): Approve and Deny answer it, once. */
  gate?: boolean
  answer?: "approve" | "deny"
  /** Another machine's (Machines), kept there: its id is `<id>@<machine>`, its terminal too. */
  machine?: string; machineLabel?: string
  /** Snoozed until then (ms): out of the lists till it comes back, unread on top. */
  snoozed?: number
  /** Pinned on top of the inbox till it's done or unpinned. */
  pinned?: boolean
  /** A session's latest progress (inbox.progress), each replacing the last: shown on its row, never told. */
  progress?: string
  /** The session that delegated this one its task, by its name then (its own thread, if any, by its terminal or session). */
  parent?: { title: string; agent: string; terminal?: string; session?: string }
  /** The session that asked (a permission the server waits on, an ask made in its request), by its name then. */
  from?: { title: string; agent: string; terminal?: string; session?: string }
}

declare module "@vaultite" {
  interface PluginState {
    inbox: InboxItem[]
  }
}
