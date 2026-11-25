import { useId, useRef, useState } from "react"
import { Ellipsis, FolderOpen, PencilLine } from "lucide-react"
import { menuBelow, menuFor, type MenuItem } from "@/components/ContextMenu"
import { revealLabel } from "@/core/platform"
import type { KnownVault } from "@/core/webvaults"
import { cn } from "@/lib/utils"
import { folderName, NICKNAME_HINT, NICKNAME_MAX, nicknameText } from "../../../core/vaultname.ts"

export const FIELD = "h-7 rounded-[6px] border-[0.5px] border-border bg-background px-2 text-[13px] outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary/60 pointer-coarse:h-9 pointer-coarse:text-[16px]"

export function VaultRow({ v, here, sub, busy, open, nickname, reveal, remove }: {
  v: KnownVault; here: boolean; sub: string; busy: boolean
  open: () => void; nickname?: (typed: string) => void; reveal?: () => void; remove: () => void
}) {
  const [naming, setNaming] = useState(false)
  const items = (): MenuItem[] => [
    ...(nickname ? [{ label: "Set nickname…", icon: PencilLine, run: () => setNaming(true) }] : []),
    ...(reveal ? [{ label: revealLabel, icon: FolderOpen, run: reveal }] : []),
    { label: "Remove from list", disabled: here, run: remove },
  ]
  const row = cn("group relative flex items-center rounded-[6px]", here ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]")
  if (naming && nickname) return <div data-vault-row={v.path} className={row}><NicknameField v={v} save={nickname} done={() => setNaming(false)} /></div>
  return (
    <div data-vault-row={v.path} className={row} onContextMenu={menuFor(items)}>
      <button type="button" disabled={busy} onClick={() => { if (!here) open() }} aria-label={here ? `${v.name}, this vault` : `Open ${v.name}`}
        data-tip={here ? "This vault" : `Open ${v.name}`}
        className="absolute inset-0 cursor-pointer rounded-[6px] focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none" />
      <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col items-start px-2.5 py-1.5 pr-8">
        {nickname ? (
          <button type="button" aria-label={`Set nickname for ${v.name}`} data-tip="Set nickname" onClick={() => setNaming(true)}
            className="pointer-events-auto -mx-1 max-w-[calc(100%+8px)] cursor-text truncate rounded-[4px] px-1 text-left text-[13px] font-medium hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none">
            {v.name}
          </button>
        ) : <span className="w-full truncate text-[13px] font-medium">{v.name}</span>}
        <span className="w-full truncate text-[12px] text-muted-foreground">{sub}</span>
      </div>
      <button type="button" aria-label={`More for ${v.name}`} onClick={(e) => menuBelow(e, items())}
        className="absolute right-1 grid size-6 cursor-pointer place-items-center rounded-[4px] text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-foreground/[0.08] hover:text-foreground pointer-coarse:opacity-100 pointer-coarse:before:absolute pointer-coarse:before:-inset-2.5">
        <Ellipsis className="size-4" strokeWidth={2.25} />
      </button>
    </div>
  )
}

function NicknameField({ v, save, done }: { v: KnownVault; save: (typed: string) => void; done: () => void }) {
  const [typed, setTyped] = useState(v.nickname ?? "")
  const hint = useId(), over = useRef(false)
  const end = (keep: boolean) => {
    if (over.current) return
    over.current = true
    done()
    if (keep && nicknameText(typed) !== (v.nickname ?? "")) save(typed)
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 p-1.5">
      <input autoFocus value={typed} placeholder={folderName(v.path)} maxLength={NICKNAME_MAX} spellCheck={false} autoComplete="off" aria-label="Nickname" aria-describedby={hint}
        onFocus={(e) => e.currentTarget.select()} onChange={(e) => setTyped(e.target.value)} onBlur={() => end(true)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          e.stopPropagation()
          if (e.key === "Enter") { e.preventDefault(); end(true) }
          if (e.key === "Escape") { e.preventDefault(); end(false) }
        }}
        className={cn(FIELD, "w-full min-w-0")} />
      <p id={hint} className="px-1 text-[12px] leading-4 text-muted-foreground">{NICKNAME_HINT}</p>
    </div>
  )
}
