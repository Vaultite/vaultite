// The code's entry, which the shell imports (electron/shell/boot.mjs, with Node's compile cache on): the main process.
// (early.ts first, on its own: a static import of both would load all of main.ts's modules before its servers start)
await import("./early.ts")
await import("./main.ts")
