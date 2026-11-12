// app.update (vau update): a look now at the branch this server follows, the same look the timed ones are
// (core/update/updater.ts), for whoever just pushed and doesn't want to wait for the next.
import { defineOp, type Op } from "../ops.ts"
import type { UpdateStatus } from "../update/updater.ts"
import { checkNow, LOOK_EVERY, updateStatus } from "../update/updater.ts"
import { desktopCall, inDesktop } from "../desktopapp.ts"
import { running } from "../running.ts"

const short = (sha?: string) => String(sha ?? "").slice(0, 7)

export function updateOps(): Op[] {
  return [defineOp({
    id: "app.update",
    cli: "update",
    summary: "Look now for a newer commit of the branch this server follows, and take it as a timed look would.",
    help: `A service install following a branch (vau service install --updates main) looks every ${LOOK_EVERY / 60_000} minutes; this
looks now. It takes a commit only as a timed look does: CI's tests for this server's OS passed on it, the checkout is
clean and on the branch, nobody is at work in the browser. A look already under way is joined, not run twice. It
answers the updates' state after the look (vau version's): when the checkout is what blocks it, which files aren't
committed or which commits aren't on the branch; when the commit taken is red on another OS, which job. A server it updates answers first, then restarts if its own code changed. Another server: --url.
A server in the desktop app that follows no branch asks the app instead: Vaultite Main looks now, taking the commit
through its code store where that's on (only what it changed restarts), else starting its build of the whole app.

  vau update
  vau update --json
  vau --url https://m1.example.ts.net:8447 update`,
    kind: "write",
    // (it writes nothing in the vault, and a look may take minutes: a store root made, a build)
    lock: false,
    owner: "updating the server",
    // (a server that follows nothing in the desktop app: the app's own updates look now, Main's through its code store)
    // (this server's own commit told: the app can't ask it while this op runs)
    run: async () => updateStatus().branch || !inDesktop() ? checkNow()
      : ((await desktopCall("app:update-look", [{ port: Number(process.env.PORT), commit: (await running()).commit }], 30 * 60_000).catch(() => null)) as UpdateStatus | null) ?? checkNow(),
    text: (s: UpdateStatus) => [
      s.branch ? `Following ${s.branch}, ${s.state}: ${s.why}` : `Updates ${s.state}: ${s.why}`,
      ...(s.running || s.origin ? [[s.running && `Runs ${short(s.running)}`, s.origin && `origin/${s.branch} is at ${short(s.origin)}`].filter(Boolean).join("; ")] : []),
      ...(s.blocked?.files?.length ? ["Not committed:", ...s.blocked.files.map((f) => `- ${f}`)] : []),
      ...(s.blocked?.commits?.length ? [`Not on origin/${s.branch}:`, ...s.blocked.commits.map((c) => `- ${c}`)] : []),
      ...(s.last ? [`Last update: ${short(s.last.from)} to ${short(s.last.to)}, ${new Date(s.last.at).toISOString()}${s.last.elsewhere?.length ? ` (CI red on it elsewhere: ${s.last.elsewhere.join(", ")})` : ""}`] : []),
    ].join("\n"),
    did: () => ({ action: "run", text: "Looked for an update of the server" }),
  })]
}
