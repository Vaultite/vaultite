import fs from "node:fs"
import { Vt, type VtOptions } from "./vt.ts"

let module: WebAssembly.Module | null = null

export const vtModule = () => (module ??= new WebAssembly.Module(fs.readFileSync(new URL("./ghostty-vt.wasm", import.meta.url))))

export function newVt(o: VtOptions) {
  return new Vt(vtModule(), o)
}
