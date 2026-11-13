# ghostty-vt.wasm

libghostty-vt, Ghostty's terminal emulator as a library (MIT license, https://github.com/ghostty-org/ghostty), built
here by `tools/ghostty_update.ts --build 1.0.0` from Ghostty's signed release source with patches of ours:
Ghostty's own wasm (wasm32-freestanding) has kitty graphics compiled out; this is wasm32-wasi, its WASI imports
stubs `vt.ts` gives (no clock, no files), and its grown pages zeroed as Ghostty does on freestanding.

- Version: 1.0.0
- Source: libghostty-vt-1.0.0.tar.gz (+ libghostty-vt-1.0.0-deps.tar.gz), minisign checked against Ghostty's key
- Source SHA-256: 4a6ef758be721923e1969e7b81b443dcc92d8dd3fb5a39600c03a8817a753676; deps SHA-256: 4d5ea5e448e4c7ea8fb55ccbaa8668f2a97d44f438cee831e2b7ecd162d85c29
- Patches (vt/patches/): 1-wasi-libc.patch (SHA-256 9c886cf2b21c9c60a196e889f159c8108858ab620b268d8436a9157c6f72925b); 2-wasi-no-shm.patch (SHA-256 f16ce442db101ae3b2f6cf6b35466127239c33250815182a6a856948eb1c0a04); 3-wasi-zeroed-pages.patch (SHA-256 06fdeb401f0a6dcd399a209226269f400de97e5a70e326c33ad0c15c7a494685)
- Zig: 0.17.1 (build.zig.zon asks for 0.17.0 at least), from ziglang.org, minisign checked against Zig's key; SHA-256: 75f1bc7a1e9852f17ec9a0c1895f767c4ec56d46bc8a834920eece1d0359dd8d
- Build: `zig build -Demit-lib-vt -Dtarget=wasm32-wasi -Doptimize=ReleaseFast -Dstrip=true`, in fresh folders and caches
- Reproducible: yes (built twice: the same bytes; `--check` builds again and compares)
- SHA-256: 9da5385182ab16c86e4affe95aadbee3c30dea3b2c368ad5225ff515fc376487
- Built: 2026-11-13

Its C API: `include/ghostty/vt.h` there (https://lib.ghostty.org/). `vt.ts` reads enum values from the module
itself (`ghostty_type_json`); struct offsets it uses are checked by `tools/test_vt.ts`.
