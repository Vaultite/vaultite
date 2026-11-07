# ghostty-vt.wasm

libghostty-vt, Ghostty's terminal emulator as a library, built for WebAssembly by the Ghostty project (MIT license,
https://github.com/ghostty-org/ghostty). Not built here: its release file, its minisign signature checked against
Ghostty's key by `tools/ghostty_update.ts`, which wrote this file.

- Version: 1.0.0
- Source: tag vt-1.0.0
- From: https://release.files.ghostty.org/libghostty-vt/1.0.0/ghostty-vt-1.0.0.wasm
- SHA-256: 7b428fee6d0677bc81279458f8f9a3335454834123a9ff47efb3fd177f6da5a8
- Taken: 2026-11-07

Its C API: `include/ghostty/vt.h` there (https://lib.ghostty.org/). `vt.ts` reads enum values
from the module itself (`ghostty_type_json`); struct offsets it uses are checked by `tools/test_vt.ts`.
