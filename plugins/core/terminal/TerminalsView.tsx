// The Terminals panel as a tab (view:terminals): every shell the server runs, the same rows as the sidebar's, with what
// each is doing and since when, and buttons to open a new terminal or a coding agent (each plugin's that's on).
import { Plus } from "lucide-react"
import { openAgent, openView, useAgents, useTick } from "@vaultite"
import { newId } from "./sessions"
import { SessionList, useSessions } from "./SessionsPanel"

const button = "flex h-7 cursor-pointer items-center gap-1.5 rounded-[6px] bg-foreground/[0.05] px-2.5 text-[13px] font-medium text-foreground hover:bg-foreground/[0.09] max-md:h-9 max-md:text-[15px]"

export function TerminalsView() {
  const { list, refused } = useSessions()
  const agents = useAgents()
  // "started 5 min ago" moves on by itself.
  useTick()
  if (refused) return <p className="text-[15px] text-muted-foreground">This device can't open shells on the server ({refused}).</p>
  return (
    <div data-terminals-view>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[13px] text-muted-foreground max-md:text-[15px]">
          {!list ? "Connecting…" : list.length ? `${list.length} running on the server. Click one to open its tab.` : "Shells and coding agents the server runs show here."}
        </p>
        {agents.map((a) => (
          <button key={a.name} type="button" className={button} data-agent={a.name} onClick={() => openAgent(a.name)}>
            <a.icon className="size-3.5" strokeWidth={2} />New {a.label}
          </button>
        ))}
        <button type="button" className={button} onClick={() => openView(`terminal/${newId()}`, { newTab: true })}>
          <Plus className="size-3.5" strokeWidth={2.25} />New terminal
        </button>
      </div>
      {/* The sidebar's rows, a size up (on phones 17px, 44px rows). */}
      <div className="size-up-bleed"><div data-size-up>
        <SessionList />
      </div></div>
    </div>
  )
}
