// The server's libghostty-vt: the module compiled once (on the first terminal), each terminal its own instance.
import fs from "node:fs"
import { Vt, type VtOptions } from "./vt.ts"

let module: WebAssembly.Module | null = null

export function newVt(o: VtOptions) {
  module ??= new WebAssembly.Module(fs.readFileSync(new URL("./ghostty-vt.wasm", import.meta.url)))
  return new Vt(module, o)
}
