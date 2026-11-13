import { execFileSync } from "node:child_process"
import os from "node:os"
import path from "node:path"

const HOME = os.homedir()
const untilde = (p: string) => (p === "~" ? HOME : p.startsWith("~/") ? path.join(HOME, p.slice(2)) : p)
const homely = (p: string) => (p === HOME ? "~" : p.startsWith(`${HOME}${path.sep}`) ? `~${path.sep}${p.slice(HOME.length + 1)}` : p)

// macOS saves screenshots to the Desktop unless its screencapture setting names a folder.
export function screenshotDir(read = () => execFileSync("defaults", ["read", "com.apple.screencapture", "location"], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] })) {
  if (process.platform === "darwin") {
    try {
      const at = path.resolve(untilde(read().trim()))
      if (at.startsWith(`${HOME}${path.sep}`) && !/^(Library|\.)/.test(path.relative(HOME, at))) return at
    } catch {}
  }
  return path.join(HOME, "Desktop")
}

export function readableDirs(shots = screenshotDir()) {
  const dirs = ["Projects", "Documents", "Desktop", "Downloads", "Pictures"].map((d) => path.join(HOME, d))
  return dirs.some((d) => shots === d || shots.startsWith(`${d}${path.sep}`)) ? { dirs, shots } : { dirs: [...dirs, shots], shots }
}

export const NEVER_READ = ["Read(**/.env*)", "Read(**/.ssh/**)", "Read(**/*.pem)", "Read(**/*.p12)", "Read(**/id_rsa*)", "Read(**/id_ed25519*)"]

export const NEVER_RUN = [String.raw`(^|[^\w])\.ssh(/|\b|$)`, String.raw`Library/Keychains`, String.raw`\bkeychain-db\b`,
  String.raw`\bsecurity\s+(find-(generic|internet)-password|dump-keychain|export|unlock-keychain|set-key-partition-list)\b`,
  String.raw`(^|[\s'"/=])\.env(\.[\w-]+)?($|[\s'";|&)])`, String.raw`\bid_(rsa|ed25519|ecdsa|dsa)\b`, String.raw`\.(pem|p12|key)($|[\s'";|&)])`, String.raw`\bdata/config\.json\b`]

export const AUTO_RULES = { hard_deny: ["$defaults", "Changing this Mac's settings or another app's preferences (defaults write, delete or import; pmset; networksetup; systemsetup; scutil --set; tccutil; launchctl load, unload, bootstrap, bootout, enable or disable; nvram; spctl): block it even when the user asked for it, as they approve these on a card outside this conversation.",
  "Deleting the user's files for good (rm, unlink, rmdir, find -delete, shred) anywhere but a temporary folder: block it even when the user asked for it, as they approve it on a card outside this conversation; moving them to the Trash (trash) isn't this."] }

export function readableText(r = readableDirs()) {
  return `the vault, ${r.dirs.map(homely).join(", ")} (screenshots are saved to ${homely(r.shots)})`
}
