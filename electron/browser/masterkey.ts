// Where the KeePass file's password comes from: the Secure Enclave (by finger only), else the keyring, else memory.
import fs from "node:fs"
import path from "node:path"
import { messageOf } from "./messageof.ts"
import { configOf, type Config } from "./passwordswire.ts"

export const CANT = {
  cancelled: "Touch ID didn't confirm it",
  unavailable: "Touch ID can't be used now: type the file's password",
  invalid: "Touch ID can't open it anymore (its fingers changed?): type the file's password",
}
export type Enclave = {
  ready: () => boolean
  seal: (secret: Uint8Array) => Uint8Array
  open: (sealed: Uint8Array, reason: string, quiet?: boolean) => Promise<Uint8Array>
}
export type Safe = { isEncryptionAvailable: () => boolean; encryptString: (s: string) => Buffer; decryptString: (b: Buffer) => string }
export type Finger = { can: () => boolean; ask: (reason: string) => Promise<boolean> }
type Sources = { dir: string; safe: Safe; finger: Finger; enclave: () => Promise<Enclave | null>; unsealed: (why: string) => void }

const bytes = (s: string) => new TextEncoder().encode(s)

export class MasterKey {
  private readonly from: Sources
  private readonly file: string
  private held: { file: string; password: string } | null = null
  private asking: Promise<Uint8Array> | null = null

  constructor(from: Sources) {
    this.from = from
    this.file = path.join(from.dir, "passwords.json")
  }

  config(): Config | null {
    try { return configOf(fs.readFileSync(this.file, "utf8")) } catch { return null }
  }
  gated() { return !!this.config()?.sealed }
  onlyHeld() { const c = this.config(); return !!c && c.key === null && !c.sealed }
  async couldBeGated() { return !!this.config()?.key && !!await this.gate() }

  silent(): Uint8Array | null {
    const c = this.config()
    if (!c || c.sealed) return null
    if (c.key === null) return this.held?.file === c.file ? bytes(this.held.password) : null
    try { return bytes(this.from.safe.decryptString(Buffer.from(c.key, "base64"))) } catch { return null }
  }

  async ask(reason: string): Promise<Uint8Array> {
    const q = this.asking ??= this.asked(reason).finally(() => { this.asking = null })
    const shared = await q, mine = shared.slice()
    setImmediate(() => shared.fill(0))
    return mine
  }

  async keep(file: string, password: Uint8Array): Promise<void> {
    const { safe } = this.from, sealed = this.sealed(await this.gate(), password), text = new TextDecoder().decode(password)
    // (typed with Touch ID away, a lid closed: what's behind it stays there, never back where nothing is asked)
    if (!sealed && this.gated() && this.config()?.file === file) return
    if (sealed) this.write({ file, key: null, sealed: safe.encryptString(sealed).toString("base64") })
    else this.write({ file, key: safe.isEncryptionAvailable() ? safe.encryptString(text).toString("base64") : null })
    this.held = safe.isEncryptionAvailable() ? null : { file, password: text }
  }

  forget() {
    fs.rmSync(this.file, { force: true })
    this.held = null
  }

  private write(c: Config) {
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(c), { mode: 0o600 })
    fs.renameSync(tmp, this.file)
  }
  private sealed(e: Enclave | null, password: Uint8Array): string | null {
    try { return e && Buffer.from(e.seal(password)).toString("base64") } catch (err) { this.from.unsealed(messageOf(err)); return null }
  }
  private async gate(): Promise<Enclave | null> {
    if (!this.from.safe.isEncryptionAvailable()) return null
    const e = await this.from.enclave()
    return e?.ready() ? e : null
  }
  private async asked(reason: string): Promise<Uint8Array> {
    const c = this.config()
    if (c?.sealed) return this.unseal(c.sealed, reason)
    if (!this.from.finger.can()) throw new Error(CANT.unavailable)
    if (!await this.from.finger.ask(reason)) throw new Error(CANT.cancelled)
    const password = this.silent()
    if (!password) throw new Error("its password isn't kept since the app started: type it")
    return password
  }
  private async unseal(sealed: string, reason: string): Promise<Uint8Array> {
    let blob: Buffer
    try { blob = Buffer.from(this.from.safe.decryptString(Buffer.from(sealed, "base64")), "base64") } catch { throw new Error(CANT.invalid) }
    const e = await this.from.enclave()
    if (!e) throw new Error(CANT.unavailable)
    return e.open(blob, reason)
  }
}
