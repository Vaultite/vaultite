# ghostty-vt.wasm

libghostty-vt, Ghostty's terminal emulator as a library, built for WebAssembly by the Ghostty project (MIT license,
https://github.com/ghostty-org/ghostty). Not built here: its release file, its minisign signature checked against
Ghostty's key by `tools/ghostty_update.ts`, which wrote this file.

- Version: 0.1.0-dev+c412a31
- Source commit: c412a31
- From: https://github.com/ghostty-org/ghostty/releases/download/tip/ghostty-vt.wasm
- SHA-256: 8f94bfae9c83823b46c3580786f7c54ad5c765b7737e1916d866f302541b2bce
- Taken: 2026-11-05

Its C API: `include/ghostty/vt.h` at that commit (https://libghostty.tip.ghostty.org/). `vt.ts` reads enum values
from the module itself (`ghostty_type_json`); struct offsets it uses are checked by `tools/test_vt.ts`.
