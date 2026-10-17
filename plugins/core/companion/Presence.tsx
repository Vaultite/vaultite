// Who's in the note, top right as in a shared doc: each agent around in its colour (a click goes where it is), and the
// note's margin threads, dismissed ones too, a click away.
import { useEffect, useState, useSyncExternalStore } from "react"
import { MessagesSquare } from "lucide-react"
import { cn, type FileHead, menuBelow, type MenuItem, op, snippet } from "@vaultite"
import { type Agent, getState, liveAgents, type Note, pick, reopen, subscribe } from "./live"
import { follow } from "./Overlay"

const STATUS: Record<string, string> = { watching: "idle", reading: "reading", thinking: "thinking", writing: "writing", starting: "starting" }
const FACES = 4
const fileOf = (p: string) => p.split("/").pop()!.replace(/\.md$/, "")
const cut = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function Presence({ file }: { file: FileHead & { place: "bar" | "line" } }) {
  const s = useSyncExternalStore(subscribe, getState)
  const bar = file.place === "bar"
  const open = s.notes.filter((n) => n.kind === "comment" && n.path === file.path)
  // (dismissed ones live on the server: counted again as this note's comments change)
  const [past, setPast] = useState<Note[]>([])
  const key = open.map((n) => n.id).join()
  useEffect(() => {
    if (s.mode === "off") return
    let live = true
    op<{ past: Note[] }>("companion.history", { path: file.path }).then((r) => live && setPast(r.past), () => {})
    return () => { live = false }
  }, [file.path, key, s.mode])
  if (s.mode === "off") return null
  // (those in this note first)
  const agents = liveAgents().sort((a, b) => Number(b.path === file.path) - Number(a.path === file.path))
  const shown = agents.length > FACES ? agents.slice(0, FACES - 1) : agents, rest = agents.slice(shown.length)
  const where = (a: Agent) => `${a.name}: ${STATUS[a.state] ?? a.state}${a.path ? (a.path === file.path ? ", here" : `, in ${fileOf(a.path)}`) : ""}`
  const go = (n: Note) => { pick(n.id); follow({ name: n.agent, path: n.path, line: n.line, find: n.find }) }
  const threads = (e: React.MouseEvent) => menuBelow(e, [
    ...(open.length ? [{ label: "In the margin", caption: true, run: () => {} }] : []),
    ...open.map((n): MenuItem => ({ label: cut(snippet(n.text ?? "")), hint: n.replies?.length ? `${n.agent} · ${n.replies.length}` : n.agent, run: () => go(n) })),
    ...(past.length ? [{ label: "Dismissed", caption: true, sep: open.length > 0, run: () => {} }] : []),
    ...[...past].reverse().map((n): MenuItem => ({ label: cut(snippet(n.text ?? "")), hint: n.agent, run: () => { reopen(n.id); go(n) } })),
  ])
  const size = bar ? "h-7 min-w-7" : "-my-1.5 h-11 min-w-11 md:my-0 md:h-8 md:min-w-8"
  return (
    <div className="flex shrink-0 items-center" data-companion-presence>
      {shown.map((a, i) => (
        <button key={a.name} type="button" aria-label={`Go to ${a.name}`} data-tip={where(a)} data-agent={a.name} data-state={a.state} onClick={() => follow(a)}
          className={cn("grid cursor-pointer place-items-center rounded-full", size, i > 0 && (bar ? "-ml-2.5" : "-ml-4 md:-ml-3"))}>
          <span className={cn("relative grid place-items-center rounded-full font-bold text-white ring-2 ring-background transition-transform hover:scale-110", bar ? "size-[20px] text-[10.5px]" : "size-6 text-[12px]",
            a.path !== file.path && "opacity-60")} style={{ background: `var(--${a.tint})` }}>
            {a.name.charAt(0).toUpperCase()}
            {a.state !== "watching" && <span aria-hidden className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-white ring-2 ring-background" style={{ background: `var(--${a.tint})` }} />}
          </span>
        </button>
      ))}
      {rest.length > 0 && (
        <button type="button" aria-label={`${rest.length} more agents`} data-tip={rest.map(where).join(", ")} onClick={(e) => menuBelow(e, rest.map((a) => ({ label: `Go to ${a.name}`, hint: STATUS[a.state], run: () => follow(a) })))}
          className={cn("grid cursor-pointer place-items-center", size)}>
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-muted px-1 text-[10.5px] font-semibold text-muted-foreground ring-2 ring-background">+{rest.length}</span>
        </button>
      )}
      {(open.length > 0 || past.length > 0) && (
        <button type="button" aria-label="Comments" data-tip="Comments, dismissed ones too" data-companion-history onClick={threads}
          className={cn("flex cursor-pointer items-center justify-center gap-1 rounded-[5px] px-1.5 text-[12px] font-medium text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground", size)}>
          <MessagesSquare className={bar ? "size-3.5" : "size-4"} strokeWidth={2.25} />
          {open.length > 0 && <span>{open.length}</span>}
        </button>
      )}
    </div>
  )
}
