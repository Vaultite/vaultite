import fs from "node:fs"
import { FileMoved, type OpCtx, OpError, Plugin } from "../../../core/plugins.ts"
import { ARCHIVE_DIR, archiveTwin, dirOf, inArchive, isArchived, isHiddenPath, readText, setPropertyText, unarchived, type Vault } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

plugin.onArchive((rel, archived) => (archived === inArchive(rel) ? null : dirOf(archiveTwin(rel))))

function free(vault: Vault, rel: string, folder = false) {
  const dot = rel.lastIndexOf("."), cut = !folder && dot > rel.lastIndexOf("/") + 1 ? dot : rel.length
  let out = rel
  for (let n = 1; fs.existsSync(vault.abs(out)); n++) out = `${rel.slice(0, cut)} ${n}${rel.slice(cut)}`
  return out
}

async function mark(ctx: OpCtx, rel: string, on: boolean) {
  if (!/\.md$/i.test(rel)) return
  const e = ctx.vault.entries.get(rel)
  if (e && isArchived(e.fm) === on) return
  const text = readText(ctx.vault.abs(rel))
  const next = setPropertyText(text, "archived", on ? true : undefined)
  if (next !== null && next !== text) await ctx.api("PUT", "file", { path: rel, text: next, base: text })
}

function target(ctx: OpCtx, path: unknown) {
  const rel = String(path ?? "").replace(/^\/+|\/+$/g, "")
  if (!rel || !fs.existsSync(ctx.vault.abs(rel))) throw new OpError(`no file or folder '${rel}'`, 404)
  if (isHiddenPath(rel)) throw new OpError(`${rel} is hidden: it can't be archived`)
  if (rel.split("/").pop() === ARCHIVE_DIR) throw new OpError(`${rel} is an archive folder: archive what's outside it`)
  return rel
}

type Moved = { from: string; path: string; updated: string[] }

const isFolder = (ctx: OpCtx, rel: string) => fs.statSync(ctx.vault.abs(rel)).isDirectory()

export async function archive(ctx: OpCtx, rel: string): Promise<Moved> {
  let at = rel, updated: string[] = []
  const folder = isFolder(ctx, rel)
  if (!inArchive(rel)) ({ path: at, updated } = FileMoved.parse(await ctx.op("file.move", { from: rel, to: free(ctx.vault, archiveTwin(rel), folder) })))
  if (!folder) await mark(ctx, at, true)
  return { from: rel, path: at, updated }
}

export async function unarchive(ctx: OpCtx, rel: string): Promise<Moved> {
  let at = rel, updated: string[] = []
  const folder = isFolder(ctx, rel)
  if (inArchive(rel)) ({ path: at, updated } = FileMoved.parse(await ctx.op("file.move", { from: rel, to: free(ctx.vault, unarchived(rel), folder) })))
  if (!folder) await mark(ctx, at, false)
  return { from: rel, path: at, updated }
}

const PATH = { type: "string", format: "path", required: true, description: "the file or folder (a path, or a name as the user says it)" } as const
const said = (r: Moved, what: string) =>
  `${r.from === r.path ? `${what} ${r.path}` : `${what} ${r.from}: now ${r.path}`}${r.updated.length ? `; links updated in ${r.updated.join(", ")}` : ""}.`

plugin.op({
  id: "archive.add",
  cli: "archive",
  summary: "Archive a file or folder: it moves into .archive/ in its folder (a file gets `archived: true`); links to it follow.",
  help: `Archived files are left out of lists, blocks, the graph and database views, and go last in search; the app still
reads them, and links to them still work. A folder moves whole (Projects/Old -> Projects/.archive/Old), and everything
in it counts as archived. Unarchive with vau unarchive.

  vau archive "People/Old friend.md"
  vau archive Inbox/Clipped page.md
  vau archive "Projects/Old project"`,
  kind: "write",
  params: { path: PATH },
  args: ["path"],
  action: { on: ["*"], param: "path", label: "Archive", icon: "archive", menu: false },
  run: ({ path }, ctx) => archive(ctx, target(ctx, path)),
  text: (r) => said(r, "Archived"),
})

plugin.op({
  id: "archive.restore",
  cli: "unarchive",
  summary: "Unarchive a file or folder: it moves out of .archive/ back into its folder (a file loses `archived`); links follow.",
  help: `  vau unarchive "People/.archive/Old friend.md"
  vau unarchive "Projects/.archive/Old project"`,
  kind: "write",
  params: { path: PATH },
  args: ["path"],
  action: { on: ["*"], param: "path", label: "Unarchive", icon: "archive-restore", archived: true, menu: false },
  run: ({ path }, ctx) => unarchive(ctx, target(ctx, path)),
  text: (r) => said(r, "Unarchived"),
})

plugin.op({
  id: "archive.tidy",
  cli: "archive tidy",
  summary: "Move the files marked `archived: true` by hand (or from before this plugin) into their folders' .archive/.",
  help: `A file archived by editing its frontmatter stays where it is (the app doesn't move a file someone may be typing
in); this moves those, one by one, through vau move, so links follow. --dry lists them first.

  vau archive tidy --dry
  vau archive tidy`,
  kind: "write",
  params: { dry: { type: "boolean", description: "only list what would move" } },
  run: async ({ dry }, ctx) => {
    const todo = [...ctx.vault.entries.values()].filter((e) => !e.broken && isArchived(e.fm) && !inArchive(e.rel)).map((e) => e.rel).sort()
    if (dry) return { dry: true, files: todo, moved: [], failed: [] }
    const moved: Moved[] = [], failed: { path: string; error: string }[] = []
    for (const rel of todo) {
      try { moved.push(await archive(ctx, rel)) } catch (e) { failed.push({ path: rel, error: e instanceof Error ? e.message : String(e) }) }
    }
    return { dry: false, files: todo, moved, failed }
  },
  text: (r) => {
    if (!r.files.length) return "Every archived file is in an .archive folder."
    if (r.dry) return `Would move ${r.files.length} archived file${r.files.length === 1 ? "" : "s"}:\n${r.files.map((p: string) => `- ${p}`).join("\n")}`
    return [`Moved ${r.moved.length} archived file${r.moved.length === 1 ? "" : "s"} into .archive folders.`,
      ...r.moved.map((m: Moved) => `- ${m.from} -> ${m.path}`),
      ...r.failed.map((f: { path: string; error: string }) => `- not moved: ${f.path} (${f.error})`)].join("\n")
  },
})
