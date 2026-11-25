import type { ReactNode } from "react"
import { asksNothing, cn, fmtAgo, menuFor, SidebarRow, type AgentRun } from "@vaultite"
import { markItems, useMarks } from "./marks"
import { kindOf, openRun } from "./runs"

const stateWords = (r: AgentRun) => (r.shell ? (r.state === "working" ? "running a command" : "a plain shell")
  : r.state === "needs" ? "needs you" : r.state === "working" ? "working" : r.state === "waiting" ? "waiting on its background work"
  : r.failed ? "failed" : r.unread ? "done, unread" : "done")
const dotOf = (r: AgentRun) => (r.state === "needs" ? "ask" as const : r.state === "working" ? "working" as const : r.failed ? "error" as const : r.unread ? "unread" as const
  : r.state === "waiting" ? "waits" as const : false)

type Lead = "ask" | "working" | "waits" | "error" | "unread" | "rest"
const LEAD: Record<Lead, string> = {
  ask: "bg-[var(--yellow)] dot-ping", working: "bg-foreground/70 breathe motion-reduce:animate-none", waits: "border-[1.5px] border-foreground/70 breathe motion-reduce:animate-none", error: "bg-[var(--red)]",
  unread: "bg-[var(--blue)]", rest: "border-[1.5px] border-current opacity-40",
}
const glyph = (k: Lead) => function Glyph({ className }: { className?: string }) {
  return <span aria-hidden className={cn(className, "grid place-items-center")} data-dot={k === "rest" ? undefined : k}><span className={cn("relative size-[7px] rounded-full", LEAD[k])} /></span>
}
const GLYPHS: Record<Lead, (p: { className?: string }) => ReactNode> = { ask: glyph("ask"), working: glyph("working"), waits: glyph("waits"), error: glyph("error"), unread: glyph("unread"), rest: glyph("rest") }

function menuOf(r: AgentRun, marks: ReturnType<typeof useMarks>) {
  return () => {
    const own = r.menu?.() ?? []
    return [...markItems(r, marks), ...own.map((it, i) => (i ? it : { ...it, sep: true }))]
  }
}

export function Row({ r, open: wide, tab, page, where }: { r: AgentRun; open: boolean; tab: string; page?: boolean; where?: string }) {
  const k = kindOf(r.kind), marks = useMarks()
  const tip = [r.title, r.step && r.step !== r.title ? r.step : "",
    [k.one, r.agent, where && `on ${where}`, stateWords(r), r.started ? `started ${fmtAgo(r.at)}` : r.state === "done" && fmtAgo(r.at)].filter(Boolean).join(" · ")].filter(Boolean).join("\n")
  const quiet = asksNothing(r) || !!r.shell
  return (
    <SidebarRow icon={wide ? GLYPHS[dotOf(r) || "rest"] : k.icon} tint={wide || quiet ? undefined : r.tint} badge={wide ? undefined : dotOf(r)} label={r.title} open={wide}
      active={!!r.to && tab === r.to} tip={tip} more data-agent-run={r.id} data-glide={r.id} data-kind={r.kind} data-state={r.state} data-shell={r.shell ? "" : undefined}
      data-pinned={marks[r.id]?.pinned ? "" : undefined}
      className={cn(r.state === "needs" && "font-medium", wide && quiet && !(r.to && tab === r.to) && "text-muted-foreground")}
      onContextMenu={menuFor(menuOf(r, marks))} onClick={(e) => openRun(r, e)}>
      {page && r.step && <span className="mr-2 max-w-[45%] min-w-0 truncate text-[11px] font-normal text-tertiary group-hover/row:hidden" data-agent-step>{r.step}</span>}
      {page && where && <span className="mr-2 max-w-[12em] shrink-0 truncate text-[11px] font-normal text-tertiary group-hover/row:hidden" data-agent-where>{where}</span>}
      <span className="mr-1 shrink-0 text-[11px] font-normal text-tertiary tabular-nums group-hover/row:hidden" data-agent-when>
        {r.state === "needs" && !page ? "" : fmtAgo(r.at, { short: true })}
      </span>
    </SidebarRow>
  )
}
