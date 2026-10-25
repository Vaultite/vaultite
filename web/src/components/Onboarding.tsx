// Set up Vaultite, the desktop app's first-run window (web/onboarding.html; electron/setup.ts): the vault, the coding
// agents here, then the Mac's permissions they use. Settings > Permissions opens it again at the agents, for its vault.
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Check, ChevronRight, CircleAlert, CircleCheck, Copy, FlaskConical, FolderOpen, FolderPlus, LoaderCircle, Monitor, MousePointer2, MousePointerClick, RotateCw, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/Button"
import { plainText } from "../../../core/plainerror.ts"
import { signingText, STATE_TEXT, type Permission, type PermissionState, type Signing } from "../../../core/permissions.ts"

type Vau = { path: string | null; onPath: boolean; system: boolean; other: string | null }
type Chosen = { path?: string; made?: boolean; added?: boolean } | null
type VaultChoice = { kind: "new"; name: string; parent: string; starter: boolean } | { kind: "open"; path: string }
type Step = "vault" | "agents" | "permissions"
type Info = { places: { icloud: string | null; documents: string; home: string }; obsidian: { path: string; name: string }[]; vau: Vau
  /** Where it was left (a relaunch), or opened for a vault (`revisit`: no vault step). */
  at: { step: Step; vault?: string; revisit?: boolean } | null
  mac: boolean
  /** The app's name, as System Settings lists it. */
  app: string }
type Extra = { kind: "computer-use" | "connect"; state: "on" | "off" | "unavailable" }
type Harness = { id: string; name: string; path: string | null; install: string; agent?: string; extra?: Extra }
type Mac = { signing: Signing; permissions: Permission[] }

/** The preload's window.vaultite.onboarding (electron/preload.cjs): answered only for this window. */
export type SetupApi = {
  info: () => Promise<Info>
  pick: () => Promise<string | null>
  choose: (c: VaultChoice | null) => Promise<Chosen>
  vau: (system: boolean) => Promise<{ did: string; vau: Vau }>
  sandbox: () => Promise<void>
  /** The step shown, kept for a relaunch. */
  step: (step: Step) => Promise<void>
  agents: () => Promise<{ list: Harness[]; agent: string }>
  /** The companion's agent and the extras said yes to: errors by agent. */
  apply: (a: { agent: string | null; extras: string[] }) => Promise<Record<string, string>>
  permissions: () => Promise<Mac | null>
  permission: (id: string) => Promise<void>
  relaunch: () => Promise<void>
  finish: () => Promise<void>
}

/** A path as the user knows it: iCloud Drive/…, ~/… */
const short = (p: string, home: string) => {
  const icloud = `${home}/Library/Mobile Documents/com~apple~CloudDocs`
  return p === icloud || p.startsWith(icloud + "/") ? `iCloud Drive${p.slice(icloud.length)}` : p.startsWith(home + "/") ? `~${p.slice(home.length)}` : p
}
const base = (p: string) => p.split("/").filter(Boolean).pop() ?? p
const STEP_NAMES: Record<Step, string> = { vault: "Vault", agents: "Agents", permissions: "Permissions" }

export function Onboarding({ setup }: { setup: SetupApi }) {
  const [info, setInfo] = useState<Info | null>(null)
  const [step, setStep] = useState<Step>("vault")
  const [error, setError] = useState("")

  useEffect(() => {
    setup.info().then((i) => {
      setInfo(i)
      if (i.at) setStep(i.at.step)
      // vau comes installed, like Obsidian's CLI: in ~/.local/bin, no password (what agents in the terminal use).
      if (!i.vau.path) setup.vau(false).catch((e) => console.error("vau:", e))
    }, (e) => setError(plainText(e)))
  }, [setup])

  if (!info) {
    return <div className="grid h-dvh place-items-center text-[13px] text-muted-foreground">{error || <LoaderCircle className="size-5 animate-spin" />}</div>
  }
  const steps: Step[] = [...(info.at?.revisit ? [] : ["vault" as const]), "agents", ...(info.mac ? ["permissions" as const] : [])]
  const at = steps.indexOf(step)
  const go = (s: Step) => { setStep(s); setup.step(s).catch((e) => console.error("setup step:", e)) }
  const nav: Nav = {
    back: at > 0 ? () => go(steps[at - 1]) : undefined,
    next: at < steps.length - 1 ? () => go(steps[at + 1]) : () => setup.finish(),
    last: at === steps.length - 1 ? (info.at?.revisit ? "Done" : "Open vault") : null,
  }

  return (
    <div className="flex h-dvh select-none flex-col overflow-hidden text-[13px]">
      <div className="vault-manager-drag fixed inset-x-0 top-0 h-10" />
      <Steps steps={steps} at={step} />
      {/* (the vault step stays, hidden: back to it, its choice is as it was left) */}
      {steps.includes("vault") && <VaultStep setup={setup} info={info} nav={nav} hidden={step !== "vault"} />}
      {step === "agents" && <AgentsStep setup={setup} home={info.places.home} nav={nav} />}
      {step === "permissions" && <PermissionsStep setup={setup} app={info.app} nav={nav} />}
    </div>
  )
}

/** Where a step goes: back, on (or finish, the last's label saying so). */
type Nav = { back?: () => void; next: () => unknown; last: string | null }

/** The steps, in the title bar: done ones ticked. */
function Steps({ steps, at }: { steps: Step[]; at: Step }) {
  const i = steps.indexOf(at)
  return (
    <ol aria-label="Steps" data-steps className="pointer-events-none fixed inset-x-0 top-0 flex h-10 items-center justify-center gap-1.5 text-[12px] font-medium">
      {steps.map((s, k) => (
        <li key={s} aria-current={k === i ? "step" : undefined} className={cn("flex items-center gap-1.5", k > i && "text-muted-foreground")}>
          <span className={cn("grid size-4 place-items-center rounded-full border text-[10px] tabular-nums",
            k < i ? "border-primary bg-primary text-primary-foreground" : k === i ? "border-primary text-primary" : "border-border")}>
            {k < i ? <Check className="size-2.5" strokeWidth={3.5} /> : k + 1}
          </span>
          {STEP_NAMES[s]}
          {k < steps.length - 1 && <span aria-hidden className="ml-0.5 h-px w-5 bg-border" />}
        </li>
      ))}
    </ol>
  )
}

/** A step's page: its title, what it's for, its content (which scrolls if it must), and its buttons. */
function Page({ step, title, sub, children, footer }: { step: Step; title: string; sub: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[480px] flex-1 flex-col px-6 pt-14" data-step={step}>
      <h1 className="text-[20px] font-semibold tracking-[-0.01em]">{title}</h1>
      <p className="pt-1 pb-4 text-muted-foreground">{sub}</p>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-2">{children}</div>
      {footer}
    </div>
  )
}

function Footer({ nav, skip, busy, label, onNext, error }: { nav: Nav; skip?: boolean; busy?: boolean; label?: string; onNext?: () => unknown; error?: string }) {
  return (
    <>
      {error && <p role="alert" className="flex items-start gap-1.5 pt-2 text-[13px] text-destructive"><CircleAlert className="mt-px size-4 shrink-0" />{error}</p>}
      <footer className="flex shrink-0 items-center gap-2 pt-3 pb-6">
        {nav.back && <Button size="small" look="quiet" className="h-9 px-3 text-[14px]" disabled={busy} onClick={nav.back} data-back>Back</Button>}
        <span className="flex-1" />
        {skip && !nav.last && <Button size="small" look="quiet" className="h-9 px-3 text-[14px]" disabled={busy} onClick={() => void nav.next()} data-skip>Skip</Button>}
        <Button size="small" look="primary" className="h-9 min-w-24 px-5 text-[14px]" busy={busy} autoFocus onClick={() => void (onNext ?? nav.next)()} data-next>
          {label ?? nav.last ?? "Continue"}
        </Button>
      </footer>
    </>
  )
}

// ---------- 1. the vault ----------
function VaultStep({ setup, info, nav, hidden }: { setup: SetupApi; info: Info; nav: Nav; hidden: boolean }) {
  const [kind, setKind] = useState<"new" | "open">("new")
  const [name, setName] = useState("Vault")
  const [parent, setParent] = useState(info.places.icloud ?? info.places.documents)
  const [starter, setStarter] = useState(true)
  const [folder, setFolder] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  // (back here from a later step: the same choice goes on without making it again)
  const [made, setMade] = useState<string | null>(null)

  const { icloud, documents, home } = info.places
  const ready = kind === "new" ? !!name.trim() && !!parent : !!folder
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError("")
    try { await fn() } catch (e) { setError(plainText(e)) } finally { setBusy(false) }
  }
  const choice: VaultChoice = kind === "new" ? { kind, name: name.trim(), parent, starter } : { kind, path: folder }
  const key = JSON.stringify(choice)
  const go = () => run(async () => {
    if (made !== key) await setup.choose(choice)
    setMade(key)
    await nav.next()
  })
  const pick = async (set: (p: string) => void) => { const p = await setup.pick(); if (p) set(p) }

  return (
    <form className="mx-auto flex min-h-0 w-full max-w-[460px] flex-1 flex-col px-6 pt-12" data-step="vault" hidden={hidden}
      onSubmit={(e) => { e.preventDefault(); if (!busy && ready) void go() }}>
      <div className="flex flex-col items-center gap-2 pb-5 text-center">
        <img src="icon.svg" alt="" className="size-14" />
        <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Welcome to Vaultite</h1>
        <p className="text-muted-foreground">Your vault is a folder where you and your agents work together.</p>
      </div>
      <Options name="vault" value={kind} onChange={(v) => setKind(v as "new" | "open")} options={[
        { value: "new", icon: FolderPlus, title: "New vault" },
        { value: "open", icon: FolderOpen, title: "Open folder" },
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
            {/* Nothing outside .vaultite/ unless asked: a Start here note, and AGENTS.md and CLAUDE.md pointing agents at the rules. */}
            <label className="flex items-start gap-3"><span className="w-16 shrink-0" />
              <span className="flex flex-1 items-start gap-2">
                <input type="checkbox" checked={starter} onChange={(e) => setStarter(e.target.checked)} data-starter className="mt-0.5 size-3.5 accent-[var(--primary)]" />
                <span>Start with example notes</span>
              </span>
            </label>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 px-1">
              <h2 className="flex-1 text-[12px] font-semibold text-muted-foreground">{!!info.obsidian.length && "Vaults on this machine"}</h2>
              <Button size="small" look="outline" onClick={() => void pick(setFolder)} data-pick>Choose a folder…</Button>
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
        <Button size="small" look="primary" className="h-9 px-5 text-[14px]" type="submit" disabled={busy || !ready} autoFocus data-next>
          {busy ? <LoaderCircle className="mx-auto size-4 animate-spin" /> : made === key ? "Continue" : kind === "new" ? "Create vault" : "Open vault"}
        </Button>
        <Button size="small" look="outline" className="h-9 px-5 text-[14px]" disabled={busy} onClick={() => void run(() => setup.sandbox())} data-look>
          <span className="flex items-center justify-center gap-1.5"><FlaskConical className="size-4" strokeWidth={2} />Try the playground first</span>
        </Button>
      </footer>
    </form>
  )
}


// ---------- 2. the coding agents ----------
/** Each agent's extra, and what it gives. (Codex's computer use is an app of its own, which macOS asks about apart.) */
const EXTRA: Record<string, [string, string]> = {
  "claude-code": ["Computer use in this vault", "sees and uses your apps"], codex: ["Computer use", "through the Codex app, with its own permissions"],
  openclaw: ["Connect to this vault", "it gets the vault's tools"], hermes: ["Connect to this vault", "it gets the vault's tools"],
}

function AgentsStep({ setup, home, nav }: { setup: SetupApi; home: string; nav: Nav }) {
  const [list, setList] = useState<Harness[] | null>(null)
  const [agent, setAgent] = useState<string | null>(null)
  const [extras, setExtras] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const look = useCallback(() => setup.agents().then(({ list, agent }) => {
    setList(list)
    // The found ones' extras ticked: nothing changes outside the vault until Continue.
    setExtras(new Set(list.filter((h) => h.path && h.extra?.state === "off").map((h) => h.id)))
    const runs = list.filter((h) => h.path && h.agent)
    setAgent((runs.find((h) => h.agent === agent.split("_")[0]) ?? runs[0])?.agent ?? null)
    setError("")
  }, (e) => setError(plainText(e, "Couldn't look for agents"))), [setup])
  useEffect(() => { void look() }, [look])

  const go = async () => {
    // (some failed: a second press goes on anyway)
    if (Object.keys(failed).length) return nav.next()
    setBusy(true); setError("")
    try {
      const f = await setup.apply({ agent, extras: [...extras] })
      setFailed(f)
      if (!Object.keys(f).length) await nav.next()
    } catch (e) { setError(plainText(e)) } finally { setBusy(false) }
  }
  const found = list?.filter((h) => h.path) ?? [], missing = list?.filter((h) => !h.path) ?? []
  const runs = found.filter((h) => h.agent)
  const tick = (id: string, on: boolean) => setExtras((x) => { const n = new Set(x); if (on) n.add(id); else n.delete(id); return n })

  return (
    <Page step="agents" title="Your agents" sub="Vaultite runs the coding agents you use in its terminals; the default one is your companion."
      footer={<Footer nav={nav} skip busy={busy} onNext={go} error={error} label={Object.keys(failed).length ? "Continue anyway" : undefined} />}>
      {!list ? <div className="grid h-24 place-items-center"><LoaderCircle className="size-5 animate-spin text-muted-foreground" /></div> : (
        <div className="flex flex-col gap-4">
          {found.length ? (
            <section className="flex flex-col gap-1.5" aria-label="Found on this computer">
              {found.map((h) => (
                <div key={h.id} data-agent={h.id} className="rounded-[8px] border-[0.5px] border-border px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    <CircleCheck className="size-4 shrink-0 text-[var(--green)]" strokeWidth={2.25} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{h.name}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">{short(h.path!, home)}</span>
                    </span>
                    {h.agent && runs.length > 1 && (
                      <button type="button" role="radio" aria-checked={agent === h.agent} onClick={() => setAgent(h.agent!)} data-default={h.id}
                        className="flex cursor-pointer items-center gap-1.5 rounded-[6px] px-1.5 py-1 text-[12px] text-muted-foreground hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none">
                        <Dot on={agent === h.agent} />Default
                      </button>
                    )}
                  </div>
                  {h.extra && (h.extra.state === "unavailable"
                    ? <p className="pt-1 pl-6.5 text-[12px] text-muted-foreground">Its computer use comes with the Codex app</p>
                    : (
                      <label className={cn("flex items-start gap-2 pt-1.5 pl-6.5", h.extra.state === "off" && "cursor-pointer")}>
                        <input type="checkbox" checked={h.extra.state === "on" || extras.has(h.id)} disabled={h.extra.state === "on" || busy}
                          onChange={(e) => tick(h.id, e.target.checked)} data-extra={h.id} className="mt-0.5 size-3.5 shrink-0 accent-[var(--primary)]" />
                        <span>{EXTRA[h.id][0]}<span className="text-muted-foreground">{h.extra.state === "on" ? ": on" : `: ${EXTRA[h.id][1]}`}</span></span>
                      </label>
                    ))}
                  {failed[h.id] && <p role="alert" className="pt-1 pl-6.5 text-[12px] text-destructive">{failed[h.id]}</p>}
                </div>
              ))}
            </section>
          ) : <p className="rounded-[8px] bg-foreground/[0.04] px-3 py-2.5 text-muted-foreground" data-none>No coding agent on this computer yet. Install one below, then check again.</p>}
          {!!missing.length && (
            <section className="flex flex-col" aria-label="Not installed">
              <div className="flex items-center px-1 pb-1">
                <h2 className="flex-1 text-[12px] font-semibold text-muted-foreground">Not installed</h2>
                <Button size="small" look="quiet" className="h-6 px-2 text-[12px]" onClick={() => void look()} data-recheck>Check again</Button>
              </div>
              {missing.map((h) => (
                <div key={h.id} data-missing={h.id} className="flex min-h-8 items-center gap-2.5 px-1">
                  <span className="w-24 shrink-0 truncate text-muted-foreground">{h.name}</span>
                  <code className="min-w-0 flex-1 truncate rounded-[5px] bg-foreground/[0.05] px-1.5 py-0.5 font-mono text-[11.5px] select-text">{h.install}</code>
                  <CopyButton text={h.install} />
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </Page>
  )
}

/** Copies a command; ticks for a moment once it has. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  const copy = () => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) }, () => {})
  return (
    <Button size="small" look="quiet" className="h-6 w-16 px-2 text-[12px]" onClick={() => void copy()} data-copy>
      {done ? <><Check className="size-3.5" strokeWidth={2.5} />Copied</> : <><Copy className="size-3.5" />Copy</>}
    </Button>
  )
}

// ---------- 3. the Mac's permissions ----------
/** What agents need first: to use the Mac (click, type) and to see it. The rest are folded away. */
const FIRST: Record<string, { icon: LucideIcon; why: string }> = {
  accessibility: { icon: MousePointerClick, why: "Lets agents click and type in your apps" },
  screen: { icon: Monitor, why: "Lets agents see what's on the screen" },
}
const DOT: Record<PermissionState, string> = { allowed: "var(--green)", denied: "var(--orange)", "not-asked": "var(--gray)", unknown: "var(--gray)" }

function PermissionsStep({ setup, app, nav }: { setup: SetupApi; app: string; nav: Nav }) {
  const [mac, setMac] = useState<Mac | null>(null)
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const [more, setMore] = useState(false)
  const [error, setError] = useState("")
  const read = useCallback(() => setup.permissions().then(setMac, (e) => setError(plainText(e, "Couldn't read the permissions"))), [setup])
  // Read again every second: a switch turned on in System Settings ticks here at once (no call here makes macOS ask).
  useEffect(() => {
    void read()
    const t = setInterval(() => void read(), 1000)
    return () => clearInterval(t)
  }, [read])
  const act = (id: string) => {
    setOpened((o) => new Set(o).add(id))
    setup.permission(id).then(read, (e) => setError(plainText(e, "Couldn't ask macOS")))
  }
  const first = mac?.permissions.filter((p) => FIRST[p.id]) ?? [], rest = mac?.permissions.filter((p) => !FIRST[p.id]) ?? []
  const label = (p: Permission) => (p.action === "ask" ? "Allow…" : p.action === "check" ? "Check" : "Open Settings")

  return (
    <Page step="permissions" title="Let agents use your Mac" sub={`Agents in ${app}'s terminals get what you allow ${app} here: one switch covers them all.`}
      footer={<Footer nav={nav} error={error} />}>
      {!mac ? <div className="grid h-24 place-items-center"><LoaderCircle className="size-5 animate-spin text-muted-foreground" /></div> : (
        <div className="flex flex-col gap-1.5">
          {first.map((p) => {
            const { icon: Icon, why } = FIRST[p.id], on = p.state === "allowed"
            return (
              <div key={p.id} data-permission={p.id} data-state={p.state} className="rounded-[8px] border-[0.5px] border-border px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <Icon className={cn("size-5 shrink-0", on ? "text-[var(--green)]" : "text-muted-foreground")} strokeWidth={2} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{p.name}</span>
                    <span className="block text-[12px] text-muted-foreground">{why}</span>
                  </span>
                  {on
                    ? <span className="dot-in flex items-center gap-1 font-medium text-[var(--green)]" data-allowed><CircleCheck className="size-4" strokeWidth={2.25} />Allowed</span>
                    : <Button size="small" look={opened.has(p.id) ? "outline" : "primary"} onClick={() => act(p.id)} data-act={p.id}>{label(p)}</Button>}
                </div>
                {!on && opened.has(p.id) && <Hint app={app} />}
                {p.id === "screen" && !on && opened.has(p.id) && (
                  <div className="flex items-center gap-2 pt-2 pl-8">
                    <span className="flex-1 text-[12px] text-muted-foreground">Switched on? {app} sees it once it relaunches.</span>
                    <Button size="small" look="outline" onClick={() => void setup.relaunch()} data-relaunch><RotateCw className="size-3.5" />Relaunch</Button>
                  </div>
                )}
              </div>
            )
          })}
          <button type="button" aria-expanded={more} onClick={() => setMore(!more)} data-more
            className="mt-2 flex cursor-pointer items-center gap-1 self-start rounded-[6px] px-1 py-0.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none">
            <ChevronRight className={cn("size-3.5 transition-transform", more && "rotate-90")} strokeWidth={2.5} />More permissions
          </button>
          {more && (
            <div className="flex flex-col">
              {rest.map((p) => (
                <div key={p.id} data-permission={p.id} data-state={p.state} className="flex min-h-9 items-center gap-2.5 px-1">
                  <span className="min-w-0 flex-1">
                    <span className="block">{p.name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{p.use}</span>
                  </span>
                  {p.state !== "allowed" && <Button size="small" look="quiet" className="h-6 px-2 text-[12px]" onClick={() => act(p.id)}>{label(p)}</Button>}
                  <span className="flex w-24 shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                    <span aria-hidden className="size-2 rounded-full" style={{ background: DOT[p.state] }} />{STATE_TEXT[p.state]}
                  </span>
                </div>
              ))}
            </div>
          )}
          {(mac.signing.kind === "adhoc" || mac.signing.kind === "unsigned") && <p className="px-1 pt-2 text-[12px] text-muted-foreground">{signingText(mac.signing)}.</p>}
        </div>
      )}
    </Page>
  )
}

/** What to do in System Settings, shown: a pointer goes to the app's switch and turns it on, again and again. */
function Hint({ app }: { app: string }) {
  return (
    <div className="mt-2.5 ml-8 flex items-center gap-3" data-hint>
      <div aria-hidden className="relative flex w-40 shrink-0 items-center gap-2 rounded-[6px] border-[0.5px] border-border bg-background px-2 py-1.5 shadow-sm">
        <img src="icon.svg" alt="" className="size-4" />
        <span className="min-w-0 flex-1 truncate text-[12px]">{app}</span>
        <span className="setup-hint-switch relative h-4 w-7 shrink-0 rounded-full"><span className="setup-hint-knob absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow-sm" /></span>
        <MousePointer2 className="setup-hint-pointer absolute -right-1.5 -bottom-2.5 size-4 fill-foreground text-background" strokeWidth={1.5} />
      </div>
      <span className="text-[12px] text-muted-foreground">In System Settings, switch on {app}</span>
    </div>
  )
}

// ---------- pieces ----------
const field = "h-7 rounded-[6px] border-[0.5px] border-border bg-background px-2 text-[13px] outline-none select-text focus:ring-2 focus:ring-primary/40"


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
  options: { value: string; icon: LucideIcon; title: string }[] }) {
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
