// The agents' sessions that changed a file, in its top bar (claude.ai's "1 session here"): a click lists them, and
// picking one shows its terminal, or resumes it once it ended.
import { SquareTerminal } from "lucide-react"
import {
  agentsOn, choose, cn, currentFile, fmtAgo, get, isHidden, isViewOpen, menuBelow, notify, notifyError, openAgent, openView, plural,
  useLive, type FileHead, type MenuItem,
} from "@vaultite"
import type { FileSession } from "./model"

const url = (path: string) => `activity/sessions?path=${encodeURIComponent(path)}`
export const sessionsHere = (path: string) => !!path && !isHidden(path) && !path.startsWith("/")

const nameOf = (s: FileSession) => s.title || `${s.agent} session`
const iconOf = (s: FileSession) => agentsOn().find((a) => a.name === s.runs)?.icon ?? SquareTerminal
const when = (s: FileSession) => (s.live ? "Running" : fmtAgo(s.last))

/** Its terminal when it still runs there, else its conversation resumed (a tab already resuming it is shown). */
function reopen(s: FileSession) {
  if ((s.live || !s.sessionId) && s.terminal) {
    const to = `terminal/${s.terminal}`
    return openView(to, { newTab: !isViewOpen(to) })
  }
  if (s.sessionId && s.runs) return void openAgent(s.runs, { resume: s.sessionId })
  notify("That session can't be resumed")
}

const items = (list: FileSession[]): MenuItem[] => {
  const agents = new Set(list.map((s) => s.agent)).size > 1
  // (an untitled one's name is its agent's already)
  return list.map((s) => ({ label: nameOf(s), icon: iconOf(s), hint: agents && s.title ? `${s.agent} · ${when(s)}` : when(s), run: () => reopen(s) }))
}

export function SessionsChip({ file }: { file: FileHead & { place: "bar" | "line" } }) {
  const { data } = useLive<{ sessions: FileSession[] }>(url(file.path), undefined, (p) => p === file.path, 30_000)
  const list = data?.sessions ?? []
  if (!list.length) return null
  const bar = file.place === "bar"
  return (
    <button type="button" data-sessions-here onClick={(e) => menuBelow(e, items(list))}
      data-tip="Sessions that changed this file"
      className={cn("flex shrink-0 cursor-pointer items-center gap-1 font-medium text-muted-foreground",
        bar ? "h-7 rounded-[5px] px-1.5 text-[12px] hover:bg-foreground/[0.06] hover:text-foreground"
          // (a phone's 44px target, laid out in the line's 32px)
          : "-my-1.5 h-11 px-1 text-[13px] active:opacity-50 md:my-0 md:h-8 md:rounded-[6px] md:px-1.5 md:hover:bg-foreground/[0.06]")}>
      <SquareTerminal className={bar ? "size-3.5" : "size-4"} strokeWidth={2.25} />
      {plural(list.length, "session")}
    </button>
  )
}

/** The palette's: the same list, with each one's agent and when, to pick from. */
export async function chooseSession() {
  const path = currentFile()
  try {
    const { sessions } = await get<{ sessions: FileSession[] }>(url(path))
    choose({
      title: "Sessions that changed this file", placeholder: "Find a session…",
      items: sessions.map((s, i) => ({ id: String(i), label: nameOf(s), icon: iconOf(s), detail: `${s.agent} · ${s.live ? "running" : "ended"} · changed it ${fmtAgo(s.last)}` })),
      empty: "No agent's session changed it lately",
      onPick: ({ id }) => reopen(sessions[Number(id)]),
    })
  } catch (e) { notifyError(e, "Couldn't list its sessions") }
}
