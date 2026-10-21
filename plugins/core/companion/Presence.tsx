// Who's in the note, top right as in a shared doc: each agent around in its colour (a click goes where it is). Atop the
// Conversations panel too.
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { cn, type FileHead, menuBelow } from "@vaultite"
import { type Agent, getState, liveAgents, subscribe } from "./live"
import { follow } from "./Overlay"

const STATUS: Record<string, string> = { watching: "idle", reading: "reading", thinking: "thinking", writing: "writing", starting: "starting" }
const FACES = 4
const fileOf = (p: string) => p.split("/").pop()!.replace(/\.md$/, "")

export function Presence({ file }: { file: FileHead & { place: "bar" | "line" } }) {
  return <Faces path={file.path} big={file.place !== "bar"} />
}

/** How many faces fit the parent's width (unbounded until measured), from the first two faces' size and step. */
function useFit(on?: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const geo = useRef({ size: 0, step: 0 })
  const [fit, setFit] = useState(Infinity)
  const measure = () => {
    const el = ref.current, box = el?.parentElement
    if (!on || !el || !box) return
    const [a, b] = Array.from(el.children) as HTMLElement[]
    if (a && b) geo.current = { size: a.offsetWidth, step: b.offsetLeft - a.offsetLeft }
    const { size, step } = geo.current
    if (step > 0) setFit(Math.max(1, 1 + Math.floor((box.clientWidth - size) / step)))
  }
  // (again on each render, as agents come and go; on its own as the parent resizes)
  useLayoutEffect(measure)
  useLayoutEffect(() => {
    const box = ref.current?.parentElement
    if (!on || !box) return
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => ro.disconnect()
  }, [on])
  return [ref, fit] as const
}

/** The agents around, those in `path` first, overlapping as a shared doc's faces; `big`: a phone's sizes; `fit`: no
 *  more than the parent's width holds (the rest behind +N). */
export function Faces({ path, big, fit }: { path: string; big?: boolean; fit?: boolean }) {
  const s = useSyncExternalStore(subscribe, getState)
  const [ref, room] = useFit(fit)
  if (s.mode === "off") return null
  const agents = liveAgents().sort((a, b) => Number(b.path === path) - Number(a.path === path))
  const max = Math.min(FACES, room)
  const shown = agents.length > max ? agents.slice(0, max - 1) : agents, rest = agents.slice(shown.length)
  const where = (a: Agent) => `${a.name}: ${a.asks ? "needs you" : STATUS[a.state] ?? a.state}${a.path ? (a.path === path ? ", here" : `, in ${fileOf(a.path)}`) : ""}`
  const size = big ? "-my-1.5 h-11 min-w-11 md:my-0 md:h-8 md:min-w-8" : "h-7 min-w-7"
  const overlap = big ? "-ml-[26px] md:-ml-[14px]" : "-ml-[13px]"
  return (
    <div ref={ref} className="flex shrink-0 items-center" data-companion-presence>
      {shown.map((a, i) => (
        <button key={a.name} type="button" aria-label={`Go to ${a.name}`} data-tip={where(a)} data-agent={a.name} data-state={a.state} onClick={() => follow(a)}
          className={cn("relative grid cursor-pointer place-items-center rounded-full hover:z-10", size, i > 0 && overlap)}>
          <span className={cn("relative grid place-items-center rounded-full font-bold text-white ring-2 ring-background transition-transform hover:scale-110", big ? "size-6 text-[12px]" : "size-[20px] text-[10.5px]",
            a.path !== path && "opacity-60")} style={{ background: `var(--${a.tint})` }}>
            {a.name.charAt(0).toUpperCase()}
            {a.state !== "watching" && <span aria-hidden className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-white ring-2 ring-background" style={{ background: `var(--${a.tint})` }} />}
          </span>
        </button>
      ))}
      {rest.length > 0 && (
        <button type="button" aria-label={`${rest.length} more agents`} data-tip={rest.map(where).join(", ")} onClick={(e) => menuBelow(e, rest.map((a) => ({ label: `Go to ${a.name}`, hint: STATUS[a.state], run: () => follow(a) })))}
          className={cn("grid cursor-pointer place-items-center", size, shown.length > 0 && overlap)}>
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-muted px-1 text-[10.5px] font-semibold text-muted-foreground ring-2 ring-background">+{rest.length}</span>
        </button>
      )}
    </div>
  )
}
