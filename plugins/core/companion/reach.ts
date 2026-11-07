// Where the summoned companion's read-only commands may look unasked: what a person keeps to show it (code,
// documents, the desktop, downloads, pictures and the screenshots folder), never home's dotfiles or Library.
import { execFileSync } from "node:child_process"
import os from "node:os"
import path from "node:path"

const HOME = os.homedir()
const untilde = (p: string) => (p === "~" ? HOME : p.startsWith("~/") ? path.join(HOME, p.slice(2)) : p)
const homely = (p: string) => (p === HOME ? "~" : p.startsWith(`${HOME}/`) ? `~/${p.slice(HOME.length + 1)}` : p)

/** Where this Mac saves screenshots (its screencapture setting), else the Desktop, macOS' own default. */
export function screenshotDir(read = () => execFileSync("defaults", ["read", "com.apple.screencapture", "location"], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] })) {
  if (process.platform === "darwin") {
    try {
      const at = path.resolve(untilde(read().trim()))
      // (a setting pointing at home itself, or into Library or a dotfolder, opens none of them)
      if (at.startsWith(`${HOME}/`) && !/^(Library|\.)/.test(path.relative(HOME, at))) return at
    } catch { /* not set: the Desktop */ }
  }
  return path.join(HOME, "Desktop")
}

/** Its folders, home's own first, then the screenshots folder when it's elsewhere. */
export function readableDirs(shots = screenshotDir()) {
  const dirs = ["Projects", "Documents", "Desktop", "Downloads", "Pictures"].map((d) => path.join(HOME, d))
  return dirs.some((d) => shots === d || shots.startsWith(`${d}/`)) ? { dirs, shots } : { dirs: [...dirs, shots], shots }
}

/** Never read there even so: keys and secrets a download or a project may hold. */
export const NEVER_READ = ["Read(**/.env*)", "Read(**/.ssh/**)", "Read(**/*.pem)", "Read(**/*.p12)", "Read(**/id_rsa*)", "Read(**/id_ed25519*)"]

/** Shell commands never run, whoever asks, not even offered (regex sources): what reads keys and secrets. */
export const NEVER_RUN = [String.raw`(^|[^\w])\.ssh(/|\b|$)`, String.raw`Library/Keychains`, String.raw`\bkeychain-db\b`,
  String.raw`\bsecurity\s+(find-(generic|internet)-password|dump-keychain|export|unlock-keychain|set-key-partition-list)\b`,
  String.raw`(^|[\s'"/=])\.env(\.[\w-]+)?($|[\s'";|&)])`, String.raw`\bid_(rsa|ed25519|ecdsa|dsa)\b`, String.raw`\.(pem|p12|key)($|[\s'";|&)])`, String.raw`\bdata/config\.json\b`]

/** Auto mode's rules for it: what changes their Mac's settings is always asked on a card by their pointer (its
 *  classifier blocks it here, the card's yes runs it), so a spoken ask never flips a setting unseen. */
export const AUTO_RULES = { hard_deny: ["$defaults", "Changing this Mac's settings or another app's preferences (defaults write, delete or import; pmset; networksetup; systemsetup; scutil --set; tccutil; launchctl load, unload, bootstrap, bootout, enable or disable; nvram; spctl): block it even when the user asked for it, as they approve these on a card outside this conversation."] }

/** The folders as its prompt names them: "~/Projects, ~/Documents, …; screenshots go to ~/Pictures/Screenshots". */
export function readableText(r = readableDirs()) {
  return `the vault, ${r.dirs.map(homely).join(", ")} (screenshots are saved to ${homely(r.shots)})`
}
