// Importer's frontend: pick an export, send it, follow its job in one toast; the settings sheet says how to export.
import { FileInput, Import } from "lucide-react"
import { definePlugin, Group, notify, notifyError, Panel, SettingRow } from "@vaultite"
import type { Job } from "./job"

const TINT = "var(--importer)"
const TOAST = "importer"
const HEADERS = { "X-Vaultite-Client": "app" }

const LABEL = { notion: "Notion", evernote: "Evernote", keep: "Google Keep" }

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
  input.accept = ".zip,.enex,application/zip"
  input.style.display = "none"
  input.addEventListener("change", () => {
    const f = input.files?.[0]
    input.remove()
    if (f) void importFile(f)
  })
  document.body.append(input)
  input.click()
}

const HOW = "Notion: Settings, Export all workspace content (or a page's menu, Export), as Markdown & CSV. Evernote: a notebook's menu, Export notebook, as ENEX. Google Keep: takeout.google.com with Keep ticked. Importing again adds only what's new."

function SettingsPanel() {
  return (
    <div>
      <Group>
        <SettingRow label="Import from Notion, Evernote or Keep…" sub="Notion's zip, Evernote's .enex or Google Takeout's zip: every page or note becomes a note" onClick={pickExport} chevron={FileInput} />
      </Group>
      <p className="mt-1.5 px-1 text-[13px] leading-[18px] text-muted-foreground">{HOW}</p>
    </div>
  )
}

function Preview() {
  return (
    <Panel title="Importer" icon={Import} tint={TINT}>
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Brings your notes from Notion, Evernote and Google Keep: pick the export with Import from Notion, Evernote or Keep in the command palette.
        Pages keep their subpages, links, attachments and database properties; notes their tags, dates, to-dos and attachments.
      </p>
    </Panel>
  )
}

export default definePlugin({
  commands: [{ id: "importer:import", name: "Import from Notion, Evernote or Keep…", run: pickExport }],
  settingsPanel: () => <SettingsPanel />,
  settingsPanelFirst: true,
  preview: () => <Preview />,
})
