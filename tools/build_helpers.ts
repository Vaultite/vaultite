// The desktop app's native helpers (transcriber, dictation, screen, voice, electron/macaddons.ts' addons), built for
// both architectures so a Mac without Xcode's tools has them (npm run app:build), named by their sources' hash.
import path from "node:path"

const { buildHelper } = await import("../plugins/core/audio-recorder/plugin.ts")
const { buildDictation } = await import("../electron/dictation-build.ts")
const { buildScreen } = await import("../electron/screen-build.ts")
const { buildVoice } = await import("../electron/voice-build.ts")
const { buildMacAddon } = await import("../electron/macaddons.ts")
const root = path.join(import.meta.dirname, "..")
const builds: [string, () => Promise<string>][] = [
  ["the transcriber", () => buildHelper(path.join(root, "plugins", "core", "audio-recorder", "bin"), ["arm64", "x86_64"])],
  ["dictation", () => buildDictation(path.join(root, "electron", "bin"), ["arm64", "x86_64"])],
  ["the screen helper", () => buildScreen(path.join(root, "electron", "bin"), ["arm64", "x86_64"])],
  ["the voice helper", () => buildVoice(path.join(root, "electron", "bin"), ["arm64", "x86_64"])],
  ["the permissions addon", () => buildMacAddon("macpermissions", path.join(root, "electron", "bin"))],
  ["the gestures addon", () => buildMacAddon("gestures", path.join(root, "electron", "bin"))],
]
for (const [name, build] of builds) {
  try {
    console.log(`helpers: ${path.relative(process.cwd(), await build())}`)
  } catch (e) {
    console.warn(`helpers: ${name} wasn't built (${(e as Error).message}); the app builds it where it can`)
  }
}
