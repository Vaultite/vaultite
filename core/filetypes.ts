// What a vault file is by its name: how the app opens it and what the editor may write. Every file opens; a plugin may
// draw a kind itself (`formats`), else it's what it is here. No Node: both sides use it.
export type FileKind = "markdown" | "json" | "notebook" | "code" | "image" | "pdf" | "audio" | "video" | "binary" | "other"

const KINDS: Record<string, FileKind> = {}
const add = (kind: FileKind, exts: string) => { for (const x of exts.split(" ")) KINDS[x] = kind }
add("markdown", "md")
add("json", "json excalidraw canvas")
add("notebook", "ipynb")
add("code", "html htm csv txt text log py pyi ts tsx mts cts js jsx mjs cjs yaml yml toml sh bash zsh fish css scss sass less sql ini cfg " +
  "conf env properties swift go rs java kt kts scala c h cc cpp cxx hpp hh m mm rb php lua r pl pm cs fs vb dart ex exs erl hs " +
  "ml jl zig nim clj cljs el vim ps1 bat cmd gradle xml xsl plist tsv srt vtt tex bib rst org adoc graphql gql proto vue svelte " +
  "astro diff patch lock http rest csl jsonl ndjson geojson " +
  "webmanifest map mdx markdown base")
add("image", "png jpg jpeg gif webp svg avif bmp ico heic heif")
add("pdf", "pdf")
add("audio", "mp3 m4a aac wav ogg oga opus flac")
add("video", "mp4 m4v mov webm ogv")
add("binary", "xlsx xls xlsm numbers pages key docx doc pptx ppt odt ods odp rtf zip gz tgz bz2 xz 7z rar tar dmg pkg iso app " +
  "exe dll so dylib o a class jar pyc whl sqlite sqlite3 db parquet feather npy npz pkl pickle h5 ttf otf woff woff2 psd ai " +
  "sketch fig tif tiff raw cr2 nef dng epub mobi azw azw3 fb2 fbz cbz")

/** Files known by their whole name (no extension). Dot files with no other extension (.gitignore, .env) are text too. */
const NAMES: Record<string, FileKind> = {
  makefile: "code", dockerfile: "code", gemfile: "code", rakefile: "code", procfile: "code", brewfile: "code", license: "code",
  readme: "code", changelog: "code", authors: "code",
}

/** The extension, lower case, without the dot ("" for none; a leading dot isn't one: ".gitignore" has none). */
export function extOf(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1)
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

export function kindOf(path: string): FileKind {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase()
  if (NAMES[name]) return NAMES[name]
  if (name.startsWith(".env.")) return "code"
  const ext = extOf(path)
  return (ext && KINDS[ext]) || (name.startsWith(".") && !ext ? "code" : "other")
}

/** Kinds whose text the app reads (and writes); "other" is tried as text too. */
export const isTextKind = (k: FileKind) => k === "markdown" || k === "json" || k === "notebook" || k === "code"

/** Bigger than this isn't opened as text at all (the card instead); bigger than EDIT_MAX opens read-only. */
export const TEXT_MAX = 8 << 20
export const EDIT_MAX = 1 << 20

/** The Content-Type a file is served with, by its extension (the web app's files, a vault file's bytes). */
export function contentType(path: string) {
  return TYPES[extOf(path)] ?? "application/octet-stream"
}

const TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", pdf: "application/pdf", heic: "image/heic", md: "text/plain; charset=utf-8",
  txt: "text/plain; charset=utf-8", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4",
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json", webmanifest: "application/manifest+json",
  ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", map: "application/json",
  wasm: "application/wasm", avif: "image/avif", bmp: "image/bmp", heif: "image/heif", aac: "audio/aac",
  wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac",
  m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", ogv: "video/ogg", csv: "text/csv; charset=utf-8",
  epub: "application/epub+zip", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
