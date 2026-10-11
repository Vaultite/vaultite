import { useEffect, useState } from "react"
import { ArrowUp, File, Folder, RefreshCw, Server } from "lucide-react"
import { get, post, machinePath, notify, notifyError, op, Panel, Loading, Empty, useMachines, type ViewCtx } from "@vaultite"

type Entry = { name: string; dir: boolean; link: boolean; size: number | null }
type Listing = { path: string; parent: string | null; entries: Entry[]; truncated: boolean }
type Contents = { path: string; text?: string; base64?: string; truncated: boolean; size: number }
const control = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-3 text-[13px] hover:bg-accent disabled:opacity-50"
const field = "min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-[16px] outline-none focus:ring-2 focus:ring-primary/40"

export function MachineFiles({ arg, setArg }: ViewCtx) {
  const at = arg.indexOf("|")
  const id = at < 0 ? arg : arg.slice(0, at), folder = at < 0 ? "~" : arg.slice(at + 1)
  const machine = useMachines()?.find((m) => m.id === id)
  const [data, setData] = useState<Listing | null>(null)
  const [file, setFile] = useState<Contents | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [path, setPath] = useState(folder)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const online = machine?.online
  useEffect(() => {
    let on = true
    setPath(folder); setBusy(true); setError(""); setFile(null); setSelected(null)
    get<Listing>(machinePath(id, `fs/list?path=${encodeURIComponent(folder)}`)).then((d) => { if (on) { setData(d); setPath(d.path) } }, (e) => { if (on) setError(e.message) }).finally(() => { if (on) setBusy(false) })
    return () => { on = false }
  }, [id, folder, tick, online])
  useEffect(() => {
    if (!selected) return
    let on = true
    setBusy(true); setError(""); setFile(null)
    get<Contents>(machinePath(id, `fs/read?path=${encodeURIComponent(selected)}`)).then((d) => { if (on) setFile(d) }, (e) => { if (on) setError(e.message) }).finally(() => { if (on) setBusy(false) })
    return () => { on = false }
  }, [id, selected])
  const go = (p: string) => { setData(null); setArg(`${id}|${p}`) }
  return <div className="space-y-3 pb-8" data-machine-files={id}>
    <header><h1 className="text-[24px]">{machine?.label || id}</h1><p className="text-[13px] text-muted-foreground">Read-only files{machine?.via ? ` · Via ${machine.via}` : ""}{online === false ? " · Offline" : ""}</p></header>
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); go(path) }}>
      <button type="button" className={control} disabled={!data?.parent} onClick={() => data?.parent && go(data.parent)} aria-label="Parent folder"><ArrowUp size={16} /></button>
      <input className={field} aria-label="Folder path" value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} autoCapitalize="off" />
      <button className={control}>Open</button><button type="button" className={control} onClick={() => setTick((n) => n + 1)} aria-label="Refresh files"><RefreshCw size={16} /></button>
    </form>
    {error && <p role="alert" className="text-[14px] text-destructive">{error}</p>}
    {busy && <Loading />}
    <div className="grid min-w-0 grid-cols-1 gap-4 @2xl:grid-cols-[minmax(180px,1fr)_minmax(0,2fr)]">
      <div aria-label="Files" data-keylist className="min-w-0">
        {data && <p className="break-all pb-2 font-mono text-[12px] text-muted-foreground">{data.path}</p>}
        {data && !data.entries.length && <Empty>This folder is empty.</Empty>}
        {data?.entries.map((e) => { const p = `${data.path.replace(/\/$/, "")}/${e.name}`; return <button type="button" key={e.name} data-keyrow
          onClick={() => e.dir ? go(p) : setSelected(p)} className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-[14px] hover:bg-accent ${selected === p ? "bg-accent" : ""}`}>
          {e.dir ? <Folder size={16} className="shrink-0 text-muted-foreground" /> : <File size={16} className="shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 break-all">{e.name}{e.link ? " ↗" : ""}</span>
        </button> })}
        {data?.truncated && <p className="text-[13px] text-muted-foreground">Showing the first 5,000 entries.</p>}
      </div>
      <div className="min-w-0">
        {file ? <><p className="mb-2 break-all font-mono text-[12px] text-muted-foreground">{file.path}</p>
          {file.text !== undefined ? <pre className="whitespace-pre-wrap break-words rounded-lg border border-border bg-card p-3 font-mono text-[13px] [overflow-wrap:anywhere]" data-file-content>{file.text}</pre>
            : <Empty>Binary file · {file.size} bytes. Text preview is unavailable.</Empty>}
          {file.truncated && <p className="mt-2 text-[13px] text-muted-foreground">Preview limited to the first 1 MB.</p>}
        </> : !busy && <Empty>Choose a file to read it.</Empty>}
      </div>
    </div>
  </div>
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
