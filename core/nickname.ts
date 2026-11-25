import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import type { Item, Vault } from "./vault.ts"
import { codeOf } from "./values.ts"
import { NICKNAME_FILE, nicknameText } from "./vaultname.ts"

export const VAULT_SETTINGS = "vault"

const VaultSettings = z.looseObject({ name: z.string().catch("").default("") }).catch({ name: "" })
export const nicknameOf = (settings: Item) => nicknameText(VaultSettings.parse(settings).name)

export const ownNickname = (vault: Pick<Vault, "config">) => nicknameOf(vault.config(VAULT_SETTINGS))

export async function nicknameAt(dir: string, ms = 1000): Promise<string | null> {
  const read = fs.promises.readFile(path.join(dir, NICKNAME_FILE), "utf8").then((t) => nicknameOf(JSON.parse(t)), () => "")
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((done) => { timer = setTimeout(() => done(null), ms); timer.unref?.() })
  try { return await Promise.race([read, late]) } finally { clearTimeout(timer) }
}

export async function saveNicknameAt(dir: string, nickname: string | null, writeAtomic: (file: string, text: string) => void) {
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`there's no folder ${dir}`)
  const file = path.join(dir, NICKNAME_FILE)
  let text = "{}"
  try { text = await fs.promises.readFile(file, "utf8") } catch (e) { if (codeOf(e) !== "ENOENT") throw e }
  const { name: _was, ...rest } = z.looseObject({}).parse(JSON.parse(text))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  writeAtomic(file, JSON.stringify(nickname ? { ...rest, name: nickname } : rest, null, 2) + "\n")
}
