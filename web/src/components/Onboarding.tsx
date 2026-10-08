// Set up Vaultite: the desktop app's first-run window (web/onboarding.html; electron/setup.ts): a new vault or a folder
// to open. The vault starts from Minimal (core/start.ts); the rest comes later (its Start here note, Settings).
import { useEffect, useState, type ReactNode } from "react"
import { CircleAlert, FlaskConical, FolderOpen, FolderPlus, LoaderCircle, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type Vau = { path: string | null; onPath: boolean; system: boolean; other: string | null }
type Chosen = { path?: string; made?: boolean; added?: boolean } | null
type VaultChoice = { kind: "new"; name: string; parent: string } | { kind: "open"; path: string }
type Info = { places: { icloud: string | null; documents: string; home: string }; obsidian: { path: string; name: string }[]; vau: Vau }

/** The preload's window.vaultite.onboarding (electron/preload.cjs): answered only for this window. */
export type SetupApi = {
  info: () => Promise<Info>
  pick: () => Promise<string | null>
  choose: (c: VaultChoice | null) => Promise<Chosen>
  vau: (system: boolean) => Promise<{ did: string; vau: Vau }>
  sandbox: () => Promise<void>
  finish: () => Promise<void>
}

/** A path as the user knows it: iCloud Drive/…, ~/… */
const short = (p: string, home: string) => {
  const icloud = `${home}/Library/Mobile Documents/com~apple~CloudDocs`
  return p === icloud || p.startsWith(icloud + "/") ? `iCloud Drive${p.slice(icloud.length)}` : p.startsWith(home + "/") ? `~${p.slice(home.length)}` : p
}
const base = (p: string) => p.split("/").filter(Boolean).pop() ?? p
const message = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")

export function Onboarding({ setup }: { setup: SetupApi }) {
  const [info, setInfo] = useState<Info | null>(null)
  const [kind, setKind] = useState<"new" | "open">("new")
  const [name, setName] = useState("Vault")
  const [parent, setParent] = useState("")
  const [folder, setFolder] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    setup.info().then((i) => {
      setInfo(i)
      setParent(i.places.icloud ?? i.places.documents)
      // vau comes installed, like Obsidian's CLI: in ~/.local/bin, no password (what agents in the terminal use).
      if (!i.vau.path) setup.vau(false).catch((e) => console.error("vau:", e))
    }, (e) => setError(message(e)))
  }, [setup])

  if (!info) {
    return <div className="grid h-dvh place-items-center text-[13px] text-muted-foreground">{error || <LoaderCircle className="size-5 animate-spin" />}</div>
  }
  const { icloud, documents, home } = info.places
  const ready = kind === "new" ? !!name.trim() && !!parent : !!folder
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError("")
    try { await fn() } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  const go = () => run(async () => {
    await setup.choose(kind === "new" ? { kind, name: name.trim(), parent } : { kind, path: folder })
    await setup.finish()
  })
  const pick = async (set: (p: string) => void) => { const p = await setup.pick(); if (p) set(p) }

  return (
    <div className="flex h-dvh select-none flex-col overflow-hidden text-[13px]">
      <div className="vault-manager-drag fixed inset-x-0 top-0 h-10" />
      <form className="mx-auto flex min-h-0 w-full max-w-[460px] flex-1 flex-col px-6 pt-10" data-step="welcome"
        onSubmit={(e) => { e.preventDefault(); if (!busy && ready) void go() }}>
        <div className="flex flex-col items-center gap-2 pb-5 text-center">
          <img src="icon.svg" alt="" className="size-14" />
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Welcome to Vaultite</h1>
          <p className="text-muted-foreground">Your vault is a folder where you and your agents work together.</p>
        </div>
        <Options name="vault" value={kind} onChange={(v) => setKind(v as "new" | "open")} options={[
          { value: "new", icon: FolderPlus, title: "New vault", sub: "An empty folder for your notes." },
          { value: "open", icon: FolderOpen, title: "Open folder", sub: "Notes you already have, like an Obsidian vault." },
        ]} />
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {kind === "new" ? (
            <div className="flex flex-col gap-2.5 px-1">
              <label className="flex items-center gap-3"><span className="w-16 text-muted-foreground">Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Vault name" data-vault-name className={cn(field, "w-56")} /></label>
              <div className="flex items-start gap-3"><span className="w-16 pt-1 text-muted-foreground">Location</span>
                <div className="flex flex-1 flex-wrap gap-1.5" role="radiogroup" aria-label="Location">
                  {icloud && <Chip on={parent === icloud} onClick={() => setParent(icloud)} data-place="icloud">iCloud Drive</Chip>}
                  <Chip on={parent === documents} onClick={() => setParent(documents)} data-place="documents">Documents</Chip>
                  <Chip on={parent !== documents && parent !== icloud} onClick={() => void pick(setParent)}>{parent !== documents && parent !== icloud ? short(parent, home) : "Choose…"}</Chip>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 px-1">
                <h2 className="flex-1 text-[12px] font-semibold text-muted-foreground">{!!info.obsidian.length && "Obsidian vaults on this machine"}</h2>
                <Btn onClick={() => void pick(setFolder)} data-pick>Choose a folder…</Btn>
              </div>
              <div role="radiogroup" aria-label="Folders" className="flex flex-col gap-1.5">
                {info.obsidian.map((o) => (
                  <Row key={o.path} title={o.name} sub={short(o.path, home)} on={folder === o.path} onClick={() => setFolder(o.path)} data-obsidian={o.name} />
                ))}
                {folder && !info.obsidian.some((o) => o.path === folder) && <Row icon={FolderOpen} title={base(folder)} sub={short(folder, home)} on />}
              </div>
            </div>
          )}
        </div>
        {error && <p role="alert" className="flex items-start gap-1.5 pb-2 text-[13px] text-destructive"><CircleAlert className="mt-px size-4 shrink-0" />{error}</p>}
        <footer className="flex shrink-0 flex-col items-stretch gap-2 pt-2 pb-6">
          <Btn primary big type="submit" disabled={busy || !ready} autoFocus data-next>
            {busy ? <LoaderCircle className="mx-auto size-4 animate-spin" /> : kind === "new" ? "Create vault" : "Open vault"}
          </Btn>
          <Btn big disabled={busy} onClick={() => void run(() => setup.sandbox())} data-look>
            <span className="flex items-center justify-center gap-1.5"><FlaskConical className="size-4" strokeWidth={2} />Try the playground first</span>
          </Btn>
        </footer>
      </form>
    </div>
  )
}

// ---------- pieces ----------
const field = "h-7 rounded-[6px] border-[0.5px] border-border bg-background px-2 text-[13px] outline-none select-text focus:ring-2 focus:ring-primary/40"

function Btn({ primary, big, children, type = "button", ...p }: { primary?: boolean; big?: boolean; children: ReactNode; type?: "button" | "submit"; onClick?: () => void
  disabled?: boolean; autoFocus?: boolean } & Record<`data-${string}`, unknown>) {
  return (
    <button type={type} {...p}
      className={cn("shrink-0 cursor-pointer rounded-[6px] font-medium transition-colors disabled:cursor-default disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none",
        big ? "h-9 px-5 text-[14px]" : "h-7 px-3 text-[13px]",
        primary ? "bg-primary text-primary-foreground hover:bg-primary/85" : "border-[0.5px] border-border bg-background hover:bg-foreground/[0.05]")}>
      {children}
    </button>
  )
}

function Chip({ on, children, onClick, ...p }: { on: boolean; children: ReactNode; onClick: () => void } & Record<`data-${string}`, unknown>) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} {...p}
      className={cn("h-7 max-w-[260px] cursor-pointer truncate rounded-[6px] border-[0.5px] px-3 text-[13px] focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none",
        on ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-foreground/[0.05]")}>
      {children}
    </button>
  )
}

/** Cards to pick one of: radio buttons, so the arrows move between them. */
function Options({ name, value, options, onChange }: { name: string; value: string; onChange: (v: string) => void
  options: { value: string; icon: LucideIcon; title: string; sub: string }[] }) {
  return (
    <div role="radiogroup" className="grid grid-cols-2 gap-2">
      {options.map((o) => (
        <label key={o.value} data-choice={o.value}
          className={cn("relative flex cursor-pointer flex-col gap-1 rounded-[8px] border-[0.5px] p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/50",
            value === o.value ? "border-primary bg-primary/[0.06]" : "border-border hover:bg-foreground/[0.03]")}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
          <span className="absolute top-3 right-3"><Dot on={value === o.value} /></span>
          <o.icon className="size-5 shrink-0" style={{ color: value === o.value ? "var(--primary)" : undefined }} strokeWidth={2} />
          <span className="font-medium">{o.title}</span>
          <span className="text-[12px] leading-[16px] text-muted-foreground">{o.sub}</span>
        </label>
      ))}
    </div>
  )
}

function Row({ icon: Icon, title, sub, on, onClick, ...p }: { icon?: LucideIcon; title: string; sub?: string; on?: boolean; onClick?: () => void }
  & Record<`data-${string}`, unknown>) {
  const inner = (
    <>
      {Icon && <Icon className={cn("size-5 shrink-0", on ? "text-primary" : "text-muted-foreground")} strokeWidth={2} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {sub && <span className="block truncate text-[12px] text-muted-foreground">{sub}</span>}
      </span>
      <Dot on={!!on} />
    </>
  )
  // Picked like the cards above it: its border and a filled dot.
  const cls = cn("flex min-h-11 w-full items-center gap-3 rounded-[8px] border-[0.5px] px-3 py-1.5 text-left",
    on ? "border-primary bg-primary/[0.08]" : "border-border")
  return onClick
    ? <button type="button" role="radio" aria-checked={!!on} onClick={onClick} className={cn(cls, "cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none", !on && "hover:bg-foreground/[0.03]")} {...p}>{inner}</button>
    : <div className={cls} {...p}>{inner}</div>
}

const Dot = ({ on }: { on: boolean }) => (
  <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", on ? "border-primary bg-primary" : "border-border")}>
    {on && <span className="size-1.5 rounded-full bg-primary-foreground" />}
  </span>
)
