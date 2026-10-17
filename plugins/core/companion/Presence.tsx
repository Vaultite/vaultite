// Who's in the note, top right as in a shared doc: each agent around in its colour (a click goes where it is). Atop the
// Conversations panel too.
import { useSyncExternalStore } from "react"
import { cn, type FileHead, menuBelow } from "@vaultite"
import { type Agent, getState, liveAgents, subscribe } from "./live"
import { follow } from "./Overlay"

const STATUS: Record<string, string> = { watching: "idle", reading: "reading", thinking: "thinking", writing: "writing", starting: "starting" }
const FACES = 4
const fileOf = (p: string) => p.split("/").pop()!.replace(/\.md$/, "")

export function Presence({ file }: { file: FileHead & { place: "bar" | "line" } }) {
  return <Faces path={file.path} big={file.place !== "bar"} />
}

/** The agents around, those in `path` first; `big`: a phone's sizes. */
export function Faces({ path, big }: { path: string; big?: boolean }) {
  const s = useSyncExternalStore(subscribe, getState)
  if (s.mode === "off") return null
  const agents = liveAgents().sort((a, b) => Number(b.path === path) - Number(a.path === path))
  const shown = agents.length > FACES ? agents.slice(0, FACES - 1) : agents, rest = agents.slice(shown.length)
  const where = (a: Agent) => `${a.name}: ${STATUS[a.state] ?? a.state}${a.path ? (a.path === path ? ", here" : `, in ${fileOf(a.path)}`) : ""}`
  const size = big ? "-my-1.5 h-11 min-w-11 md:my-0 md:h-8 md:min-w-8" : "h-7 min-w-7"
  return (
    <div className="flex shrink-0 items-center" data-companion-presence>
      {shown.map((a, i) => (
        <button key={a.name} type="button" aria-label={`Go to ${a.name}`} data-tip={where(a)} data-agent={a.name} data-state={a.state} onClick={() => follow(a)}
          className={cn("grid cursor-pointer place-items-center rounded-full", size, i > 0 && (big ? "-ml-4 md:-ml-3" : "-ml-2.5"))}>
          <span className={cn("relative grid place-items-center rounded-full font-bold text-white ring-2 ring-background transition-transform hover:scale-110", big ? "size-6 text-[12px]" : "size-[20px] text-[10.5px]",
            a.path !== path && "opacity-60")} style={{ background: `var(--${a.tint})` }}>
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
    </div>
  )
}
