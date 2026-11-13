// The core's routes as ops call them: through ctx.api, so the request's checks apply, typed by what each answers.
import { z } from "zod"
import type { SaveBody } from "../contracts/save.ts"
import type { FileText } from "../files.ts"
import type { OpCtx } from "../ops.ts"
import type { Machine } from "../plugins.ts"
const enc = encodeURIComponent

const File = z.looseObject({ path: z.string(), text: z.string(), mtime: z.number(), size: z.number(), kind: z.string().nullable(), problems: z.array(z.string()) }) satisfies z.ZodType<FileText>

export const readFile = async (ctx: OpCtx, path: string): Promise<FileText> => File.parse(await ctx.api("GET", `file?path=${enc(path)}`))

export async function saveFile(ctx: OpCtx, body: SaveBody & { path: string; text: string }): Promise<void> {
  await ctx.api("PUT", "file", body)
}

export const renderFile = async (ctx: OpCtx, path: string): Promise<string> => String(await ctx.api("GET", `render?path=${enc(path)}`))

const Hit = z.looseObject({
  path: z.string(), title: z.string(), context: z.string(), archived: z.boolean().optional(), count: z.number().optional(),
  matches: z.array(z.looseObject({ line: z.number(), text: z.string(), ctx: z.literal(true).optional() })).optional(),
})
/** A file GET /api/search found (core/files.ts searchAll): with `lines`, the lines that matched and how many did. */
export type SearchHit = z.infer<typeof Hit>

export const searchFiles = async (ctx: OpCtx, query: URLSearchParams): Promise<SearchHit[]> => z.array(Hit).parse(await ctx.api("GET", `search?${query}`))

export const FileMoved = z.looseObject({ path: z.string(), updated: z.array(z.string()) })

export const moveFile = async (ctx: OpCtx, from: string, to: string): Promise<z.infer<typeof FileMoved>> => FileMoved.parse(await ctx.api("POST", "file/move", { from, to }))

const TreeFile = z.looseObject({ path: z.string(), type: z.unknown().optional() })
const Tree = z.looseObject({ files: z.array(TreeFile).optional(), others: z.array(TreeFile).optional(), folders: z.array(z.string()).optional() })

export const fileTree = async (ctx: OpCtx): Promise<z.infer<typeof Tree>> => Tree.parse(await ctx.api("GET", "files"))

const Free = z.looseObject({ path: z.string() })

export const uploadName = async (ctx: OpCtx, folder: string, name: string): Promise<string> => Free.parse(await ctx.api("POST", "upload/name", { folder, name })).path

const MachineRow = z.looseObject({
  id: z.string(), label: z.string(), url: z.string(), online: z.boolean(), self: z.boolean(), plugins: z.array(z.string()).optional(), vault: z.string().optional(),
  desktop: z.boolean().optional(), standalone: z.boolean().optional(), platform: z.string().optional(), cores: z.number().optional(), load: z.number().optional(),
  memory: z.object({ total: z.number(), free: z.number() }).optional(), display: z.boolean().optional(),
}) satisfies z.ZodType<Machine>

export const machinesOf = (ctx: OpCtx): Promise<Machine[]> => ctx.api("GET", "machines").then((v) => z.array(MachineRow).parse(v), () => [])
