import { useState } from "react"
import { Server } from "lucide-react"
import { notify, notifyError, op, Panel, post, useMachines } from "@vaultite"

export const control = "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-border px-3 text-[13px] hover:bg-accent disabled:opacity-50 md:min-h-8 md:min-w-8 md:px-2"
export const field = "min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-[16px] outline-none focus:ring-2 focus:ring-primary/40 md:min-h-8 md:text-[13px]"

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
