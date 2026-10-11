// The settings sheet: the vault's plugins of another app, each run as it is (the original) or with what stands in for it
// here, picked in a click (other-apps.use); "Run them here" runs them all (other-apps.run-all).
import { useEffect, useState } from "react"
import { Button, cn, Group, notify, notifyError, op, plural, Segmented, SettingRow, Switch } from "@vaultite"

type Row = { id: string; name: string; here: { id: string; name: string; on: boolean }[]; directory: { id: string; name: string; source: string; installed: boolean }[]
  original: "on" | "waiting" | "off" | null }
type Used = { id: string; using: string; off: string[] }

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

export function OtherPlugins() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => { op<Row[]>("other-apps.plugins").then(setRows, () => setRows([])) }, [n])
  if (!rows?.length) return null

  const act = async (key: string, run: () => Promise<unknown>, what: string) => {
    setBusy(key)
    try { await run(); setN((x) => x + 1) } catch (e) { notifyError(e, `Couldn't ${what}`) } finally { setBusy(null) }
  }
  const use = (r: Row, w: string) => act(r.id, async () => {
    const u = await op<Used>("other-apps.use", { id: r.id, with: w })
    if (u.off.length) notify(`${r.name}: turned off ${u.off.join(" and ")}, so only one draws it`)
  }, `change ${r.name}`)
  const idle = rows.filter((r) => !usedBy(r)).length
  // (a switch takes the toggle's width when any row has a toggle, so the controls line up)
  const wide = rows.some((r) => r.here[0] ?? r.directory[0])
  return (
    <div data-obsidian-plugins>
      <div className="mb-2 flex items-center gap-3 px-1">
        <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-muted-foreground">
          This vault has {rows.length} plugin{rows.length === 1 ? "" : "s"} from another app. Run each as it is, or use Vaultite's own where there is one: agents can read what those draw.
        </p>
        {idle > 0 && (
          <Button look="primary" className="px-3" disabled={!!busy} data-obsidian-run-all onClick={() => void act("all", async () => {
            const r = await op<{ running: string[]; allowed: boolean }>("other-apps.run-all")
            notify(`Running ${plural(r.running.length, "plugin")} from another app${r.allowed ? "" : ": each waits for this machine's owner to allow it"}`)
          }, "run them")}>{busy === "all" ? "Starting…" : "Run them here"}</Button>
        )}
      </div>
      <Group>
        {rows.map((r) => {
          const alt = r.here[0] ?? r.directory[0]
          const now = usedBy(r)
          return (
            <SettingRow key={r.id} label={r.name} data-obsidian-plugin={r.id} sub={r.original === "waiting" ? <>
              {status(r)} <button type="button" disabled={busy === r.id} onClick={() => void use(r, "original")} data-obsidian-allow
                className="cursor-pointer font-medium text-primary hover:underline disabled:cursor-default disabled:opacity-50">Allow it</button>
            </> : status(r)}>
              <div className={cn("flex shrink-0 justify-end", wide && "w-[190px] max-md:w-[170px]")}>
                {alt ? (
                  <Segmented value={now} label={`What runs ${r.name}`} className="w-full"
                    options={[{ value: alt.id, label: "Vaultite's" }, { value: "original", label: "Original" }]}
                    onChange={(v) => { if (v !== now && busy !== r.id) void use(r, v) }} />
                ) : (
                  <Switch on={!!now} disabled={busy === r.id} label={`Run ${r.name}`} onChange={(on) => void use(r, on ? "original" : "none")} />
                )}
              </div>
            </SettingRow>
          )
        })}
      </Group>
    </div>
  )
}
