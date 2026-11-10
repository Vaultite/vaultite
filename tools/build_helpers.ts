// The desktop app's native helpers, for both architectures so a Mac without Xcode's tools has them (npm run app:build),
// named by their sources' hash. --cache <dir>: each built once into <dir>/<id>/ and copied into this root (the store's).
import fs from "node:fs"
import path from "node:path"

const { buildHelper } = await import("../plugins/core/audio-recorder/plugin.ts")
const { buildHelper: buildVersions } = await import("../plugins/core/sync-conflicts/plugin.ts")
const { dictationSwift } = await import("../electron/dictation-build.ts")
const { screenSwift, voiceSwift, takeoverSwift, captureSwift } = await import("../electron/swiftbuild.ts")
const { buildMacAddon } = await import("../electron/macaddons.ts")
const root = path.join(import.meta.dirname, "..")
const at = process.argv.indexOf("--cache"), cache = at > 0 ? path.resolve(process.argv[at + 1] ?? "") : null
const bin = path.join(root, "electron", "bin")
const builds: { id: string; name: string; dir: string; build: (dir: string) => Promise<string> }[] = [
  { id: "transcriber", name: "the transcriber", dir: path.join(root, "plugins", "core", "audio-recorder", "bin"), build: (d) => buildHelper(d, ["arm64", "x86_64"]) },
  { id: "versions", name: "the iCloud versions helper", dir: path.join(root, "plugins", "core", "sync-conflicts", "bin"), build: (d) => buildVersions(d, ["arm64", "x86_64"]) },
  { id: "dictation", name: "dictation", dir: bin, build: (d) => dictationSwift.build(d, ["arm64", "x86_64"]) },
  { id: "screen", name: "the screen helper", dir: bin, build: (d) => screenSwift.build(d, ["arm64", "x86_64"]) },
  { id: "voice", name: "the voice helper", dir: bin, build: (d) => voiceSwift.build(d, ["arm64", "x86_64"]) },
  { id: "takeover", name: "the take-over helper", dir: bin, build: (d) => takeoverSwift.build(d, ["arm64", "x86_64"]) },
  { id: "capture", name: "the capture helper", dir: bin, build: (d) => captureSwift.build(d, ["arm64", "x86_64"]) },
  { id: "macpermissions", name: "the permissions addon", dir: bin, build: (d) => buildMacAddon("macpermissions", d) },
  { id: "gestures", name: "the gestures addon", dir: bin, build: (d) => buildMacAddon("gestures", d) },
  { id: "menus", name: "the menus addon", dir: bin, build: (d) => buildMacAddon("menus", d) },
]
/** A build named by its sources' hash (`screen-0123456789ab`, `menus-….node`): one of a helper's versions. */
const versioned = /-[0-9a-f]{12}(\.node)?$/

/** Built in the cache (once per sources' hash: each build skips a name it has), then it and what it keeps beside it
 *  (dictation's library), not its older versions, cloned into the root's folder. */
async function cached(b: (typeof builds)[number]) {
  const dir = path.join(cache!, b.id), out = await b.build(dir)
  fs.mkdirSync(b.dir, { recursive: true })
  for (const f of fs.readdirSync(dir)) if (path.join(dir, f) === out || (!versioned.test(f) && !f.includes(".tmp") && !/\.\d+(-\w+)?$/.test(f))) {
    fs.cpSync(path.join(dir, f), path.join(b.dir, f), { recursive: true, mode: fs.constants.COPYFILE_FICLONE, verbatimSymlinks: true })
  }
  return path.join(b.dir, path.basename(out))
}

for (const b of builds) {
  try {
    console.log(`helpers: ${path.relative(process.cwd(), await (cache ? cached(b) : b.build(b.dir)))}`)
  } catch (e) {
    console.warn(`helpers: ${b.name} wasn't built (${(e as Error).message}); the app builds it where it can`)
  }
}
