import { check, section } from "../lib.ts"

// ---------- Browser: where agents from outside this machine may go (core/web.ts localUrl, electron/browser/agent.ts) ----------
await section("agents' local addresses", async () => {
  const { localUrl } = await import("../../../core/web.ts")
  const os = await import("node:os")
  const local = ["http://127.0.0.1:8793", "http://localhost:3000/x", "http://app.localhost", "http://[::1]:8793", "http://[::ffff:127.0.0.1]", "http://0.0.0.0",
    "http://192.168.1.20", "http://10.0.0.5", "http://172.16.0.1", "http://169.254.169.254/latest", "http://[fe80::1]", "http://100.101.102.103",
    "https://m1.tail1234.ts.net", "http://m1", "http://nas.local:5000", `http://${os.hostname()}:8793`, "not an address"]
  check("agents' addresses: this machine, its network and the tailnet are local", local.every(localUrl), local.filter((u) => !localUrl(u)))
  check("agents' addresses: … a public site isn't", !["https://example.com", "http://93.184.216.34", "https://lighthouse.example.org/a?b"].some(localUrl))
})

// ---------- Browser: the user's passkeys approving agents' logins (electron/browser/presence.ts) ----------
// A made-up authenticator here (a P-256 key, as a phone's passkey has), WebAuthn's bytes built by hand.
await section("login approvals", async () => {
  const pr = await import("../../../electron/browser/presence.ts")
  const { encode } = await import("../../../electron/browser/cbor.ts")
  const crypto = await import("node:crypto")
  const RP = "m1.example.ts.net", ORIGIN = `https://${RP}:8447`
  const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest()
  const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url")
  const device = () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
    const j = publicKey.export({ format: "jwk" })
    const cose = encode(new Map<number, Buffer | number>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(j.x!, "base64url")], [-3, Buffer.from(j.y!, "base64url")]]))
    return { privateKey, cose, id: crypto.randomBytes(16) }
  }
  const authData = (rp: string, flags: number, counter: number, attested?: { id: Buffer; cose: Buffer }) => {
    const c = Buffer.alloc(4); c.writeUInt32BE(counter)
    const parts: Uint8Array[] = [sha(rp), Buffer.from([flags]), c]
    if (attested) { const n = Buffer.alloc(2); n.writeUInt16BE(attested.id.length); parts.push(Buffer.alloc(16), n, attested.id, attested.cose) }
    return Buffer.concat(parts)
  }
  const client = (type: string, challenge: Buffer, origin = ORIGIN) => Buffer.from(JSON.stringify({ type, challenge: b64u(challenge), origin, crossOrigin: false }))
  const created = (d: ReturnType<typeof device>, challenge: Buffer, o: { rp?: string; flags?: number; origin?: string } = {}) => ({
    clientDataJSON: b64u(client("webauthn.create", challenge, o.origin)),
    attestationObject: b64u(encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData(o.rp ?? RP, o.flags ?? 0x45, 0, d)]]) as never)) })
  const signed = (d: ReturnType<typeof device>, challenge: Buffer, o: { rp?: string; flags?: number; origin?: string; counter?: number; key?: import("node:crypto").KeyObject } = {}) => {
    const ad = authData(o.rp ?? RP, o.flags ?? 0x05, o.counter ?? 0), cd = client("webauthn.get", challenge, o.origin)
    const signature = crypto.sign("sha256", Buffer.concat([ad, sha(cd)]), { key: o.key ?? d.privateKey, dsaEncoding: "der" })
    return { id: b64u(d.id), clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(signature) }
  }
  const fails = (fn: () => unknown) => { try { fn(); return "" } catch (e) { return (e as Error).message || "failed" } }

  const phone = device(), c1 = crypto.randomBytes(32)
  const pk = pr.register(created(phone, c1), c1, "iPhone")
  check("login approvals: a passkey registers, for the page's own site", pk.id === b64u(phone.id) && pk.rpId === RP && pk.origin === ORIGIN && pk.name === "iPhone", pk)
  const refusedReg = {
    "another challenge": fails(() => pr.register(created(phone, c1), crypto.randomBytes(32), "x")),
    "no user verification": fails(() => pr.register(created(phone, c1, { flags: 0x41 }), c1, "x")),
    "another site's hash": fails(() => pr.register(created(phone, c1, { rp: "evil.example" }), c1, "x")),
    "an http page": fails(() => pr.register(created(phone, c1, { origin: `http://${RP}` }), c1, "x")),
  }
  check("login approvals: a registration for another challenge, without Face ID or Touch ID, of another site or over http fails", Object.values(refusedReg).every(Boolean), refusedReg)

  const c2 = crypto.randomBytes(32)
  const ok = pr.verify(signed(phone, c2), [pk], c2)
  check("login approvals: the phone's assertion verifies", ok.passkey.id === pk.id, ok)
  const other = device()
  const refused = {
    "forged (another key)": fails(() => pr.verify(signed(phone, c2, { key: other.privateKey }), [pk], c2)),
    "an unknown passkey": fails(() => pr.verify(signed(other, c2), [pk], c2)),
    "another challenge (replayed)": fails(() => pr.verify(signed(phone, c2), [pk], crypto.randomBytes(32))),
    "no user verification": fails(() => pr.verify(signed(phone, c2, { flags: 0x01 }), [pk], c2)),
    "another site": fails(() => pr.verify(signed(phone, c2, { rp: "evil.example", origin: "https://evil.example" }), [pk], c2)),
    "another origin for its site": fails(() => pr.verify(signed(phone, c2, { origin: "https://evil.example" }), [pk], c2)),
    "its client data changed": fails(() => pr.verify({ ...signed(phone, c2), clientDataJSON: b64u(Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: b64u(c2), origin: ORIGIN, crossOrigin: true }))) }, [pk], c2)),
    "a counter gone back": fails(() => pr.verify(signed(phone, c2, { counter: 3 }), [{ ...pk, counter: 5 }], c2)),
  }
  check("login approvals: forged, unknown, replayed, unverified, other sites', changed or counted-back assertions fail", Object.values(refused).every(Boolean), refused)
  check("login approvals: a counter that goes up is new", pr.verify(signed(phone, c2, { counter: 6 }), [{ ...pk, counter: 5 }], c2).counter === 6)
})
