import { useEffect, useState, type ReactNode } from "react"
import { CircleAlert, FlaskConical, FolderOpen, FolderPlus, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/Button"
import { Bar } from "@/components/kit"
import { PageFoot } from "@/components/WelcomeParts"
import { plainText } from "../../../core/plainerror.ts"

type Vau = { path: string | null; onPath: boolean; system: boolean; other: string | null }
type Chosen = { path?: string; made?: boolean; added?: boolean } | null
type VaultChoice = { kind: "new"; name: string; parent: string; starter: boolean } | { kind: "open"; path: string }
type Info = { places: { icloud: string | null; documents: string; home: string }; obsidian: { path: string; name: string }[]; vau: Vau; vauHome: string; mac: boolean }

export type SetupApi = {
  info: () => Promise<Info>
  pick: () => Promise<string | null>
  choose: (c: VaultChoice | null) => Promise<Chosen>
  vau: (system: boolean) => Promise<{ did: string; vau: Vau }>
  sandbox: () => Promise<void>
  finish: () => Promise<void>
}

const short = (p: string, home: string) => {
  const icloud = `${home}/Library/Mobile Documents/com~apple~CloudDocs`
  return p === icloud || p.startsWith(icloud + "/") ? `iCloud Drive${p.slice(icloud.length)}` : p.startsWith(home + "/") ? `~${p.slice(home.length)}` : p
}
const base = (p: string) => p.split("/").filter(Boolean).pop() ?? p

export function Onboarding({ setup }: { setup: SetupApi }) {
  const [info, setInfo] = useState<Info | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setup.info().then(setInfo, (e) => setError(plainText(e)))
  }, [setup])

  return (
    <div className="flex h-dvh flex-col overflow-hidden text-[13px]">
      <div className="vault-manager-drag fixed inset-x-0 top-0 h-10" />
      {info ? <VaultPage setup={setup} info={info} /> : <Waiting error={error} />}
    </div>
  )
}

function Waiting({ error }: { error: string }) {
  if (error) return <p role="alert" className="m-auto max-w-[360px] text-center text-muted-foreground">{error}</p>
  return (
    <div className="loading-in mx-auto flex w-full max-w-[440px] flex-col items-center gap-2 pt-14" aria-busy data-setup-loading>
      <span className="skeleton size-[52px] rounded-[12px]" />
      <span className="w-full pt-2 text-center text-[22px]"><Bar w="55%" /></span>
      <span className="w-full text-center"><Bar w="75%" /></span>
      <span className="mt-6 grid w-full grid-cols-2 gap-2.5"><span className="skeleton h-[74px] rounded-[10px]" /><span className="skeleton h-[74px] rounded-[10px]" /></span>
    </div>
  )
}

function VaultPage({ setup, info }: { setup: SetupApi; info: Info }) {
  const [kind, setKind] = useState<"new" | "open">("new")
  const [name, setName] = useState("Vault")
  const [parent, setParent] = useState(info.places.icloud ?? info.places.documents)
  const [starter, setStarter] = useState(true)
  const [folder, setFolder] = useState(info.obsidian[0]?.path ?? "")
  const [busy, setBusy] = useState<"go" | "sandbox" | null>(null)
  const [error, setError] = useState("")

  const { icloud, documents, home } = info.places
  const ready = kind === "new" ? !!name.trim() && !!parent : !!folder
  const run = async (what: "go" | "sandbox", fn: () => Promise<unknown>) => {
    setBusy(what); setError("")
    try { await fn() } catch (e) { setError(plainText(e)); setBusy(null) }
  }
  const vau = () => (info.vau.path ? Promise.resolve() : setup.vau(false).then(() => {}, (e) => console.error("vau:", e)))
  const go = () => run("go", async () => {
    await vau()
    await setup.choose(kind === "new" ? { kind, name: name.trim(), parent, starter } : { kind, path: folder })
    await setup.finish()
  })
  const pick = async (set: (p: string) => void) => { const p = await setup.pick(); if (p) set(p) }
  const own = folder && !info.obsidian.some((o) => o.path === folder)

  return (
    <form className="flex min-h-0 flex-1 flex-col px-10 pt-12 pb-6" data-step="vault"
      onSubmit={(e) => { e.preventDefault(); if (!busy && ready) void go() }}>
      <div className="flex flex-col items-center gap-1.5 pb-6 text-center">
        <img src="icon.svg" alt="" className="mb-1 size-[52px]" />
        <h1 className="text-[22px] leading-[28px] font-semibold tracking-[-0.01em]">Welcome to Vaultite</h1>
        <p className="max-w-[360px] text-muted-foreground">Your notes, as plain Markdown files in a folder you own.</p>
      </div>
      <Options name="vault" value={kind} onChange={(v) => { setKind(v); setError("") }} options={[
        { value: "new", icon: FolderPlus, title: "Create a vault", sub: "A new folder for your notes" },
        { value: "open", icon: FolderOpen, title: "Open a folder", sub: info.obsidian.length ? "Your Obsidian vaults work too" : "Notes you already have" },
      ]} />
      <div className="-mx-1 mt-5 min-h-0 flex-1 overflow-y-auto px-1 pt-0.5">
        {kind === "new" ? (
          <div className="flex flex-col gap-3" data-new>
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Vault name" data-vault-name spellCheck={false} autoFocus onFocus={(e) => e.target.select()} className={cn(field, "w-60")} />
            </Field>
            <Field label="In">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Location">
                {icloud && <Chip on={parent === icloud} onClick={() => setParent(icloud)} data-place="icloud">iCloud Drive</Chip>}
                <Chip on={parent === documents} onClick={() => setParent(documents)} data-place="documents">Documents</Chip>
                <Chip on={parent !== documents && parent !== icloud} onClick={() => void pick(setParent)} data-place="other"
                  tip={parent !== documents && parent !== icloud ? short(parent, home) : undefined}>
                  {parent !== documents && parent !== icloud ? base(parent) : "Other…"}
                </Chip>
              </div>
            </Field>
            <Field label="">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={starter} onChange={(e) => setStarter(e.target.checked)} data-starter className="size-3.5 accent-[var(--primary)]" />
                <span>Start with a few example notes</span>
              </label>
            </Field>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5" data-open>
            <div role="radiogroup" aria-label="Folders" className="flex flex-col gap-1">
              {info.obsidian.map((o) => (
                <Row key={o.path} title={o.name} tip={short(o.path, home)} on={folder === o.path} onClick={() => setFolder(o.path)} data-obsidian={o.name} />
              ))}
              {own && <Row title={base(folder)} tip={short(folder, home)} on onClick={() => setFolder(folder)} data-own />}
              <Row title={info.obsidian.length || own ? "Another folder…" : "Choose a folder…"} icon={FolderOpen} onClick={() => void pick(setFolder)} data-pick />
            </div>
            <p className="px-1 pt-1 text-[12px] leading-[16px] text-muted-foreground">Vaultite keeps its settings in a .vaultite folder there and changes nothing else.</p>
          </div>
        )}
      </div>
      {error && <p role="alert" className="flex items-start gap-1.5 pb-3 text-destructive"><CircleAlert className="mt-px size-4 shrink-0" />{error}</p>}
      {!info.vau.path && <p className="pb-1 text-[12px] leading-[16px] text-muted-foreground" data-vau-line>Vaultite also adds its command line, vau, to {info.vauHome}.</p>}
      <PageFoot className="pt-3"
        left={
          <Button size="small" look="quiet" className="-ml-2 h-8 gap-1.5 px-2" disabled={!!busy} busy={busy === "sandbox"} onClick={() => void run("sandbox", async () => { await vau(); await setup.sandbox() })} data-look>
            <FlaskConical className="size-3.5" strokeWidth={2.25} />Try the playground
          </Button>
        }
        right={
          <Button look="primary" className="h-8 min-w-[112px] px-4 text-[13px]" type="submit" disabled={!ready || busy === "sandbox"} busy={busy === "go"} data-next>
            {kind === "new" ? "Create vault" : "Open vault"}
          </Button>
        } />
    </form>
  )
}

const field = "h-7 rounded-[6px] border-[0.5px] border-border bg-background px-2 text-[13px] outline-none focus:ring-2 focus:ring-primary/40"

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 shrink-0 text-right text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function Chip({ on, children, onClick, tip, ...p }: { on: boolean; children: ReactNode; onClick: () => void; tip?: string } & Record<`data-${string}`, unknown>) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} data-tip={tip} {...p}
      className={cn("h-7 max-w-[200px] cursor-pointer truncate rounded-[6px] border-[0.5px] px-3 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none",
        on ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:bg-foreground/[0.05]")}>
      {children}
    </button>
  )
}

function Options<T extends string>({ name, value, options, onChange }: { name: string; value: T; onChange: (v: T) => void
  options: { value: T; icon: LucideIcon; title: string; sub: string }[] }) {
  return (
    <div role="radiogroup" className="grid grid-cols-2 gap-2.5">
      {options.map((o) => {
        const on = value === o.value
        return (
          <label key={o.value} data-choice={o.value}
            className={cn("relative flex cursor-pointer items-start gap-3 rounded-[10px] border-[0.5px] px-3.5 py-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/50",
              on ? "border-primary bg-primary/[0.07] shadow-[inset_0_0_0_0.5px_var(--primary)]" : "border-border hover:bg-foreground/[0.03]")}>
            <input type="radio" name={name} value={o.value} checked={on} onChange={() => onChange(o.value)} className="sr-only" />
            <o.icon className={cn("mt-px size-5 shrink-0", on ? "text-primary" : "text-muted-foreground")} strokeWidth={1.75} />
            <span className="min-w-0">
              <span className="block font-medium">{o.title}</span>
              <span className="block text-[12px] leading-[16px] text-muted-foreground">{o.sub}</span>
            </span>
          </label>
        )
      })}
    </div>
  )
}

function Row({ icon: Icon, title, tip, on, onClick, ...p }: { icon?: LucideIcon; title: string; tip?: string; on?: boolean; onClick: () => void }
  & Record<`data-${string}`, unknown>) {
  const action = on === undefined
  return (
    <button type="button" role={action ? undefined : "radio"} aria-checked={action ? undefined : on} onClick={onClick} data-tip={tip} {...p}
      className={cn("flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none",
        on ? "bg-primary/[0.09] text-foreground" : "hover:bg-foreground/[0.05]", action && "text-muted-foreground hover:text-foreground")}>
      {Icon ? <Icon className="size-4 shrink-0" strokeWidth={2} /> : <VaultMark on={!!on} />}
      <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
      {on && <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />}
    </button>
  )
}

const VaultMark = ({ on }: { on: boolean }) => <FolderOpen className={cn("size-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} strokeWidth={2} />
