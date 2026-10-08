// Report a bug: the recorded minutes as a note (what the user says went wrong, a screenshot, the timeline as text), in
// the folder its settings name. The screenshot and the events are taken first, before the question covers the window.
import { APP_VERSION, appDevice, captureWindow, choose, createFile, currentFile, get, getStore, notify, notifyError, offeredCommand, openFile, pasteAttachments, runCommandById } from "@vaultite"
import { recorded, type Ev } from "./record"

const MAX_LINES = 4000
const p2 = (n: number, w = 2) => String(n).padStart(w, "0")
const clock = (t: number) => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p2(d.getMilliseconds(), 3)}` }
const value = (v: unknown) => (typeof v === "string" ? (/[\s"=]/.test(v) || !v ? JSON.stringify(v) : v) : JSON.stringify(v))
const fields = (e: Ev, skip: string[] = []) => Object.entries(e).filter(([k, v]) => v !== undefined && !["at", "topic", ...skip].includes(k)).map(([k, v]) => `${k}=${value(v)}`).join(" ")

/** One line per event, oldest first; a run of the same edit (typing, deleting) in one file is one line. */
export function timeline(events: Ev[]): string[] {
  const out: string[] = []
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    const run = (x: Ev) => x.topic === "editor" && x.ev === "update" && x.path === e.path && x.by === e.by && /^(input\.type|delete\.)/.test(String(e.by)) && !x.stack
    let j = i
    if (run(e)) while (j + 1 < events.length && run(events[j + 1])) j++
    if (j > i) {
      out.push(`${clock(e.at)} editor ${e.by} x${j - i + 1} path=${value(e.path)} cursor=${e.was}->${events[j].head}`)
      i = j
    } else out.push(`${clock(e.at)} ${e.topic} ${fields(e)}`)
  }
  return out.length > MAX_LINES ? [`(the first ${out.length - MAX_LINES} lines left out)`, ...out.slice(-MAX_LINES)] : out
}

const fence = (lines: string[]) => { const t = lines.join("\n"); let f = "```"; while (t.includes(f)) f += "`"; return `${f}text\n${t}\n${f}` }

export async function reportBug() {
  const events = recorded()
  const shot = await captureWindow()
  const said = await new Promise<string | null>((done) => choose({
    title: "Report a bug", heading: "What went wrong?", placeholder: "Say what happened, or Enter to save without a description",
    items: [{ id: "", label: "Save without a description" }],
    other: (typed) => (typed.trim() ? { id: typed.trim(), label: `Save: ${typed.trim()}` } : null),
    onPick: (it) => done(it.id), onDismiss: () => done(null),
  }))
  if (said === null) return
  try {
    const store = getStore()
    const settings = await get<{ folder?: string }>("config/plugin/recorder").catch(() => ({} as { folder?: string }))
    const folder = (settings.folder ?? "Bug reports").replace(/^\/+|\/+$/g, "")
    const d = new Date(), name = `Bug ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}`
    const where = `${folder ? `${folder}/` : ""}${name}.md`
    const picture = shot && store ? await pasteAttachments(store, where, [new File([Uint8Array.from(atob(shot.png), (c) => c.charCodeAt(0))], `${name}.png`, { type: "image/png" })]) : ""
    const first = events[0]?.at ?? Date.now()
    const text = [
      "---", "type: note", "tags: [bug-report]", "---", "",
      said || "(no description)", "",
      ...(picture ? [picture, ""] : []),
      "## Where", "",
      `- Vaultite ${APP_VERSION}, ${appDevice}, window ${innerWidth}x${innerHeight}`,
      `- Open: ${currentFile() ?? (decodeURIComponent(location.hash) || "nothing")}`,
      `- ${navigator.userAgent}`, "",
      `## Timeline`, "",
      `From ${clock(first)} to ${clock(Date.now())}, oldest first. By "app": the app did it, not the user.`, "",
      fence(timeline(events)), "",
    ].join("\n")
    const f = await createFile(folder, name, text)
    openFile(f.path, { newTab: true })
    const dispatch = offeredCommand("dispatch:claude")
    notify("Saved the bug report", dispatch ? { action: { label: "Dispatch", run: () => runCommandById("dispatch:claude") } } : {})
  } catch (e) { notifyError(e, "Couldn't save the bug report") }
}
