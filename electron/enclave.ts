// A Node addon, not a process: macOS names the app in its Touch ID question, and no pipe has the secret.
import path from "node:path"
import { z } from "zod"
import { CANT, type Enclave } from "./browser/masterkey.ts"
import { enclaveSwift } from "./swiftbuild.ts"

const EXPORTS = z.object({ ready: z.instanceof(Function), seal: z.instanceof(Function), open: z.instanceof(Function) })
const BYTES = z.instanceof(Uint8Array)

export function loadEnclave(file: string, finger: boolean): Enclave {
  const mod = { exports: {} }
  process.dlopen(mod, file)
  const { ready, seal, open } = EXPORTS.parse(mod.exports)
  return {
    ready: () => ready(finger) === true,
    seal: (secret) => BYTES.parse(seal(Buffer.from(secret.buffer, secret.byteOffset, secret.byteLength), finger)),
    open: async (sealed, reason, quiet = false) => {
      try { return BYTES.parse(await open(Buffer.from(sealed), reason, quiet)) } catch (e) { throw new Error(CANT[CANT_WHY.parse(e instanceof Error ? e.message : "")]) }
    },
  }
}
const CANT_WHY = z.enum(["cancelled", "unavailable", "invalid"]).catch("invalid")

/** This Mac's, or null where there's none. A scripted copy of the app (QA) never asks a finger: its stand-in or none. */
export async function enclave(app: { packaged: boolean; userData: string }): Promise<Enclave | null> {
  if (process.platform !== "darwin") return null
  const test = !app.packaged && process.env.VAULTITE_TEST_TOUCHID === "yes"
  if (!test && !app.packaged && process.env.VAULTITE_QUIET) return null
  return loadEnclave(await enclaveSwift.binary(path.join(app.userData, "bin")), !test)
}
