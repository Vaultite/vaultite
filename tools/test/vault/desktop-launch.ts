import type { VaultTest } from "./harness.ts"

const same = (pairs: [got: unknown, want: unknown][]) => pairs.every(([got, want]) => JSON.stringify(got) === JSON.stringify(want))

async function commandLine(check: VaultTest["check"]) {
  const { plainArgs } = await import("../../../electron/argv.ts")
  check("desktop: Open with's files are the command line's plain arguments, never Node's -r module, --vault's path or the app's folder", same([
    [plainArgs(["electron", "-r", "/t/hook.cjs", "/app", "--vault", "/v", "a.md"], false), ["a.md"]],
    [plainArgs(["electron", "/app", "--inspect", "file:///x/b.md", "vaultite://open"], false), ["file:///x/b.md"]],
    [plainArgs(["Vaultite", "--vault=/v", "c.md", "d.md"], true), ["c.md", "d.md"]],
  ]))
}

export default async ($: VaultTest) => {
  await commandLine($.check)
}
