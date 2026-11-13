// A question with fields over a window, as a browser asks one for a page (prompt(), a site's HTTP sign-in): a modal
// window (a sheet on a Mac) in the system's look, answering the fields' values, or null when cancelled.
import { BrowserWindow, ipcMain, type BaseWindow, type WebContents } from "electron"
import { fileURLToPath } from "node:url"
import { ANSWERS } from "./pagewire.ts"

export type SheetField = { name: string; label?: string; value?: string; password?: boolean }
export type Sheet = { title: string; message?: string; fields: SheetField[]; ok: string
  /** The page it's for: it goes, or loads another address, and the question's cancelled. */
  until?: WebContents }

const PRELOAD = fileURLToPath(new URL("./sheet-preload.cjs", import.meta.url))
const answers = new Map<number, (v: unknown) => void>()
ipcMain.on("vaultite:sheet", (e, v) => answers.get(e.sender.id)?.(v))

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const html = (q: Sheet) => `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${esc(q.title)}</title><style>
:root { color-scheme: light dark; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif }
body { margin: 0; padding: 20px 20px 16px; background: Canvas; color: CanvasText; -webkit-user-select: none; user-select: none }
h1 { font-size: 13px; font-weight: 600; margin: 0 0 6px; overflow-wrap: anywhere }
p { margin: 0 0 10px; opacity: .75; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 160px; overflow: auto; -webkit-user-select: text; user-select: text }
label { display: block; margin: 10px 0 4px }
input { display: block; width: 100%; box-sizing: border-box; padding: 5px 8px; font: inherit; color: FieldText; background: Field;
  border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); border-radius: 6px; outline: none }
input:focus { border-color: AccentColor; box-shadow: 0 0 0 3px color-mix(in srgb, AccentColor 30%, transparent) }
div { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px }
button { font: inherit; min-width: 72px; padding: 4px 12px; border-radius: 6px; color: ButtonText; background: ButtonFace;
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent) }
button[type=submit] { color: AccentColorText; background: AccentColor; border-color: transparent }
</style></head><body><form><h1>${esc(q.title)}</h1>${q.message ? `<p>${esc(q.message)}</p>` : ""}
${q.fields.map((f) => `${f.label ? `<label for="${esc(f.name)}">${esc(f.label)}</label>` : ""}<input id="${esc(f.name)}" name="${esc(f.name)}" type="${f.password ? "password" : "text"}" value="${esc(f.value ?? "")}" autocomplete="off" spellcheck="false">`).join("\n")}
<div><button type="button" id="cancel">Cancel</button><button type="submit">${esc(q.ok)}</button></div></form>
<script>
const form = document.querySelector("form")
form.addEventListener("submit", (e) => { e.preventDefault(); sheet.answer(Object.fromEntries(new FormData(form))) })
document.getElementById("cancel").addEventListener("click", () => sheet.answer(null))
addEventListener("keydown", (e) => { if (e.key === "Escape") sheet.answer(null) })
const first = document.querySelector("input"); if (first) { first.focus(); first.select() }
</script></body></html>`

/** Ask `q` over `win`: the fields' values by name, or null (cancelled, closed, or its page gone). */
export function askSheet(win: BaseWindow, q: Sheet): Promise<Record<string, string> | null> {
  return new Promise((done) => {
    const sheet = new BrowserWindow({ parent: win, modal: true, show: false, width: 420, height: 160, useContentSize: true, resizable: false,
      minimizable: false, maximizable: false, fullscreenable: false, title: q.title, autoHideMenuBar: true,
      webPreferences: { partition: "vaultite-sheet", sandbox: true, contextIsolation: true, preload: PRELOAD, spellcheck: false } })
    const wc = sheet.webContents, id = wc.id
    let settled = false
    const end = (v: Record<string, string> | null) => {
      if (settled) return
      settled = true
      answers.delete(id)
      q.until?.off("destroyed", gone).off("did-start-navigation", moved)
      if (!sheet.isDestroyed()) sheet.close()
      done(v)
    }
    const gone = () => end(null)
    const moved = (d: { isMainFrame: boolean; isSameDocument: boolean }) => { if (d.isMainFrame && !d.isSameDocument) end(null) }
    q.until?.once("destroyed", gone).on("did-start-navigation", moved)
    answers.set(id, (v) => { const a = ANSWERS.safeParse(v); end(a.success ? Object.fromEntries(q.fields.map((f) => [f.name, a.data[f.name] ?? ""])) : null) })
    sheet.on("closed", () => end(null))
    // (nothing in it leaves: no links, no other pages)
    wc.setWindowOpenHandler(() => ({ action: "deny" }))
    wc.on("will-navigate", (e) => e.preventDefault())
    wc.once("did-finish-load", () => {
      void wc.executeJavaScript("Math.ceil(document.documentElement.getBoundingClientRect().height)").then((h: number) => {
        if (sheet.isDestroyed()) return
        sheet.setContentSize(420, Math.min(600, Math.max(120, h)))
        sheet.show()
      }, () => { if (!sheet.isDestroyed()) sheet.show() })
    })
    void sheet.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html(q))}`).catch(() => end(null))
  })
}
