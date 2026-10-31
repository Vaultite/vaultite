import type { Any, VaultTest } from "./harness.ts"
import { waitFor } from "../lib.ts"

export default async ($: VaultTest) => {
  // Pages' shared state (plugins/core/html/shared.ts): one JSON map per page, the same in every view, kept beside it.
  const { app, check, exists, read, write } = $
  const { sharedPath } = await import("../../../plugins/core/html/shared.ts")
  const { shared: pages } = await import("../../../plugins/core/html/plugin.ts")
  write("Games/Duel.html", "<!doctype html><title>Duel</title><p>Duel</p>")

  /** A view: its socket, what it was sent, and its say. */
  function view(id: string, name: string, rel = "Games/Duel.html") {
    const got: Any[] = [], on: Record<string, (d?: unknown) => void> = {}
    const ws = { readyState: 1, OPEN: 1, send: (t: string) => got.push(JSON.parse(t)), on: (e: string, fn: () => void) => { on[e] = fn }, close: () => on.close?.() } as Any
    pages.join(ws, rel, { shown: rel, person: { id, name } })
    return { got, say: (m: object) => on.message?.(JSON.stringify(m)), close: () => on.close?.(), last: (t: string) => got.filter((m) => m.t === t).at(-1) }
  }
  const mac = view("devmac01", "Alice Park"), phone = view("devphone1", "Alice Park")
  check("shared pages: a view is told the state and who's here, each person a colour of their own",
    mac.got[0].t === "hello" && phone.got[0].t === "hello" && phone.got[0].people.length === 2 && phone.got[0].me.id === "devphone1" &&
    new Set(phone.got[0].people.map((p: Any) => p.tint)).size === 2, phone.got[0])
  check("shared pages: ...and the others hear someone came", mac.last("people")?.people.map((p: Any) => p.id).join() === "devmac01,devphone1", mac.got)

  mac.say({ t: "set", n: 1, values: { round: 1, "answer:devmac01": "C4" } })
  check("shared pages: a set is taken, and the others hear it, by whom", mac.last("ok")?.n === 1 && phone.last("set")?.by === "devmac01" &&
    phone.last("set")?.values.round === 1 && !mac.got.some((m) => m.t === "set"), phone.got)
  phone.say({ t: "set", n: 1, values: { "answer:devmac01": null, round: 2 } })
  check("shared pages: null deletes a key", JSON.stringify(pages.read("Games/Duel.html").state) === '{"round":2}', pages.read("Games/Duel.html"))

  phone.say({ t: "set", n: 2, values: { big: "x".repeat(70_000) } })
  check("shared pages: a value over 64 KiB is refused, with what the key holds to show again", phone.last("no")?.n === 2 &&
    phone.last("no")?.values.big === null && !("big" in pages.read("Games/Duel.html").state), phone.last("no"))
  phone.say({ t: "set", n: 3, values: [1] })
  check("shared pages: values is an object of keys", phone.last("no")?.n === 3)

  await waitFor(() => exists(sharedPath("Games/Duel.html")), 2000)
  check("shared pages: kept beside the page as JSON a person can read", JSON.parse(read(sharedPath("Games/Duel.html"))).round === 2, read(sharedPath("Games/Duel.html")))

  // An agent's look and set (ops): every view shows it at once.
  const looked = (await app.callOp("html.shared", { path: "Games/Duel.html" })).result as Any
  check("shared pages: html.shared says the state and who has it open", looked.state.round === 2 && looked.people.length === 2, looked)
  await app.callOp("html.shared-set", { path: "Games/Duel.html", values: { round: 3 } })
  check("shared pages: html.shared-set reaches every view", mac.last("set")?.values.round === 3 && phone.last("set")?.values.round === 3)
  let refused = ""
  try { await app.callOp("html.shared", { path: "Games/../.vaultite/x.html" }) } catch (e) { refused = (e as Error).message }
  check("shared pages: only a page in the vault", /not an artifact/.test(refused), refused)

  // Everyone gone: written at once, and read back by the next one.
  phone.close()
  check("shared pages: one leaving, the others hear it", mac.last("people")?.people.length === 1)
  mac.close()
  check("shared pages: the last one leaving writes it and lets the page go", JSON.parse(read(sharedPath("Games/Duel.html"))).round === 3 && !pages.list().length)
  const again = view("devmac01", "Alice Park")
  check("shared pages: opened again, it's as it was left", again.got[0].state.round === 3, again.got[0])

  // The page moves: its views close (they open it by its new name) and its state follows.
  write("Games/Moved.html", "<!doctype html><title>Moved</title>")
  pages.moved("Games/Duel.html", "Games/Moved.html")
  check("shared pages: moved, its state follows", !exists(sharedPath("Games/Duel.html")) && JSON.parse(read(sharedPath("Games/Moved.html"))).round === 3 && !pages.list().length)
}
