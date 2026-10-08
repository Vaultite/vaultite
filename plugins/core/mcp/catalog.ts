// MCP's tools generated from the ops (`mcp` ones, hints from `kind`), plus `ops` and `call` for the rest, the same
// for both adapters.
import type { OpEntry, Schema } from "../../../core/plugins.ts"
import { type Tool, ToolError } from "./protocol.ts"

/** Names the two generic tools take (an op can't be served under them). */
export const RESERVED = new Set(["ops", "call"])

/** A short title from an op's summary: its first clause, at most 60 characters. */
export function titleOf(e: OpEntry) {
  const first = e.summary.split(/[:;(]|\.\s|\.$/)[0].trim()
  return first.length > 60 ? `${first.slice(0, 57).replace(/\s+\S*$/, "")}...` : first || e.id
}

const hints = (kind: OpEntry["kind"]): Record<string, boolean> =>
  kind === "read" ? { readOnlyHint: true, destructiveHint: false } : { readOnlyHint: false, destructiveHint: kind === "destructive" }

/** An op as a tool. Its `format: "file"` parameters are ones ChatGPT fills with a file from the chat. */
export function toolOf(e: OpEntry): Tool {
  const files = Object.entries(e.params.properties ?? {}).filter(([, s]) => s.format === "file").map(([k]) => k)
  return {
    ...(files.length ? { meta: { "openai/fileParams": files } } : {}),
    name: e.mcp!,
    title: titleOf(e),
    description: [e.summary, e.help?.trim()].filter(Boolean).join("\n\n"),
    inputSchema: e.params as Record<string, unknown>,
    annotations: hints(e.kind),
    run: (args, ctx) => ctx.op(e.id, args),
  }
}

/** A parameter as a line of the `ops` tool's answer. */
function paramLine(k: string, s: Schema, required: boolean) {
  const t = s.enum ? s.enum.map((x) => JSON.stringify(x)).join(" | ") : s.type === "array" ? `list of ${s.items?.type ?? "values"}` : s.format ?? s.type ?? "any"
  return `- \`${k}\` (${[t, required ? "required" : null].filter(Boolean).join(", ")}): ${s.description ?? ""}${s.default !== undefined ? ` Default: ${JSON.stringify(s.default)}.` : ""}`
}

/** One op explained, for the `ops` tool. */
export function explain(e: OpEntry) {
  const props = e.params.properties ?? {}, req = e.params.required ?? []
  return [
    `## ${e.id}`,
    `${e.summary} (${e.kind}${e.plugin ? `, ${e.plugin}` : ""}${e.mcp ? `; also the tool ${e.mcp}` : ""})`,
    e.help?.trim() || null,
    Object.keys(props).length ? Object.entries(props).map(([k, s]) => paramLine(k, s, req.includes(k))).join("\n") : "No parameters.",
    `Run it with call: {"id": "${e.id}", "params": {...}}.`,
  ].filter(Boolean).join("\n\n")
}

/** The generic pair: `ops` and `call`. */
function generic(entries: OpEntry[]): Tool[] {
  return [{
    name: "ops",
    title: "List the operations",
    description: "Everything this vault and its app can do, as operations (the API): without an id, the list (filter by an area like note, file, " +
      "or a word); with an id, how to call that one (its parameters). Many have a tool of their own; call runs any of them.",
    inputSchema: { type: "object", properties: {
      id: { type: "string", description: "an operation's id (note.create): how to call it" },
      filter: { type: "string", description: "an area (note, file, events) or a word in the summary" },
    }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (args) => {
      const id = typeof args.id === "string" ? args.id.trim() : ""
      if (id) {
        const e = entries.find((x) => x.id === id || x.mcp === id || x.cli === id)
        if (!e) throw new ToolError(`No operation '${id}'. Call ops without an id for the list.`)
        return explain(e)
      }
      const q = typeof args.filter === "string" ? args.filter.trim().toLowerCase() : ""
      const rows = entries.filter((e) => !q || e.id.startsWith(`${q}.`) || e.id.includes(q) || e.summary.toLowerCase().includes(q))
      return rows.length
        ? rows.map((e) => `- \`${e.id}\` (${e.kind}${e.mcp ? `, tool ${e.mcp}` : ""}): ${e.summary}`).join("\n") + "\n\nops with an id explains one; call runs it."
        : "No operation matches."
    },
  }, {
    name: "call",
    title: "Run an operation",
    description: "Runs any operation of the vault by its id with its parameters (ops lists them and explains each one's). " +
      "Some only read, others write or delete: what it does depends on the operation, so check its kind with ops first, " +
      "and prefer an operation's own tool when it has one.",
    inputSchema: { type: "object", properties: {
      id: { type: "string", description: "the operation's id (note.create, events.wait)" },
      params: { type: "object", description: "its parameters, as ops describes them" },
    }, required: ["id"], additionalProperties: false },
    // Which operation it runs isn't known until it's called: it may change or delete things.
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    run: async (args, ctx) => {
      const id = typeof args.id === "string" ? args.id.trim() : ""
      if (!id) throw new ToolError("id is missing: an operation's id (ops lists them)")
      const params = args.params ?? {}
      if (typeof params !== "object" || Array.isArray(params)) throw new ToolError("params is an object of the operation's parameters")
      return ctx.op(id, params as Record<string, unknown>)
    },
  }]
}

/** The tools for a catalog: its ops marked `mcp`, then `ops` and `call`. */
export function toolsOf(entries: OpEntry[]): Tool[] {
  return [...entries.filter((e) => e.mcp && !RESERVED.has(e.mcp)).map(toolOf), ...generic(entries)]
}
