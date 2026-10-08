// Manage vaults: known vaults, create one, open a folder, or (desktop) connect to another machine's server. The desktop app
// shows it in its own window with the native picker; the web in a sheet, switching which vault the server serves.
import { useEffect, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight, Ellipsis, Folder, FolderOpen, FolderPlus, Server, Vault } from "lucide-react"
import { menuBelow } from "@/components/ContextMenu"
import { api } from "@/core/http"
import { revealLabel } from "@/core/platform"
import { cn } from "@/lib/utils"

export type KnownVault = { path: string; name: string; open?: boolean
  /** The sandbox (desktop): made up, made afresh each time it opens. */
  sandbox?: boolean
  /** Another machine's server (desktop; `path` is its address). */
  remote?: boolean }
export type VaultList = { current?: string | null; home?: string; vaults: KnownVault[] }
export type FolderList = { path: string; home: string; parent: string | null; folders: { name: string; vault: boolean }[] }
export type VaultBackend = {
  list: () => Promise<VaultList>
  open: (path: string) => Promise<unknown>
  create: (parent: string, name: string) => Promise<unknown>
  remove: (path: string) => Promise<unknown>
  /** The native folder picker (desktop). Without it, the server's folders are browsed here. */
  pick?: () => Promise<string | null>
  folders?: (path?: string) => Promise<FolderList>
  /** Show a vault's folder in Finder (desktop). */
  reveal?: (path: string) => void
  /** Open another machine's server by its address (desktop). */
  connect?: (address: string) => Promise<unknown>
}

/** The web's: the server's list, and its folders. Opening one reloads the app on the new vault. */
export const webVaults: VaultBackend = {
  list: () => api("GET", "vaults"),
  open: (path) => api("POST", "vaults/open", { path }).then(switched),
  create: (parent, name) => api("POST", "vaults/create", { parent, name }).then(switched),
  remove: (path) => api("DELETE", `vaults?path=${encodeURIComponent(path)}`),
  folders: (path) => api("GET", `vaults/folders${path ? `?path=${encodeURIComponent(path)}` : ""}`),
}

/** Another vault: the tabs of this one mean nothing there. */
function switched() {
  try { localStorage.removeItem("vaultite.tabs") } catch { /* private mode */ }
  location.replace(location.pathname)
}

const short = (p: string, home?: string) => (home && p.startsWith(home + "/") ? `~${p.slice(home.length)}` : p)

export function VaultManager({ backend, wide }: { backend: VaultBackend
  /** Two columns (its own window); in the sheet the list sits above the actions. */
  wide?: boolean }) {
  const [list, setList] = useState<VaultList | null>(null)
  const [error, setError] = useState("")
  const [step, setStep] = useState<"home" | "create" | "connect" | "browse-open" | "browse-create">("home")
  const [address, setAddress] = useState("")
  const [name, setName] = useState("")
  const [parent, setParent] = useState("")
  const [busy, setBusy] = useState(false)
  const [home, setHome] = useState<string | undefined>()
  const load = () => backend.list().then((l) => { setList(l); if (l.home) setHome(l.home) }, (e) => setError(String(e.message ?? e)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError("")
    // (without Electron's "Error invoking remote method '…':")
    try { await fn(); await load() } catch (e) { setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")) } finally { setBusy(false) }
  }
  const openFolder = async () => {
    if (!backend.pick) return setStep("browse-open")
    const p = await backend.pick()
    if (p) run(() => backend.open(p))
  }
  const pickParent = async () => {
    if (!backend.pick) return setStep("browse-create")
    const p = await backend.pick()
    if (p) setParent(p)
  }

  const vaults = list?.vaults ?? []
  const left = (
    <nav aria-label="Vaults" className={cn("flex min-h-0 flex-col", wide ? "w-64 shrink-0 overflow-y-auto border-r-[0.5px] border-border bg-sidebar p-2 pt-12" : "mb-5")}>
      {!wide && <h3 className="mb-1 px-1 text-[12px] font-semibold text-muted-foreground">Your vaults</h3>}
      {!vaults.length && list && <p className="px-2 py-1 text-[13px] text-muted-foreground">No vaults yet.</p>}
      {vaults.map((v) => {
        const here = v.path === list?.current
        return (
          <div key={v.path} className={cn("group relative flex items-center rounded-[6px]", here ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]")}>
            <button type="button" disabled={busy} onClick={() => (here ? undefined : run(() => backend.open(v.path)))}
              data-tip={here ? "This vault" : `Open ${v.name}`} className="flex min-w-0 flex-1 cursor-pointer flex-col items-start px-2.5 py-1.5 pr-8 text-left">
              <span className="w-full truncate text-[13px] font-medium">{v.name}</span>
              <span className="w-full truncate text-[12px] text-muted-foreground">{v.sandbox ? "Made up, fresh each time it opens" : v.remote ? `On ${new URL(v.path).host}` : short(v.path, home)}</span>
            </button>
            <button type="button" aria-label={`More for ${v.name}`}
              onClick={(e) => menuBelow(e, [
                ...(backend.reveal && !v.remote ? [{ label: revealLabel, icon: FolderOpen, run: () => backend.reveal!(v.path) }] : []),
                { label: "Remove from list", disabled: here, run: () => run(() => backend.remove(v.path)) },
              ])}
              className="absolute right-1 grid size-6 cursor-pointer place-items-center rounded-[4px] text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-foreground/[0.08] hover:text-foreground">
              <Ellipsis className="size-4" strokeWidth={2.25} />
            </button>
          </div>
        )
      })}
    </nav>
  )

  let right: ReactNode
  if (step === "browse-open" || step === "browse-create") {
    right = (
      <FolderBrowser backend={backend} onHome={setHome} label={step === "browse-open" ? "Open as vault" : "Choose"}
        onCancel={() => setStep(step === "browse-open" ? "home" : "create")}
        onPick={(p) => { if (step === "browse-open") { setStep("home"); run(() => backend.open(p)) } else { setParent(p); setStep("create") } }} />
    )
  } else if (step === "create") {
    right = (
      <div className="flex flex-col gap-4">
        <BackButton onClick={() => setStep("home")} />
        <h2 className="text-[17px] font-semibold">Create new vault</h2>
        <Setting title="Vault name" sub="The name of the new folder.">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My vault" aria-label="Vault name" autoFocus
            className="h-7 w-44 rounded-[6px] border-[0.5px] border-border bg-background px-2 text-[13px] outline-none focus:ring-1 focus:ring-primary/60" />
        </Setting>
        <Setting title="Location" sub={parent ? short(parent, home) : "Where the vault's folder goes."}>
          <Btn onClick={pickParent}>Browse</Btn>
        </Setting>
        <div><Btn primary disabled={!name.trim() || !parent || busy} onClick={() => run(async () => { await backend.create(parent, name.trim()); setStep("home"); setName("") })}>Create</Btn></div>
      </div>
    )
  } else if (step === "connect" && backend.connect) {
    const connect = backend.connect
    right = (
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (address.trim() && !busy) void run(async () => { await connect(address.trim()); setStep("home"); setAddress("") }) }}>
        <BackButton onClick={() => setStep("home")} />
        <h2 className="text-[17px] font-semibold">Connect to a server</h2>
        <p className="text-[13px] text-muted-foreground">One that runs Vaultite and is always on, like a Mac at home or a Linux server. It opens in a window here, as on your iPhone.</p>
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="studio.tailnet.ts.net:8447" aria-label="Server address" autoFocus
          spellCheck={false} autoCapitalize="none" data-server
          className="h-7 rounded-[6px] border-[0.5px] border-border bg-background px-2 text-[13px] outline-none focus:ring-1 focus:ring-primary/60" />
        <div><Btn primary submit disabled={!address.trim() || busy}>Connect</Btn></div>
      </form>
    )
  } else {
    right = (
      <div className="flex flex-col gap-4">
        {wide && ( // the sheet has it in its head
          <div className="flex flex-col items-center gap-2 py-4">
            <img src="icon.svg" alt="" className="size-16" />
            <h2 className="text-[20px] font-semibold">Vaultite</h2>
          </div>
        )}
        <Setting icon={FolderPlus} title="Create new vault" sub="A new folder for your notes and dashboards.">
          <Btn primary onClick={() => setStep("create")}>Create</Btn>
        </Setting>
        <Setting icon={Folder} title="Open folder as vault" sub="A folder of Markdown files you already have.">
          <Btn onClick={openFolder} disabled={busy}>Open</Btn>
        </Setting>
        {backend.connect && (
          <Setting icon={Server} title="Connect to a server" sub="A Vaultite server on your network, like a Mac at home or a Linux server.">
            <Btn onClick={() => setStep("connect")} disabled={busy}>Connect</Btn>
          </Setting>
        )}
      </div>
    )
  }
  return (
    <div className={cn(wide ? "flex h-dvh" : "flex flex-col")}>
      {left}
      <div className={cn("min-w-0 flex-1", wide && "overflow-y-auto p-8 pt-12")}>
        <div className={cn(wide && "mx-auto max-w-[420px]")}>
          {right}
          {error && <p role="alert" className="mt-4 text-[13px] text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  )
}

function Setting({ icon: Icon, title, sub, children }: { icon?: typeof Vault; title: string; sub: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-t-[0.5px] border-border pt-4">
      {Icon && <Icon className="size-5 shrink-0 text-muted-foreground" strokeWidth={2} />}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="truncate text-[12px] text-muted-foreground">{sub}</div>
      </div>
      {children}
    </div>
  )
}

function Btn({ primary, submit, children, ...p }: { primary?: boolean; submit?: boolean; children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type={submit ? "submit" : "button"} {...p}
      className={cn("h-7 shrink-0 cursor-pointer rounded-[6px] px-3 text-[13px] font-medium transition-colors disabled:cursor-default disabled:opacity-50",
        primary ? "bg-primary text-primary-foreground hover:bg-primary/85" : "border-[0.5px] border-border bg-background hover:bg-foreground/[0.05]")}>
      {children}
    </button>
  )
}

const BackButton = ({ onClick }: { onClick: () => void }) => (
  <button type="button" onClick={onClick} className="flex h-7 w-fit cursor-pointer items-center gap-0.5 rounded-[6px] pr-2 text-[13px] text-primary hover:bg-foreground/[0.05]">
    <ChevronLeft className="size-4" strokeWidth={2.25} />Back
  </button>
)

/** The server's folders, from the home folder down (web only; the desktop app has the native picker). */
function FolderBrowser({ backend, label, onPick, onCancel, onHome }: { backend: VaultBackend; label: string
  onPick: (path: string) => void; onCancel: () => void; onHome: (home: string) => void }) {
  const [at, setAt] = useState<FolderList | null>(null)
  const [error, setError] = useState("")
  const go = (p?: string) => backend.folders!(p).then((l) => { setAt(l); onHome(l.home); setError("") }, (e) => setError(String(e.message ?? e)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { go() }, [])
  return (
    <div className="flex flex-col gap-3">
      <BackButton onClick={onCancel} />
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" data-tip={at?.path} data-tip-trunc>{at ? short(at.path, at.home) : "…"}</span>
        <Btn primary disabled={!at} onClick={() => at && onPick(at.path)}>{label}</Btn>
      </div>
      <ul aria-label="Folders" className="max-h-[50dvh] overflow-y-auto rounded-[8px] border-[0.5px] border-border">
        {at?.parent && (
          <li><button type="button" onClick={() => go(at.parent!)} className="flex h-8 w-full cursor-pointer items-center gap-2 px-2.5 text-[13px] text-muted-foreground hover:bg-foreground/[0.04]">
            <ChevronLeft className="size-4" strokeWidth={2} />Up</button></li>
        )}
        {at?.folders.map((f) => (
          <li key={f.name}>
            <button type="button" onClick={() => go(`${at.path}/${f.name}`)}
              className="flex h-8 w-full cursor-pointer items-center gap-2 px-2.5 text-left text-[13px] hover:bg-foreground/[0.04]">
              {f.vault ? <Vault className="size-4 shrink-0 text-primary" strokeWidth={2} /> : <Folder className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />}
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <ChevronRight className="size-3.5 shrink-0 text-tertiary" strokeWidth={2.25} />
            </button>
          </li>
        ))}
        {at && !at.folders.length && <li className="px-2.5 py-2 text-[13px] text-muted-foreground">No folders here.</li>}
      </ul>
      {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
    </div>
  )
}
