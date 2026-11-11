// The app's command line: `--vault <path>` opens a vault. A relaunch passes it as `--vault=<path>`: Chromium's command
// line puts switches before arguments, which parts `--vault` from its path when the app's folder is one (unpackaged).
import path from "node:path"

/** The vault `argv` asks for (`--vault <path>` or `--vault=<path>`), resolved from `cwd`; null when none. */
export function vaultArg(argv: string[], cwd = process.cwd()): string | null {
  const joined = argv.find((a) => a.startsWith("--vault="))
  if (joined) return joined.length > 8 ? path.resolve(cwd, joined.slice(8)) : null
  const i = argv.indexOf("--vault")
  return i > 0 && argv[i + 1] ? path.resolve(cwd, argv[i + 1]) : null
}

/** Electron's relaunch options keeping this launch's command line, its vault joined to `--vault=`. */
export function relaunchOptions(argv = process.argv): { args: string[] } {
  const args: string[] = []
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--vault" && i + 1 < argv.length) args.push(`--vault=${path.resolve(argv[++i])}`)
    else args.push(argv[i])
  }
  return { args }
}
