# Notes for `examples/`

- **The sandbox** (`core/sandbox.ts`, `vau sandbox <folder>`; desktop: `electron/sandbox.ts`): a made-up vault to try
  the app in, calm on purpose (two pins, two panels, six folders at the top, four people, only the plugins a first look
  needs). Don't grow it into a showcase: Design.md is that. `examples/vault/` is written as of `ANCHOR`; making it
  moves every date to today and generates the daily logs from a seed per date, so the same day makes the same files.
  It replaces only a folder marked `.vaultite/sandbox.json` (or an empty one). A change to how it's made (not the sample
  itself) raises `MAKE`, so made ones (desktop, the web demo's saved copy) are made again. Tests: `tools/test_sandbox.ts`.
