// git the app or its tests run acts on the folder it's given, never on a repository it was started in: a git hook or
// `git bisect run` exports GIT_DIR and the like, and a test's `git init` once turned the app's own checkout bare.

/** What tells git which repository it's in (`git rev-parse --local-env-vars`). */
const LOCAL = new Set(["GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT", "GIT_OBJECT_DIRECTORY",
  "GIT_DIR", "GIT_WORK_TREE", "GIT_IMPLICIT_WORK_TREE", "GIT_GRAFT_FILE", "GIT_INDEX_FILE", "GIT_NO_REPLACE_OBJECTS", "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX", "GIT_SHALLOW_FILE", "GIT_COMMON_DIR"])

/** The environment for a git command: this process's but what names a repository (GIT_DIR and the like), and `extra`. */
export function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!LOCAL.has(k) && !k.startsWith("GIT_CONFIG_KEY_") && !k.startsWith("GIT_CONFIG_VALUE_")) env[k] = v
  return { ...env, ...extra }
}
