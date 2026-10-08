// property.types and property.type (`vau properties types`, `vau properties type`): a key's type across the vault, in
// .vaultite/types.json (core/proptypes.ts), Obsidian's types.json under it. Setting one writes only that key.
import type { App } from "../app.ts"
import { propertyTypes } from "../plugins.ts"
import { PROP_TYPES, type PropType, readTypes, typeName, typeNotes, typeOf } from "../proptypes.ts"
import { type Op, OpError } from "../ops.ts"
import { isHiddenPath, type Item } from "../vault.ts"
import type { Any } from "./common.ts"

type Listed = { key: string; type: PropType; from: "vaultite" | "obsidian" }

/** Every declared type, by key, and where it's declared. */
function listed(app: App): Listed[] {
  const own = readTypes(app.vault.config("types"))
  return Object.entries(propertyTypes(app.vault, app.plugins)).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, type]) => ({ key, type, from: Object.hasOwn(own, key) ? "vaultite" : "obsidian" }))
}

/** Notes (files, values that aren't of their type), for check. */
function problems(app: App) {
  const types = propertyTypes(app.vault, app.plugins)
  const out: { path: string; notes: string[] }[] = []
  for (const [path, e] of app.vault.entries) {
    if (isHiddenPath(path)) continue
    const notes = typeNotes(types, e.fm)
    if (notes.length) out.push({ path, notes })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export function propTypeOps(app: App): Op[] {
  return [{
    id: "property.types",
    cli: "properties types",
    summary: "The vault's property types: which keys are dates, numbers, lists, checkboxes... (.vaultite/types.json, and Obsidian's).",
    help: `A property's type applies to that key in every file: the editor's input, quiet notes on values that aren't
of it, and how database views sort and compare it. An undeclared key is its value's type. With --check, the files whose
values aren't of their type.

  vau properties types
  vau properties types --check`,
    kind: "read",
    params: { check: { type: "boolean", default: false, description: "also list the files whose values aren't of their type" } },
    run: ({ check }) => ({ types: listed(app), ...(check ? { problems: problems(app) } : {}) }),
    text: (r: Any) => {
      const ts = r.types as Listed[]
      const w = Math.max(4, ...ts.map((t) => t.key.length))
      const list = ts.length ? ts.map((t) => `${t.key.padEnd(w)}  ${t.type}${t.from === "obsidian" ? "  (.obsidian/types.json)" : ""}`).join("\n") : "No types declared: each property is its value's type."
      if (!r.problems) return list
      const bad = (r.problems as { path: string; notes: string[] }[]).map((p) => `- ${p.path}: ${p.notes.join("; ")}`)
      return `${list}\n\n${bad.length ? `Not of their type:\n${bad.join("\n")}` : "Every value is of its type."}`
    },
  }, {
    id: "property.type",
    cli: "properties type",
    summary: "Set a property's type for the whole vault (text, list, number, checkbox, date, datetime, tags, aliases, link), or none.",
    help: `Writes that one key into .vaultite/types.json (the rest of the file stays); files aren't changed (to convert
their values too: vau properties retype). none removes the line, so the key is its value's type again (or Obsidian's).

  vau properties type due date
  vau properties type rating number
  vau properties type due none`,
    kind: "write",
    params: {
      key: { type: "string", required: true, description: "the property (frontmatter key)" },
      type: { type: "string", required: true, enum: [...PROP_TYPES, "none"], description: "its type, or none" },
    },
    args: ["key", "type"],
    run: ({ key, type }) => {
      const k = String(key ?? "").trim()
      if (!k || /[\n\r]/.test(k)) throw new OpError("key: a property name")
      const t = type === "none" ? null : typeName(type)
      if (type !== "none" && !t) throw new OpError(`type: one of ${PROP_TYPES.join(", ")}, or none`)
      const file = app.vault.readConfig("types")
      const map: Item = file?.types && typeof file.types === "object" && !Array.isArray(file.types) ? { ...file.types } : {}
      // (the key as the file writes it, in any case)
      const at = Object.keys(map).find((x) => x.toLowerCase() === k.toLowerCase()) ?? k
      // What it would be without a line here (Obsidian's, or what every vault has): no line needed for that.
      const without = typeOf(propertyTypes(app.vault, app.plugins, false), k)
      if (t && t !== without) map[at] = t
      else delete map[at]
      if (JSON.stringify(map) !== JSON.stringify(file?.types ?? {})) {
        // (a file left with nothing in it goes: never an empty settings file the user didn't make)
        const next = app.vault.patchConfig("types", { types: Object.keys(map).length ? map : null })
        if (!Object.keys(next).length) app.vault.removeConfig("types")
      }
      return { key: at, type: typeOf(propertyTypes(app.vault, app.plugins), at), types: listed(app) }
    },
    text: (r: Any) => (r.type ? `${r.key}: ${r.type}, in every file.` : `${r.key} has no type now: each file's value is its own.`),
  }]
}
