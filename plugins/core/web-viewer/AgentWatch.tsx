import { useEffect } from "react"
import { MousePointer2, Pause } from "lucide-react"
import { Button, cn } from "@vaultite"
import { useFrame } from "./liveframe"
import { takeOver, working, type AgentPage } from "./agentpages"
import { setPictured } from "./state"

export function AgentWatch({ page: p, shown }: { page: AgentPage; shown: boolean }) {
  const frame = useFrame(p.id, shown)
  useEffect(() => {
    if (!shown) return
    setPictured(p.id, true)
    return () => setPictured(p.id, false)
  }, [p.id, shown])
  const busy = working(p)
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-muted p-4 select-none" data-web-agent-watch={p.id}>
      <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
        {frame ? <img src={frame} alt={p.title} draggable={false} data-web-agent-frame
          className="max-h-full max-w-full rounded-[6px] object-contain shadow-md ring-[0.5px] ring-border" />
          : <span className="text-[13px] text-muted-foreground">Connecting…</span>}
      </div>
      <div className="glass-strong flex max-w-full shrink-0 items-center gap-3 rounded-full py-1.5 pr-1.5 pl-3 shadow-lg" data-web-agent-watching>
        {p.paused ? <Pause className="size-4 shrink-0 text-muted-foreground" strokeWidth={2.25} />
          : <MousePointer2 className={cn("size-4 shrink-0", busy && "animate-pulse")} strokeWidth={2.25} style={{ color: "var(--purple)" }} />}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-medium">{p.paused ? `${p.by} is paused here` : `${p.by} is working here`}</span>
          <span className="truncate text-[12px] text-muted-foreground">{busy && !p.paused ? p.what : "You're watching: nothing you do here reaches the page"}</span>
        </span>
        <Button size="small" look="primary" onClick={() => void takeOver(p.id, true)} data-web-agent-take className="shrink-0 rounded-full px-3">Take over</Button>
      </div>
    </div>
  )
}
