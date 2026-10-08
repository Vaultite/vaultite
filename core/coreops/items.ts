// Items of any kind through the API's generic routes (a plugin's own route answers first, as over HTTP). A kind's
// own ops (note.create, log.add) say more about its fields; these work for all.
import type { App } from "../app.ts"
import { jsonBlock, type Op, OpError, type Param } from "../ops.ts"
import type { Kind } from "../vault.ts"
import { type Any, enc } from "./common.ts"

const KIND: Param = { type: "string", required: true, description: "the kind: its type (person, note, log, book) or collection (people, notes, logs, books)" }
const ID: Param = { type: "string", required: true, description: "the item: its id (People/Alice Park), file name (Alice Park) or key" }

export function itemOps(app: App): Op[] {
  const kindOf = (q: string): Kind => {
    const low = q.trim().toLowerCase()
    const k = app.vault.kinds.find((x) => x.collection === low) ?? app.vault.kinds.find((x) => x.type === low)
    if (!k) throw new OpError(`no kind '${q}'. Kinds: ${app.vault.kinds.map((x) => `${x.type} (${x.collection})`).join(", ")}`, 404)
    return k
  }
  /** The route of an item, or of the kind's one file (ME.md) when it's a single file. */
  const route = (k: Kind, id?: string) => (k.file || !id ? k.collection : `${k.collection}/${enc(id)}`)
  return [{
    id: "item.list",
    summary: "Every item of a kind (people, notes, logs...), as JSON: what the API's GET /api/<collection> answers.",
    help: "Each item is its file's frontmatter and body, read the kind's way (vau docs <kind's plugin> has its fields). For files matching conditions, query.run is quicker to read.",
    kind: "read",
    params: { kind: KIND, limit: { type: "integer", minimum: 1, description: "at most this many" } },
    args: ["kind"],
    run: async ({ kind, limit }, ctx) => {
      const r = await ctx.api("GET", route(kindOf(kind)))
      return Array.isArray(r) && limit ? r.slice(0, limit) : r
    },
    text: (r: Any) => (Array.isArray(r) ? (r.length ? r.map((i) => `- ${i.id}${i.title && !String(i.id).endsWith(i.title) ? ` (${i.title})` : ""}`).join("\n") : "None.") : jsonBlock(r)),
  }, {
    id: "item.get",
    summary: "One item of a kind by its id, file name or key, as JSON.",
    kind: "read",
    params: { kind: KIND, id: { ...ID, required: false, description: "the item: its id (People/Alice Park), file name (Alice Park) or key; none for a kind kept in one file (me)" } },
    args: ["kind", "id"],
    run: ({ kind, id }, ctx) => {
      const k = kindOf(kind)
      if (!id && !k.file) throw new OpError("id is missing: which one (its id, file name or key)")
      return ctx.api("GET", route(k, id))
    },
    text: jsonBlock,
  }, {
    id: "item.create",
    summary: "Make an item of a kind, or update the one with the same key (the kind's: a note's ext_id, a person's name).",
    help: "The fields are the kind's (vau docs <its plugin>); the server fills what it can (ids, dates, coordinates). Sent again with the same key, it updates that item: safe to repeat.",
    kind: "write",
    params: { kind: KIND, item: { type: "object", required: true, description: "its fields" } },
    args: ["kind", "item"],
    run: ({ kind, item }, ctx) => ctx.api("POST", route(kindOf(kind)), item),
    text: (r) => `Saved ${r?.id ?? "it"}.`,
  }, {
    id: "item.update",
    summary: "Change some fields of an item (the others stay; `archived: true` archives it).",
    kind: "write",
    params: { kind: KIND, id: ID, fields: { type: "object", required: true, description: "the fields to change" } },
    args: ["kind", "id", "fields"],
    run: ({ kind, id, fields }, ctx) => ctx.api("PUT", route(kindOf(kind), id), fields),
    text: (r) => `Saved ${r?.id ?? "it"}.`,
  }, {
    id: "item.delete",
    summary: "Delete an item: its file goes to the vault's .trash.",
    kind: "destructive",
    params: { kind: KIND, id: ID },
    args: ["kind", "id"],
    run: async ({ kind, id }, ctx) => {
      const k = kindOf(kind)
      if (k.file) throw new OpError(`${k.file} is the kind's one file: it isn't deleted this way`)
      return { ...(await ctx.api("DELETE", route(k, id)) as Any), id }
    },
    text: (r) => (r.ok ? `Deleted ${r.id} (to the trash).` : `Nothing deleted: no ${r.id}.`),
  }]
}
