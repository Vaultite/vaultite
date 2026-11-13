// Workspaces for a QA run (plugins/core/workspaces: what the user sets is a file each, what's open is kept by the
// server), asked of the server under test: read as the list they make, cleared, or set aside and put back after.
import { execFileSync } from "node:child_process"
import path from "node:path"

export const wsDir = (vault) => path.join(vault, ".vaultite/plugins/workspaces")

function call(base, method, route, body) {
  const js = "const [u, m, b] = process.argv.slice(1); fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, ...(b ? { body: b } : {}) })" +
    ".then((r) => r.text()).then((t) => process.stdout.write(t), (e) => { console.error(e.message); process.exit(1) })"
  const out = execFileSync(process.execPath, ["-e", js, new URL(`api/${route}`, base.endsWith("/") ? base : `${base}/`).href, method, ...(body ? [JSON.stringify(body)] : [])], { encoding: "utf8" })
  try { return JSON.parse(out) } catch { return null }
}

/** The workspaces as the list they make (null: unused), trailing unused ones left out: GET /api/workspaces. */
export const workspaces = (base) => call(base, "GET", "workspaces")?.workspaces ?? []

/** When they last changed (ms; 0: there are none): what's kept of them, by `vau kept`. */
export const wsChanged = (base) => Math.max(0, ...(call(base, "POST", "ops/kept.list", { prefix: "workspaces/" })?.entries ?? []).map((e) => Date.parse(e.at)))

/** No workspaces (each slot deleted). */
export const clearWorkspaces = (base) => { for (const n of [1, 2, 3, 4, 5]) call(base, "DELETE", `workspaces/${n}`) }

/** Set them aside for the run (none meanwhile): the function puts them back as they were. */
export function setAsideWorkspaces(base) {
  const had = workspaces(base)
  clearWorkspaces(base)
  return () => { clearWorkspaces(base); had.forEach((w, i) => { if (w) call(base, "PUT", `workspaces/${i + 1}`, w) }) }
}
