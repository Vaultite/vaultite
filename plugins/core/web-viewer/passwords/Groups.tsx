import { useState, type CSSProperties, type KeyboardEvent } from "react"
import { Bot, ChevronRight, Folder, FolderOpen, FolderPlus, KeyRound, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react"
import { cn, HeadingButton, menuFor, SidebarHeading, SidebarRow, useDropHit, useDropTarget, type MenuItem } from "@vaultite"
import { attempt, moveTo } from "./actions"
import { openBranches, useOpenGroups } from "./folds"
import { AGENTS, ALL, HEALTH } from "./places"
import { call, state } from "./store"
import type { Branch } from "./tree"
import type { Group } from "./types"

type Naming = { id?: string; parent?: string; name: string }
const DROP = "web-viewer:password-groups"
const INDENT = 14

const Count = ({ n }: { n: number }) => (n ? <span className="mr-1 text-[12px] text-tertiary tabular-nums">{n}</span> : null)

export function Groups({ where, go, tree, root, bin, counts, agents }: {
  where: string; go: (id: string) => void; tree: Branch[]; root?: Group; bin?: Group
  counts: { all: number; bin: number; issues: number }; agents: boolean
}) {
  const { isOpen, setOpen } = useOpenGroups()
  const [naming, setNaming] = useState<Naming | null>(null)
  const over = useGroupDrop()
  const add = (parent?: Group) => { if (parent) setOpen(parent, true); setNaming({ parent: parent?.id, name: "" }) }
  const menu = (b: Branch): MenuItem[] => [
    { label: "New group in it", icon: FolderPlus, run: () => add(b.group) },
    { label: "Rename", icon: Pencil, run: () => setNaming({ id: b.group.id, name: b.group.name }) },
    ...(b.count || b.parent ? [] : [{ label: "Delete", icon: Trash2, danger: true, sep: true, run: () => attempt(() => call("remove-group", b.group.id), "Couldn't delete the group") }]),
  ]
  const field = (depth: number) => naming && <NameField key="naming" depth={depth} naming={naming} done={() => setNaming(null)} />
  return (
    <nav aria-label="Groups" data-size-up data-keylist className="hidden w-56 shrink-0 flex-col border-r-[0.5px] border-border @2xl:flex" data-passwords-groups>
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 py-3">
        <SidebarRow icon={KeyRound} label="All passwords" open active={where === ALL} onClick={() => go(ALL)} data-passwords-group="all"><Count n={counts.all} /></SidebarRow>
        <SidebarRow icon={ShieldCheck} label="Health" open active={where === HEALTH} onClick={() => go(HEALTH)} data-passwords-group={HEALTH}>
          {!!counts.issues && <span className="mr-1 rounded-full bg-[var(--orange)]/18 px-1.5 text-[11px] leading-[16px] font-medium text-ink-(--orange) tabular-nums" data-passwords-issues>{counts.issues}</span>}
        </SidebarRow>
        {agents && <SidebarRow icon={Bot} label="Agents' logins" open active={where === AGENTS} onClick={() => go(AGENTS)} data-passwords-group={AGENTS} />}
        <div className="mt-1"><SidebarHeading title="Groups" open><HeadingButton icon={Plus} label="New group" onClick={() => add()} data-passwords-new-group /></SidebarHeading></div>
        {openBranches(tree, isOpen).map((b) => naming?.id === b.group.id ? field(b.depth) : [
          <Branched key={b.group.id} b={b} open={isOpen(b.group)} fold={() => setOpen(b.group, !isOpen(b.group))} active={where === b.group.id} over={over === b.group.id} go={go} menu={() => menu(b)} />,
          naming?.parent === b.group.id && field(b.depth + 1),
        ])}
        {naming && !naming.id && !naming.parent && field(0)}
        {!tree.length && !naming && <p className="h-7 truncate pl-1.5 text-[13px] leading-7 text-tertiary">No groups yet</p>}
        <div className="min-h-6 flex-1" data-passwords-root={root?.id} />
      </div>
      {bin && (
        <div className="border-t-[0.5px] border-border px-2 py-2">
          <SidebarRow icon={Trash2} label="Recycle bin" open active={where === bin.id} onClick={() => go(bin.id)} data-passwords-group={bin.id} className={cn(over === bin.id && LIT)}>
            <Count n={counts.bin} />
          </SidebarRow>
        </div>
      )}
    </nav>
  )
}

const LIT = "bg-primary/12 ring-1 ring-primary/50"
function Branched({ b, open, fold, active, over, go, menu }: { b: Branch; open: boolean; fold: () => void; active: boolean; over: boolean; go: (id: string) => void; menu: () => MenuItem[] }) {
  const style: CSSProperties & Record<"--in", string> = { "--in": `${b.depth * INDENT}px` }
  return (
    <div className="relative" style={style}>
      <SidebarRow icon={b.parent && open ? FolderOpen : Folder} label={b.group.name || "Group"} open active={active} onClick={() => go(b.group.id)} onContextMenu={menuFor(menu)} more
        data-passwords-group={b.group.id} className={cn("pl-[calc(var(--in)+22px)]", over && LIT)}>
        <Count n={b.count} />
      </SidebarRow>
      {b.parent && (
        <button type="button" aria-expanded={open} aria-label={`${open ? "Close" : "Open"} ${b.group.name}`} onClick={fold} data-passwords-fold={b.group.name}
          className="absolute inset-y-0 left-[calc(var(--in)+2px)] grid w-5 cursor-pointer place-items-center rounded-control text-muted-foreground hover:text-foreground">
          <ChevronRight className={cn("size-3.5 transition-transform duration-(--motion-fast)", open && "rotate-90")} strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
}

function NameField({ depth, naming, done }: { depth: number; naming: Naming; done: () => void }) {
  const [name, setName] = useState(naming.name)
  const save = () => {
    done()
    const to = name.trim()
    if (to && to !== naming.name) void attempt(() => call("save-group", { id: naming.id, parent: naming.parent, name: to }), naming.id ? "Couldn't rename the group" : "Couldn't add the group")
  }
  const onKey = (e: KeyboardEvent) => { if (e.key === "Enter") save(); else if (e.key === "Escape") { e.stopPropagation(); done() } }
  return (
    <div className="flex h-7 items-center gap-2" style={{ paddingLeft: depth * INDENT + 22 }}>
      <Folder className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
      <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onKey} onBlur={save} autoFocus onFocus={(e) => e.currentTarget.select()} spellCheck={false}
        aria-label="Group name" placeholder="Group name" data-passwords-name className="h-6 min-w-0 flex-1 rounded-[4px] border-[0.5px] border-border bg-card px-1.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/40" />
    </div>
  )
}

function useGroupDrop() {
  useDropTarget<{ group: string; name: string }>(DROP, (item, _x, _y, el) => {
    const id = item.passwords && el?.closest<HTMLElement>("[data-passwords-group]")?.dataset.passwordsGroup
    const g = id ? state.get().groups.find((x) => x.id === id) : undefined
    return g ? { group: g.id, name: g.bin ? "the recycle bin" : g.name } : null
  }, (item, hit) => {
    const rows = (state.get().entries ?? []).filter((e) => item.passwords?.includes(e.id))
    void moveTo(rows, hit.group)
  }, { hint: (hit) => `Move to ${hit.name}` })
  return useDropHit<{ group: string; name: string }>(DROP)?.group ?? null
}
