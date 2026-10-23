// What the Inbox keeps in the store (/api/state's `inbox`: the results in Inbox/), and its events as the server sends
// them (/api/inbox/live: kept on the machine they happened on, not in the vault; the server shows its other machines' too).

/** A result to review: Inbox/<Title>.md. */
export type InboxItem = {
  id: string; title: string; status: "new" | "done"
  /** Who put it there (an agent, the web clipper). */
  from: string
  /** Where it came from (a page's address), or "". */
  source: string
  created: string | null; body: string
  /** Its thread's latest report (an agent's reply in the same file), a local stamp like created. */
  updated?: string | null
  archived?: boolean
  /** An agent's report (inbox.report): who wrote it, its session, the app terminal and the machine it ran on, for the reply. */
  agent?: string; session?: string; terminal?: string; machine?: string
}

/** A question an agent asks (core/agents.ts' Question). */
export type Question = { question: string; header?: string; multi?: boolean; options: { label: string; description?: string }[] }

/** Something an agent said, or an agent's session (one row each): plugin.ts' InboxEvent. */
export type InboxEvent = {
  id: string; t: number; source: string; kind: string; title: string; body?: string
  link?: string; terminal?: string; session?: string; read?: boolean
  /** One of a kind (its source's): a new one took the place of the one before. */
  key?: string
  /** Marked unread by hand: seeing the Inbox doesn't read it. */
  kept?: boolean
  /** Why it needs the user (waiting): permission, question, auth, plan, answer, report, error. */
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
}

declare module "@vaultite" {
  interface PluginState {
    inbox: InboxItem[]
  }
}
