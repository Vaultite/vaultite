// Names of what the companion saves (captures, QA walks, tours, lessons), by local time: no Node, the desktop app's too.
const pad = (n: number) => String(n).padStart(2, "0")
/** Local "YYYY-MM-DD". */
export const localDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
/** Local "HH:mm" (`sep` "." in a file's name). */
export const localTime = (t: number, sep = ":") => { const d = new Date(t); return `${pad(d.getHours())}${sep}${pad(d.getMinutes())}` }
/** Local "YYYY-MM-DD HH.mm.ss", a capture's name's start. */
export const localStamp = (t: number) => `${localDay(t)} ${localTime(t, ".")}.${pad(new Date(t).getSeconds())}`
/** A title as a file's name (no character other Markdown apps forbid), at most `max` long; "" when nothing's left. */
export const fileTitle = (title: string, max = 80) => title.replace(/[\\/:*?"<>|#^[\]\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim()
