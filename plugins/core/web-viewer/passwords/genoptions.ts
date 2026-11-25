import { devicePref } from "@vaultite"

export type Kind = "password" | "passphrase"
export type Separator = "-" | "." | "_" | " "
export type Options = {
  kind: Kind; length: number; upper: boolean; lower: boolean; digits: boolean; symbols: boolean; clear: boolean
  words: number; separator: Separator; capitals: boolean; number: boolean
}
const DEFAULTS: Options = { kind: "password", length: 20, upper: true, lower: true, digits: true, symbols: true, clear: false, words: 6, separator: "-", capitals: false, number: false }
export const keptOptions = devicePref<Partial<Options>>("web-viewer:password-generator", {})
export const generatorOptions = (): Options => ({ ...DEFAULTS, ...keptOptions.get() })
