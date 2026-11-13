import { Plugin } from "../../../core/plugins.ts"
import { dilText } from "./dil.ts"
import { chartText } from "./chartdata.ts"

export const plugin = new Plugin(import.meta.url)

plugin.provide("fence:genui", (ctx: { text: string }) => dilText(ctx.text))
plugin.provide("fence:chart", (ctx: { text: string }) => chartText(ctx.text))
