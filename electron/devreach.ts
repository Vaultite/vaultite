// Which of a running app's processes a worktree's changed files reach (the module graph, core/update/closure.ts): the
// web app (a new build: its pages reload), the servers (a restart), the main process (a relaunch). Unknown is reached.
import { diskTree, graphOf, type ParseCache } from "../core/update/closure.ts"

export type Reach = { web: boolean; server: boolean; main: boolean }

/** What changed `files` (relative to `root`, /-separated) reach; `cache` keeps the parses between calls. */
export function reach(root: string, files: string[], cache: ParseCache = new Map()): Reach {
  const g = graphOf(diskTree(root), { cache }), on = (id: string) => !!g.hit(id, files)
  return { web: on("web"), server: on("server"), main: on("desktop") || on("helper") }
}
