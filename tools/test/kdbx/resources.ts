// Upstream's test resources (tools/fixtures/kdbx) and the Argon2 the app uses (argon2.ts), in place of upstream's asm.js
// build.
import { fixture } from "./mocha.ts"
export { argon2 } from "../../../electron/browser/argon2.ts"

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
