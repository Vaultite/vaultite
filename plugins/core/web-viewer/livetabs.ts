// What the live view's routes answer (liveroutes.ts), for the web app's LiveView.tsx too.

/** A tab as the owner sees it in the list: the page, whose (an agent's: its task), its container, paused, what's asked. */
export type LiveTab = { tab: number; url: string; title: string; loading: boolean; paused: boolean; asking: string | null; askedBy: string | null
  container: string | null; by: string | null; task: string; summary: string; shown: boolean; opened: number | null; appTab: string
  /** Whose browser it's in (Machines): its tab is `3@m1` there; none without Machines. */
  machine?: string; machineLabel?: string }
/** The tabs list: `self` is the machine of the server answering. */
export type LiveTabs = { tabs: LiveTab[]; self?: string | null }
/** What an agent did in a tab, as Activity keeps it. */
export type LiveStep = { t: number; by: string; text: string; failed: boolean }
