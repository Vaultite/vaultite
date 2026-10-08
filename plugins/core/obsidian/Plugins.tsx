// Obsidian's settings sheet: the vault's Obsidian plugins, each run as it is (the original) or with what stands in for it
// here, picked in a click (obsidian.use); "Run them here" runs them all (obsidian.run-all).
import { useEffect, useState } from "react"
import { Group, notify, notifyError, op, Segmented, SettingRow, Switch } from "@vaultite"

type Row = { id: string; name: string; here: { id: string; name: string; on: boolean }[]; directory: { id: string; name: string; source: string; installed: boolean }[]
  original: "on" | "waiting" | "off" | null }
type Used = { id: string; using: string; off: string[] }

const button = "h-8 shrink-0 cursor-pointer rounded-[8px] px-3 text-[13px] font-medium transition-opacity disabled:cursor-default disabled:opacity-50 max-md:h-9 max-md:text-[15px]"

/** What does its job now: "original", a stand-in's id, or "" (nothing). */
const usedBy = (r: Row) => (r.original === "on" || r.original === "waiting" ? "original" : r.here.find((h) => h.on)?.id ?? "")

function status(r: Row) {
  const native = r.here.find((h) => h.on)
  if (r.original === "on") return "The original runs here"
  if (r.original === "waiting") return "The original waits for you to allow it on this machine"
  if (native) return `Vaultite's ${native.name} stands in for it: agents can read what it draws`
  const alt = r.here[0] ?? r.directory[0]
  return alt ? `Off: run the original, or Vaultite's ${alt.name}${r.here.length ? "" : " from the plugin directory"}` : "Off"
}

export function ObsidianPlugins() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => { op<Row[]>("obsidian.plugins").then(setRows, () => setRows([])) }, [n])
  if (!rows?.length) return null

  const act = async (key: string, run: () => Promise<unknown>, what: string) => {
    setBusy(key)
    try { await run(); setN((x) => x + 1) } catch (e) { notifyError(e, `Couldn't ${what}`) } finally { setBusy(null) }
  }
  const use = (r: Row, w: string) => act(r.id, async () => {
    const u = await op<Used>("obsidian.use", { id: r.id, with: w })
    if (u.off.length) notify(`${r.name}: turned off ${u.off.join(" and ")}, so only one draws it`)
  }, `change ${r.name}`)
  const idle = rows.filter((r) => !usedBy(r)).length
  return (
    <div data-obsidian-plugins>
      <div className="mb-2 flex items-center gap-3 px-1">
        <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-muted-foreground">
          Your Obsidian vault has {rows.length} plugin{rows.length === 1 ? "" : "s"}. Run each as it is, or use Vaultite's own where there is one: agents can read what those draw.
        </p>
        {idle > 0 && (
          <button type="button" disabled={!!busy} data-obsidian-run-all onClick={() => void act("all", async () => {
            const r = await op<{ running: string[]; allowed: boolean }>("obsidian.run-all")
            notify(`Running ${r.running.length} Obsidian plugin${r.running.length === 1 ? "" : "s"}${r.allowed ? "" : ": each waits for this machine's owner to allow it"}`)
          }, "run them")} className={`${button} bg-primary text-primary-foreground hover:opacity-90`}>{busy === "all" ? "Starting…" : "Run them here"}</button>
        )}
      </div>
      <Group>
        {rows.map((r) => {
          const alt = r.here[0] ?? r.directory[0]
          const now = usedBy(r)
          return (
            <SettingRow key={r.id} label={r.name} sub={status(r)} data-obsidian-plugin={r.id}>
              {r.original === "waiting" && (
                <button type="button" disabled={busy === r.id} onClick={() => void use(r, "original")} className={`${button} bg-foreground/[0.06] hover:bg-foreground/[0.1]`}>Allow</button>
              )}
              {alt ? (
                <Segmented value={now} label={`What runs ${r.name}`} className="w-[190px] shrink-0 max-md:w-[170px]"
                  options={[{ value: alt.id, label: "Vaultite's" }, { value: "original", label: "Original" }]}
                  onChange={(v) => { if (v !== now && busy !== r.id) void use(r, v) }} />
              ) : (
                <Switch on={!!now} disabled={busy === r.id} label={`Run ${r.name}`} onChange={(on) => void use(r, on ? "original" : "none")} />
              )}
            </SettingRow>
          )
        })}
      </Group>
    </div>
  )
}
