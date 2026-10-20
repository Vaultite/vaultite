import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowUp, Eye, EyeOff, File, Folder, PenLine, RefreshCw, Server } from "lucide-react"
import { fmtAgo, get, post, machinePath, notify, notifyError, op, Panel, Loading, Empty, Bar, FilterField, Segmented, useKeptCount, useMachines, type ViewCtx, errorText } from "@vaultite"
import { FilePreview, fmtSize } from "./Preview"

type Entry = { name: string; dir: boolean; link: boolean; size: number | null; mtime?: number | null }
type Listing = { path: string; parent: string | null; entries: Entry[]; truncated: boolean }
type Recent = { path: string; files: { path: string; size: number; mtime: number }[]; truncated: boolean }
const control = "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-border px-3 text-[13px] hover:bg-accent disabled:opacity-50 md:min-h-8 md:min-w-8 md:px-2"
const field = "min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-[16px] outline-none focus:ring-2 focus:ring-primary/40 md:min-h-8 md:text-[13px]"
const muted = "shrink-0 text-[12px] tabular-nums text-muted-foreground"
const row = "flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-[14px] md:min-h-7"
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
const parentOf = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/"
const join = (dir: string, name: string) => `${dir.replace(/\/$/, "")}/${name}`

/** The `machine-files` arg opening `file` (absolute) selected in its folder: other plugins deep-link files with it. */
export const machineFileArg = (id: string, file: string) => `${id}|${parentOf(file)}|${file}`

export function MachineFiles({ arg, setArg }: ViewCtx) {
  const [id, folder = "~", ...rest] = arg.split("|")
  const selected = rest.join("|") || null
  const machine = useMachines()?.find((m) => m.id === id)
  const [data, setData] = useState<Listing | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const [editing, setEditing] = useState(false)
  const [filter, setFilter] = useState("")
  const [sort, setSort] = useState<"name" | "recent">("name")
  const [hidden, setHidden] = useState(false)
  const [recent, setRecent] = useState<Recent | null>(null)
  const recents = useRef(new Map<string, Recent | null>())
  const online = machine?.online
  useEffect(() => {
    let on = true
    setBusy(true); setError("")
    get<Listing>(machinePath(id, `fs/list?path=${encodeURIComponent(folder)}`)).then((d) => { if (on) setData(d) }, (e) => { if (on) setError(errorText(e)) }).finally(() => { if (on) setBusy(false) })
    return () => { on = false }
  }, [id, folder, tick, online])
  useEffect(() => setFilter(""), [id, folder])
  const here = data?.path
  useEffect(() => {
    if (!here) return
    const key = `${id}|${here}`, had = recents.current.get(key)
    setRecent(had ?? null)
    if (had !== undefined) return
    let on = true
    // An older file agent has no fs/recent (400): the section stays away.
    get<Recent>(machinePath(id, `fs/recent?path=${encodeURIComponent(here)}`)).then((d) => d, () => null).then((d) => { recents.current.set(key, d); if (on) setRecent(d) })
    return () => { on = false }
  }, [id, here, tick])
  const go = (p: string) => { setData(null); setEditing(false); setArg(`${id}|${p}`) }
  const open = (file: string) => setArg(`${id}|${parentOf(file) === here ? folder : parentOf(file)}|${file}`)
  const refresh = () => { recents.current.clear(); setTick((n) => n + 1) }
  const entries = useMemo(() => {
    if (!data) return []
    const q = filter.trim().toLowerCase()
    const list = data.entries.filter((e) => (hidden || !e.name.startsWith(".")) && (!q || e.name.toLowerCase().includes(q)))
    return list.sort(sort === "recent" ? (a, b) => (b.mtime ?? 0) - (a.mtime ?? 0) : (a, b) => Number(b.dir) - Number(a.dir) || collator.compare(a.name, b.name))
  }, [data, filter, hidden, sort])
  const crumbs = useMemo(() => {
    const p = data?.path ?? folder, home = machine?.home?.replace(/\/$/, "")
    const inHome = !!home && (p === home || p.startsWith(`${home}/`))
    const base = inHome ? home! : ""
    const list = [{ label: inHome ? "~" : "/", to: inHome ? home! : "/" }]
    let at = base
    for (const part of p.slice(base.length).split("/").filter(Boolean)) { at = `${at}/${part}`; list.push({ label: part, to: at }) }
    return list
  }, [data?.path, folder, machine?.home])
  const rows = useKeptCount(`machine-files:${id}|${folder}`, data ? entries.length : undefined)
  const recentFiles = recent?.files.filter((f) => hidden || !f.path.slice((here?.length ?? 0) + 1).split("/").some((s) => s.startsWith("."))).slice(0, 25)
  return <div className="@container space-y-3 pb-8" data-machine-files={id}>
    <header><h1 className="text-[24px]">{machine?.label || id}</h1><p className="text-[13px] text-muted-foreground">Read-only files{machine?.via ? ` · Via ${machine.via}` : ""}{online === false ? " · Offline" : ""}</p></header>
    <div className="flex items-center gap-2">
      <button type="button" className={control} disabled={!data?.parent} onClick={() => data?.parent && go(data.parent)} aria-label="Parent folder" data-tip="Parent folder"><ArrowUp size={16} /></button>
      {editing ? <PathForm initial={data?.path ?? folder} go={go} cancel={() => setEditing(false)} />
        : <nav aria-label="Folder path" className="flex min-w-0 flex-1 flex-wrap items-center text-[14px]">
          {crumbs.map((c, i) => <span key={c.to} className="inline-flex min-w-0 items-center">
            {i > 0 && (i > 1 || crumbs[0].label === "~") && <span className="text-muted-foreground">/</span>}
            <button type="button" onClick={() => go(c.to)} aria-current={i === crumbs.length - 1 ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-md px-1.5 break-all hover:bg-accent md:min-h-7 ${i === crumbs.length - 1 ? "font-medium" : "text-muted-foreground"}`}>{c.label}</button>
          </span>)}
        </nav>}
      {!editing && <button type="button" className={control} onClick={() => setEditing(true)} aria-label="Go to path" data-tip="Go to path"><PenLine size={16} /></button>}
      <button type="button" className={control} onClick={refresh} aria-label="Refresh files" data-tip="Refresh"><RefreshCw size={16} /></button>
    </div>
    {error && <p role="alert" className="text-[14px] text-destructive">{error}</p>}
    <div className="grid min-w-0 grid-cols-1 gap-4 @2xl:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <FilterField value={filter} onChange={setFilter} placeholder="Filter this folder" className="basis-40" />
          <Segmented label="Sort" value={sort} onChange={setSort} options={[{ value: "name", label: "Name" }, { value: "recent", label: "Recent" }]} />
          <button type="button" className={control} aria-pressed={hidden} onClick={() => setHidden(!hidden)} aria-label={hidden ? "Hide hidden files" : "Show hidden files"} data-tip={hidden ? "Hide hidden files" : "Show hidden files"}>{hidden ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </div>
        {busy && !data && (rows ? (
          <div className="loading-in" aria-busy>
            {Array.from({ length: rows }, (_, i) => <div key={i} className={row}>
              <span className="skeleton size-4 shrink-0" /><span className="min-w-0 flex-1"><Bar w={`${[45, 30, 55, 38][i % 4]}%`} /></span>
            </div>)}
          </div>
        ) : <Loading />)}
        <div aria-label="Files" data-keylist className="min-w-0">
          {data && !entries.length && <Empty>{filter ? "Nothing here matches." : data.entries.length ? "Only hidden files here." : "This folder is empty."}</Empty>}
          {data && entries.map((e) => { const p = join(data.path, e.name); return <button type="button" key={e.name} data-keyrow
            onClick={() => e.dir ? go(p) : open(p)} className={`${row} hover:bg-accent ${selected === p ? "bg-accent" : ""}`}>
            {e.dir ? <Folder size={16} className="shrink-0 text-muted-foreground" /> : <File size={16} className="shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1 break-all">{e.name}{e.link ? " ↗" : ""}</span>
            {!e.dir && e.size != null && <span className={muted}>{fmtSize(e.size)}</span>}
            {e.mtime != null && <span className={`${muted} hidden min-w-16 text-right @md:inline`}>{fmtAgo(e.mtime)}</span>}
          </button> })}
          {data?.truncated && <p className="text-[13px] text-muted-foreground">Showing the first 5,000 entries.</p>}
        </div>
      </div>
      <div className={`min-w-0 ${selected ? "order-first @2xl:order-none" : ""}`}>
        {selected ? <FilePreview key={selected} id={id} path={selected} tick={tick} />
          : recentFiles?.length ? <section aria-label="Recently changed" className="space-y-1">
            <h2 className="pb-1 text-[15px] font-medium">Recently changed</h2>
            <div data-keylist>{recentFiles.map((f) => { const dir = parentOf(f.path), rel = here && dir.startsWith(here) ? dir.slice(here.length).replace(/^\//, "") : dir
              return <button type="button" key={f.path} data-keyrow onClick={() => open(f.path)} className={`${row} hover:bg-accent`}>
                <File size={16} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 break-all">{f.path.slice(f.path.lastIndexOf("/") + 1)}{rel && <span className="ml-2 font-mono text-[12px] text-muted-foreground">{rel}</span>}</span>
                <span className={muted}>{fmtAgo(f.mtime)}</span>
              </button> })}</div>
          </section>
          : data && <Empty>Choose a file to read it.</Empty>}
      </div>
    </div>
  </div>
}

function PathForm({ initial, go, cancel }: { initial: string; go: (p: string) => void; cancel: () => void }) {
  const [path, setPath] = useState(initial)
  return <form className="flex min-w-0 flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); if (path.trim()) go(path.trim()) }}>
    <input className={field} aria-label="Folder path" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); cancel() } }}
      spellCheck={false} autoCapitalize="off" autoComplete="off" autoFocus />
    <button className={control}>Open</button>
  </form>
}

export function EnrollMachine() {
  const machines = useMachines()
  const [relay, setRelay] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const servers = (machines ?? []).filter((m) => !m.dial && m.online)
  const send = async () => {
    setBusy(true)
    try {
      if (relay) await post(`machines/${relay}/approve`, { code })
      else await op("machines.approve", { code })
      setCode(""); notify("Machine approved. Its files will appear when it connects.")
    } catch (e) { notifyError(e) } finally { setBusy(false) }
  }
  return <Panel title="Connect an agent machine" icon={Server}>
    <p className="text-[14px] text-muted-foreground">Run the file agent in the VM, then approve its enrollment code here. It can only list folders and read files.</p>
    <p className="mt-2 text-[13px] text-muted-foreground">Download <span className="font-mono">/machines/agent.py</span> from your relay server’s public MCP address, then run <span className="font-mono">python3 agent.py enroll &lt;public address&gt; &lt;machine-id&gt;</span>.</p>
    <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void send() }}>
      <select aria-label="Relay server" className={field} value={relay} onChange={(e) => setRelay(e.target.value)}>
        <option value="">This server</option>{servers.filter((m) => !m.self).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <input className={field} aria-label="Machine enrollment code" placeholder="Enrollment code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="off" />
      <button className={control} disabled={busy || code.length !== 8}>Connect</button>
    </form>
  </Panel>
}
