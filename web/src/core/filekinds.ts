// What a file is and how it looks in the tree, the tabs and search: the server's core/filetypes.ts (by extension), plus
// an icon for each sort of file.
import {
  File, FileArchive, FileAudio, FileCode, FileCog, FileImage, FileKey, FileSpreadsheet, FileTerminal, FileText, FileType, FileVideo,
  NotebookText, type LucideIcon,
} from "lucide-react"
import { extOf, kindOf, type FileKind } from "../../../core/filetypes.ts"

export { extOf, kindOf, type FileKind } from "../../../core/filetypes.ts"

/** Opened by a viewer, never read as text (images, PDFs, audio, video, and known binary files). */
export const isMedia = (k: FileKind) => k === "image" || k === "pdf" || k === "audio" || k === "video" || k === "binary"

const CONFIG = new Set(["yaml", "yml", "toml", "ini", "cfg", "conf", "env", "properties", "plist", "lock", "editorconfig"])
const SHELL = new Set(["sh", "bash", "zsh", "fish", "ps1", "bat", "cmd"])
const PLAIN = new Set(["txt", "text", "log", "rst", "org", "adoc", "srt", "vtt", "tex", "bib"])
const SHEETS = new Set(["xlsx", "xls", "xlsm", "numbers", "ods", "tsv", "csv"])
const ARCHIVES = new Set(["zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar", "dmg", "pkg", "iso", "jar", "whl"])
const DOCS = new Set(["docx", "doc", "pages", "odt", "rtf", "epub", "mobi", "azw", "azw3", "fb2", "fbz"])
const FONTS = new Set(["ttf", "otf", "woff", "woff2"])

/** The icon for a file that isn't a note (notes take their plugin's). */
export function kindIcon(path: string): LucideIcon {
  const k = kindOf(path), ext = extOf(path)
  if (k === "image") return FileImage
  if (k === "audio") return FileAudio
  if (k === "video") return FileVideo
  if (k === "pdf" || DOCS.has(ext) || FONTS.has(ext)) return FileType
  if (k === "notebook") return NotebookText
  if (SHEETS.has(ext)) return FileSpreadsheet
  if (ARCHIVES.has(ext)) return FileArchive
  if (ext === "pem") return FileKey
  if (/(^|\/)\.env(\.|$)/.test(path) || CONFIG.has(ext) || (k === "code" && /(^|\/)\.[^/.]+$/.test(path))) return FileCog
  if (SHELL.has(ext)) return FileTerminal
  if (PLAIN.has(ext) || /(^|\/)(readme|license|changelog|authors)$/i.test(path)) return FileText
  if (k === "code") return FileCode
  return File
}

/** "PDF document", "Excel workbook", "PNG image": what the card and the status bar call a file. */
const NAMES: Record<string, string> = {
  pdf: "PDF document", xlsx: "Excel workbook", xls: "Excel workbook", xlsm: "Excel workbook", numbers: "Numbers spreadsheet",
  docx: "Word document", doc: "Word document", pages: "Pages document", pptx: "PowerPoint presentation", key: "Keynote presentation",
  zip: "ZIP archive", ipynb: "Jupyter notebook", dmg: "Disk image", sqlite: "SQLite database", db: "Database", epub: "EPUB book",
  ods: "OpenDocument spreadsheet", odt: "OpenDocument text", mobi: "Kindle book", azw: "Kindle book", azw3: "Kindle book",
  fb2: "FictionBook", fbz: "FictionBook", cbz: "Comic book", heic: "iPhone photo", heif: "HEIF image",
}
export function kindName(path: string) {
  const ext = extOf(path), k = kindOf(path)
  if (NAMES[ext]) return NAMES[ext]
  const up = ext.toUpperCase()
  if (k === "image") return `${up} image`
  if (k === "audio") return `${up} audio`
  if (k === "video") return `${up} video`
  return ext ? `${up} file` : "File"
}

/** "24 KB" */
export function formatSize(n: number) {
  if (n < 1000) return `${n} byte${n === 1 ? "" : "s"}`
  const units = ["KB", "MB", "GB", "TB"]
  let v = n / 1000, i = 0
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++ }
  return `${v < 10 ? v.toFixed(1).replace(/\.0$/, "") : Math.round(v)} ${units[i]}`
}
