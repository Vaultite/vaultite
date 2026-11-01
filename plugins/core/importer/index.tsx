// Importer's frontend: pick an export, send it, follow its job in one toast; the settings sheet says how to export.
import { FileInput, Import } from "lucide-react"
import { definePlugin, Group, notify, notifyError, Panel, SettingRow } from "@vaultite"
import type { Job } from "./job"

const TINT = "var(--importer)"
const TOAST = "importer"
const HEADERS = { "X-Vaultite-Client": "app" }

const LABEL = { notion: "Notion", evernote: "Evernote", keep: "Google Keep", html: "HTML pages", bear: "Bear", csv: "CSV" }

function summary(j: Job) {
  if (j.state === "failed") return `Couldn't import ${j.name}: ${j.error ?? "it failed"}`
  const parts = [`${j.created} new`]
  if (j.unchanged) parts.push(`${j.unchanged} imported before`)
  if (j.files) parts.push(`${j.files} attachment${j.files === 1 ? "" : "s"}`)
  return `${j.source ? LABEL[j.source] : "Export"}: ${j.notes} note${j.notes === 1 ? "" : "s"} (${parts.join(", ")}).`
}

async function importFile(file: File) {
  const say = (text: string) => notify(text, { id: TOAST, duration: Infinity })
  try {
    say(`Sending ${file.name}…`)
    const res = await fetch(`api/importer?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file, headers: { ...HEADERS, "Content-Type": "application/octet-stream" } })
    let job: Job = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((job as { error?: string }).error ?? `${res.status}`)
    while (job.state === "queued" || job.state === "running") {
      say(job.state === "queued" ? "Waiting for the import before it…" : `Importing from ${job.source ? LABEL[job.source] : file.name}… ${job.notes} notes`)
      await new Promise((r) => setTimeout(r, 700))
      job = await fetch(`api/importer/jobs/${job.id}`, { headers: HEADERS }).then((r) => r.json())
    }
    notify(summary(job), job.state === "failed" ? { id: TOAST, kind: "error" } : { id: TOAST, duration: 12000 })
  } catch (e) {
    notifyError(e, `Couldn't import ${file.name}`, { id: TOAST })
  }
}

function pickExport() {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = ".zip,.enex,.bear2bk,.html,.htm,.csv,application/zip,text/html,text/csv"
  input.style.display = "none"
  input.addEventListener("change", () => {
    const f = input.files?.[0]
    input.remove()
    if (f) void importFile(f)
  })
  document.body.append(input)
  input.click()
}

const HOW = "Notion: Settings, Export all workspace content (or a page's menu, Export), as Markdown & CSV. Evernote: a notebook's menu, Export notebook, as ENEX. Google Keep: takeout.google.com with Keep ticked. Bear: File, Backup notes. Any other app: its HTML pages or a CSV table (a note per row), one or a zip. Importing again adds only what's new."

function SettingsPanel() {
  return (
    <div>
      <Group>
        <SettingRow label="Import notes from another app…" sub="Notion, Evernote, Google Keep, Bear, HTML pages or a CSV table: every page, note or row becomes a note" onClick={pickExport} chevron={FileInput} />
      </Group>
      <p className="mt-1.5 px-1 text-[13px] leading-[18px] text-muted-foreground">{HOW}</p>
    </div>
  )
}

function Preview() {
  return (
    <Panel title="Importer" icon={Import} tint={TINT}>
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Brings your notes from Notion, Evernote, Google Keep, Bear and other apps' HTML pages: pick the export with Import notes from another app in the command palette.
        Pages keep their subpages, links, attachments and database properties; notes their tags, dates, to-dos and attachments.
      </p>
    </Panel>
  )
}

export default definePlugin({
  commands: [{ id: "importer:import", name: "Import notes from another app…", run: pickExport }],
  settingsPanel: () => <SettingsPanel />,
  settingsPanelFirst: true,
  preview: () => <Preview />,
})
