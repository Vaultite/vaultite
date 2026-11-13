// The core's routes as ops call them: through ctx.api, so the request's checks apply, typed by what each answers.
import type { SaveBody } from "../contracts/save.ts"
import type { FileText } from "../files.ts"
import type { OpCtx } from "../ops.ts"
import type { Machine } from "../plugins.ts"
import { enc } from "./common.ts"

export const readFile = (ctx: OpCtx, path: string): Promise<FileText> => ctx.api("GET", `file?path=${enc(path)}`)

export async function saveFile(ctx: OpCtx, body: SaveBody & { path: string; text: string }): Promise<void> {
  await ctx.api("PUT", "file", body)
}

export const renderFile = async (ctx: OpCtx, path: string): Promise<string> => String(await ctx.api("GET", `render?path=${enc(path)}`))

/** A file GET /api/search found (core/files.ts searchAll): with `lines`, the lines that matched and how many did. */
export type SearchHit = { path: string; title: string; context: string; archived?: boolean; count?: number; matches?: { line: number; text: string; ctx?: true }[] }

export const searchFiles = (ctx: OpCtx, query: URLSearchParams): Promise<SearchHit[]> => ctx.api("GET", `search?${query}`)

export const moveFile = (ctx: OpCtx, from: string, to: string): Promise<{ path: string; updated: string[] }> => ctx.api("POST", "file/move", { from, to })

export const machinesOf = (ctx: OpCtx): Promise<Machine[]> => ctx.api("GET", "machines").catch(() => [])
