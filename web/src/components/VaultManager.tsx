import { useEffect, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight, FlaskConical, Folder, FolderPlus, Server, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/Button"
import { Bar, Stone } from "@/components/kit"
import { FIELD, VaultRow } from "@/components/VaultRow"
import type { FolderList, KnownVault, VaultBackend, VaultList } from "@/core/webvaults"
import { useKeptCount } from "@/core/heights"
import { plainText } from "../../../core/plainerror.ts"
import { nicknameTyped, vaultName } from "../../../core/vaultname.ts"

const short = (p: string, home?: string) => (home && p.startsWith(home + "/") ? `~${p.slice(home.length)}` : p)

export function VaultManager({ backend, wide }: { backend: VaultBackend
  wide?: boolean }) {
  const [list, setList] = useState<VaultList | null>(null)
  const [error, setError] = useState("")
  const [step, setStep] = useState<"home" | "create" | "connect" | "browse-open" | "browse-create">("home")
  const [address, setAddress] = useState("")
  const [name, setName] = useState("")
  const [parent, setParent] = useState("")
  const [busy, setBusy] = useState(false)
  const [home, setHome] = useState<string | undefined>()
  const load = () => backend.list().then((l) => { setList(l); if (l.home) setHome(l.home) }, (e) => setError(plainText(e)))
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the list loads once, as it opens
  useEffect(() => { load(); return backend.watch?.(load) }, [])
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError("")
    try { await fn(); await load() } catch (e) { setError(plainText(e)) } finally { setBusy(false) }
  }
  const setNickname = async (v: KnownVault, typed: string) => {
    const nickname = nicknameTyped(typed, v.path) ?? undefined
    setError("")
    setList((l) => l && { ...l, vaults: l.vaults.map((x) => (x.path === v.path ? { ...x, nickname, name: vaultName(x.path, nickname) } : x)) })
    try { await backend.nickname?.(v.path, typed) } catch (e) { setError(plainText(e, "Couldn't set the nickname")) }
    await load()
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
  const rows = useKeptCount("vaults", list?.vaults.length, 2)
  const left = (
    <nav aria-label="Vaults" className={cn("flex min-h-0 flex-col", wide ? "w-64 shrink-0 overflow-y-auto border-r-[0.5px] border-border bg-sidebar p-2 pt-12" : "mb-5")}>
      {!wide && <h3 className="mb-1 px-1 text-[12px] font-semibold text-muted-foreground">Your vaults</h3>}
      {!vaults.length && list && <p className="px-2 py-1 text-[13px] text-muted-foreground">No vaults yet.</p>}
      {!list && !error && (
        <div className="loading-in" aria-busy data-vaults-loading>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex flex-col px-2.5 py-1.5">
              <span className="text-[13px]"><Bar w={i % 2 ? "40%" : "55%"} /></span>
              <span className="text-[12px]"><Bar w={i % 2 ? "70%" : "62%"} /></span>
            </div>
          ))}
        </div>
      )}
      {vaults.map((v) => (
        <VaultRow key={v.path} v={v} here={v.path === list?.current} busy={busy} open={() => void run(() => backend.open(v.path))}
          sub={v.sandbox && backend.playground ? "Made up, fresh each time it opens" : v.remote ? `On ${new URL(v.path).host}` : short(v.path, home)}
          nickname={backend.nickname && !v.sandbox && !v.remote ? (typed) => void setNickname(v, typed) : undefined}
          reveal={backend.reveal && !v.remote ? () => backend.reveal!(v.path) : undefined} remove={() => void run(() => backend.remove(v.path))} />
      ))}
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
            className={cn(FIELD, "w-44")} />
        </Setting>
        <Setting title="Location" sub={parent ? short(parent, home) : "Where the vault's folder goes."}>
          <Button size="small" look="outline" onClick={pickParent}>Browse</Button>
        </Setting>
        <div><Button size="small" look="primary" disabled={!name.trim() || !parent || busy} onClick={() => run(async () => { await backend.create(parent, name.trim()); setStep("home"); setName("") })}>Create</Button></div>
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
          className={FIELD} />
        <div><Button size="small" look="primary" type="submit" disabled={!address.trim() || busy}>Connect</Button></div>
      </form>
    )
  } else {
    right = (
      <div className="flex flex-col gap-4">
        {wide && (
          <div className="flex flex-col items-center gap-2 py-4">
            <img src="icon.svg" alt="" className="size-16" />
            <h2 className="text-[20px] font-semibold">Vaultite</h2>
          </div>
        )}
        <Setting icon={FolderPlus} title="Create new vault" sub="A new folder for your notes and dashboards.">
          <Button size="small" look="primary" onClick={() => setStep("create")}>Create</Button>
        </Setting>
        <Setting icon={Folder} title="Open folder as vault" sub="A folder of Markdown files you already have.">
          <Button size="small" look="outline" onClick={openFolder} disabled={busy}>Open</Button>
        </Setting>
        {backend.connect && (
          <Setting icon={Server} title="Connect to a server" sub="A Vaultite server on your network, like a Mac at home or a Linux server.">
            <Button size="small" look="outline" onClick={() => setStep("connect")} disabled={busy}>Connect</Button>
          </Setting>
        )}
        {backend.playground && (
          <Setting icon={FlaskConical} title="Try the playground" sub="A made-up vault to try Vaultite in, fresh each time it opens.">
            <Button size="small" look="outline" onClick={() => void run(backend.playground!)} disabled={busy} data-playground>Open</Button>
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

function Setting({ icon: Icon, title, sub, children }: { icon?: LucideIcon; title: string; sub: string; children: ReactNode }) {
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

const BackButton = ({ onClick }: { onClick: () => void }) => (
  <button type="button" onClick={onClick} className="flex h-7 w-fit cursor-pointer items-center gap-0.5 rounded-[6px] pr-2 text-[13px] text-primary hover:bg-foreground/[0.05]">
    <ChevronLeft className="size-4" strokeWidth={2.25} />Back
  </button>
)

function FolderBrowser({ backend, label, onPick, onCancel, onHome }: { backend: VaultBackend; label: string
  onPick: (path: string) => void; onCancel: () => void; onHome: (home: string) => void }) {
  const [at, setAt] = useState<FolderList | null>(null)
  const [error, setError] = useState("")
  const go = (p?: string) => backend.folders!(p).then((l) => { setAt(l); onHome(l.home); setError("") }, (e) => setError(plainText(e)))
  // eslint-disable-next-line react-hooks/exhaustive-deps -- starts at the home folder, once
  useEffect(() => { go() }, [])
  return (
    <div className="flex flex-col gap-3">
      <BackButton onClick={onCancel} />
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" data-tip={at?.path} data-tip-trunc>{at ? short(at.path, at.home) : <Bar w="40%" />}</span>
        <Button size="small" look="primary" disabled={!at} onClick={() => at && onPick(at.path)}>{label}</Button>
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
              {f.vault ? <Stone className="size-4 shrink-0 text-primary" /> : <Folder className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />}
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <ChevronRight className="size-3.5 shrink-0 text-tertiary" strokeWidth={2.25} />
            </button>
          </li>
        ))}
        {at && !at.folders.length && <li className="px-2.5 py-2 text-[13px] text-muted-foreground">No folders here.</li>}
        {!at && !error && Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="loading-in flex h-8 items-center gap-2 px-2.5 text-[13px]" aria-busy data-folders-loading>
            <span className="skeleton size-4 shrink-0 rounded-[4px]" />
            <span className="min-w-0 flex-1"><Bar w={["38%", "52%", "30%", "45%", "60%", "34%"][i]} /></span>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
    </div>
  )
}
