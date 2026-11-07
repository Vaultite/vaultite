// Upstream's test resources (tools/fixtures/kdbx) and the Argon2 the app uses (keepass.ts: noble's), in place of
// upstream's asm.js build.
import { argon2dAsync, argon2idAsync } from "@noble/hashes/argon2.js"
import type { Argon2Fn } from "../../../electron/browser/kdbx/crypto-engine.ts"
import { fixture } from "./mocha.ts"

export const argon2: Argon2Fn = async (password, salt, memory, iterations, length, parallelism, type, version) => {
  const fn = type === 2 ? argon2idAsync : argon2dAsync
  return fn(new Uint8Array(password), new Uint8Array(salt), { m: memory, t: iterations, p: parallelism, dkLen: length, version })
}

export const TestResources = {
  demoKdbx: fixture("demo.kdbx"), demoKey: fixture("demo.key"), demoXml: fixture("demo.xml"),
  cyrillicKdbx: fixture("cyrillic.kdbx"), binKeyKdbx: fixture("binkey.kdbx"), binKeyKey: fixture("binkey.key"),
  emptyPass: fixture("EmptyPass.kdbx"), emptyPassWithKeyFile: fixture("EmptyPassWithKeyFile.kdbx"), emptyPassWithKeyFileKey: fixture("EmptyPassWithKeyFile.key"),
  noPassWithKeyFile: fixture("NoPassWithKeyFile.kdbx"), noPassWithKeyFileKey: fixture("NoPassWithKeyFile.key"),
  key32: fixture("Key32.kdbx"), key32KeyFile: fixture("Key32.key"), key64: fixture("Key64.kdbx"), key64KeyFile: fixture("Key64.key"),
  keyWithBom: fixture("KeyWithBom.kdbx"), keyWithBomKeyFile: fixture("KeyWithBom.key"), keyV2: fixture("KeyV2.kdbx"), keyV2KeyFile: fixture("KeyV2.keyx"),
  argon2: fixture("Argon2.kdbx"), argon2id: fixture("Argon2id.kdbx"), argon2ChaCha: fixture("Argon2ChaCha.kdbx"), aesChaCha: fixture("AesChaCha.kdbx"),
  aesKdfKdbx4: fixture("AesKdfKdbx4.kdbx"), yubikey3: fixture("YubiKey3.kdbx"), yubikey4: fixture("YubiKey4.kdbx"),
  emptyUuidXml: fixture("empty-uuid.xml"), kdbx41: fixture("KDBX4.1.kdbx"),
}
