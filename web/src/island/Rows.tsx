import { cn } from "@/lib/utils"
import { type Presence, PRESENCE_GROUPS } from "../../../core/desktop/knocks"
import { api, type Companion } from "./data"

const QUIET: Record<Presence["state"], string> = { "needs you": "Waiting on you", ready: "Ready for review", working: "Working", done: "Done" }
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60_000); return m < 1 ? "now" : m < 60 ? `${m}m` : `${Math.round(m / 60)}h` }

export function Cursor({ tint, size = 15 }: { tint: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="shrink-0">
      <path d="M3 2.5 L16.5 9.2 L10.3 10.9 L7.6 16.8 Z" fill={`var(--${tint})`} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function Chip({ name, main, run, off }: { name: string; main?: boolean; run: () => void; off?: boolean }) {
  return <button type="button" className={cn("island-chip", main && "island-chip-main")} disabled={off} onClick={run} data-island-action={name}>{name}</button>
}

function Asked({ p, answering }: { p: Presence & { ask: NonNullable<Presence["ask"]> }; answering?: "approve" | "deny" }) {
  return (
    <div className="pb-0.5 pl-[25px]" data-island-ask={p.id}>
      <div className="island-ask">{p.ask.what}</div>
      <span className="mt-1.5 flex gap-1">
        <Chip name={answering === "approve" ? "Approving…" : "Approve"} main off={!!answering} run={() => api?.act("approve", p.id)} />
        <Chip name={answering === "deny" ? "Declining…" : "Decline"} off={!!answering} run={() => api?.act("deny", p.id)} />
        {p.knock && <Chip name="Not now" off={!!answering} run={() => api?.act("later", p.knock!)} />}
      </span>
    </div>
  )
}

function Acts({ p }: { p: Presence }) {
  const open = () => api?.act("open", p.id)
  if (p.ask || p.state === "working") return null
  return (
    <span className="flex shrink-0 gap-1">
      {p.state === "needs you" && <Chip name="Answer" main run={open} />}
      {p.state === "needs you" && p.knock && <Chip name="Not now" run={() => api?.act("later", p.knock!)} />}
      {p.state === "ready" && <Chip name="Show me" run={open} />}
      {p.state !== "needs you" && <Chip name="Settle" run={() => api?.act("settle", p.id)} />}
    </span>
  )
}

function Row({ p, answering }: { p: Presence; answering?: "approve" | "deny" }) {
  const { ask } = p, line = p.line ?? p.step ?? QUIET[p.state]
  return (
    <div role="listitem" className={cn("island-row flex-col !items-stretch !gap-1", p.state === "done" && "opacity-60 hover:opacity-100")} data-island-row={p.id} data-island-at={p.id} data-state={p.state}>
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => api?.act("open", p.id)} aria-label={`Open ${p.who}`}>
          <Cursor tint={p.tint} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2"><span className="truncate text-[12.5px] font-semibold">{p.who}</span>
              <span className="shrink-0 text-[11px] text-white/45 tabular-nums">{[p.where, ago(p.since)].filter(Boolean).join(" · ")}</span></span>
            {(!ask || p.line) && <span className="block truncate text-[11.5px] text-white/65">{line}</span>}
          </span>
        </button>
        <Acts p={p} />
      </div>
      {ask && <Asked p={{ ...p, ask }} answering={answering} />}
    </div>
  )
}

type Groups = { presences: Presence[]; answering?: Record<string, "approve" | "deny">; done: boolean; toggle: () => void }
export function Groups({ presences, answering = {}, done, toggle }: Groups) {
  const groups = PRESENCE_GROUPS.map((g) => ({ ...g, rows: presences.filter((p) => p.state === g.state) })).filter((g) => g.rows.length)
  return groups.map((g) => (
    <div key={g.state} className="contents">
      {g.state === "done" ? (
        <button type="button" className="island-fold" onClick={toggle} aria-expanded={done} data-island-done={g.rows.length}>
          <span>{g.rows.length} done</span><span aria-hidden className={cn("island-chev", done && "rotate-90")}>›</span>
        </button>
      ) : <div className="island-group" style={g.state === "needs you" ? { color: "var(--orange)" } : undefined} data-island-group={g.state}>{g.label} · {g.rows.length}</div>}
      {(g.state !== "done" || done) && g.rows.map((p) => <Row key={p.id} p={p} answering={answering[p.id]} />)}
    </div>
  ))
}

export function Foot({ companion }: { companion?: Companion | null }) {
  return (
    <div className="island-foot">
      {companion && (
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => api?.act("companion", companion.name)} data-island-companion={companion.name}>
          <Cursor tint={companion.tint} size={13} /><b className="shrink-0 font-semibold text-white/90">{companion.name}</b><span className="truncate text-white/55">{companion.doing}</span>
        </button>
      )}
      <button type="button" className={cn("shrink-0", !companion && "flex-1 text-left")} onClick={() => api?.act("agents", "view:agents")} data-island-agents>All agents</button>
    </div>
  )
}
