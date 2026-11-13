import type { Hit } from "./closure.ts"

/** The processes running, each by the commit it started on (null or absent: not running). */
export type Running = {
  /** The open pages: the web build they loaded. */
  ui?: string | null
  /** The server's code, and the web build it serves (a web-only update moves only that). */
  server?: { code: string; web: string } | null
  main?: string | null
  /** Its menu-bar helper, reloaded apart from it (absent: the main process's commit; null: none runs). */
  helper?: string | null
  /** The terminal and chat keepers: they outlive the app, and talk to it by a versioned protocol. */
  keepers?: { termd?: string | null; chatd?: string | null }
}
export type PlanInput = {
  to: string
  running: Running
  /** The files changed from a commit to `to`; a commit missing (or null) isn't known. */
  changed: Record<string, string[] | null>
  /** The new root's module graph (closure.ts' graphOf); null: none could be made. */
  graph: { hit: (entry: string, changed: string[]) => Hit | null } | null
  /** The fingerprint of the shell running and of the new root's (print.mjs); null: not known. */
  shell: { running: string | null; root: string | null }
}
export type Plan = {
  ui: "reload" | "none"
  server: "restart" | "adopt-web" | "none"
  main: "relaunch" | "none"
  /** The helper onto the new root in place: only what it alone runs changed (a relaunch reloads it anyway). */
  helper: "reload" | "none"
  /** Never restarted by an update: their protocol says what they can talk to. `stale`: those whose code changed. */
  keepers: "none"
  shell: "rebuild" | "none"
  stale: string[]
  /** Why each that does something does it. */
  why: Partial<Record<"ui" | "server" | "main" | "helper" | "shell" | "termd" | "chatd", string>>
}

export function planUpdate(p: PlanInput): Plan {
  const why: Plan["why"] = {}
  /** Why what started on `from` runs code `to` changed, or null. */
  const reaches = (from: string, entries: string[]): string | null => {
    if (from === p.to) return null
    const files = p.changed[from]
    if (!files) return `what changed since ${from.slice(0, 7)} isn't known`
    if (!p.graph) return "there's no module graph to tell"
    for (const e of entries) {
      const hit = p.graph.hit(e, files)
      if (hit?.unknown) return `${e} can't be followed past ${hit.unknown.file}:${hit.unknown.line}, so counts as changed`
      if (hit) return `${e} runs ${hit.file}${hit.chain.length > 1 ? ` (through ${hit.chain[0]})` : ""}, which changed`
    }
    return null
  }
  const plan: Plan = { ui: "none", server: "none", main: "none", helper: "none", keepers: "none", shell: "none", stale: [], why }

  const { running: r } = p
  if (!p.shell.running || !p.shell.root || p.shell.running !== p.shell.root) {
    plan.shell = "rebuild"
    why.shell = !p.shell.running || !p.shell.root ? "a shell fingerprint isn't known" : "the root needs another shell (its fingerprint differs)"
  }
  if (r.main) {
    const w = plan.shell === "rebuild" ? `the shell is rebuilt: ${why.shell}` : reaches(r.main, ["desktop"])
    if (w) { plan.main = "relaunch"; why.main = w }
  }
  // (what the helper shares with the main process is the main process's: changed, that's a relaunch above)
  const helper = r.helper === undefined ? r.main : r.helper
  if (helper && plan.main === "none") {
    const w = reaches(helper, ["helper"])
    if (w) { plan.helper = "reload"; why.helper = w }
  }
  if (r.server) {
    // (a new shell is a new Node too: the servers run on its binary)
    const code = plan.shell === "rebuild" ? `the shell is rebuilt: ${why.shell}` : reaches(r.server.code, ["server"])
    const web = reaches(r.server.web, ["web"])
    if (code) { plan.server = "restart"; why.server = code }
    else if (web) { plan.server = "adopt-web"; why.server = web }
  }
  if (r.ui) {
    const w = reaches(r.ui, ["web"])
    if (w) { plan.ui = "reload"; why.ui = w }
  }
  for (const k of ["termd", "chatd"] as const) {
    const from = r.keepers?.[k]
    const w = from ? reaches(from, [k]) : null
    if (w) { plan.stale.push(k); why[k] = w }
  }
  return plan
}
