import { check, section } from "../lib.ts"
import { portOf } from "../../../core/listening.ts"

// ---------- Browser: passkeys from a phone (electron/browser/hybrid.ts, webauthn.ts) ----------
// Chromium's and a real phone's vectors (via kanidm's webauthn-authenticator-rs), then sign-up and sign-in with a fake phone.
await section("passkeys", async () => {
  const h = await import("../../../electron/browser/hybrid.ts")
  const w = await import("../../../electron/browser/webauthn.ts")
  const { encode, decode } = await import("../../../electron/browser/cbor.ts")
  const { WebSocketServer, default: WebSocket } = await import("ws")
  const crypto = await import("node:crypto")
  const hex = (b: Uint8Array) => Buffer.from(b).toString("hex")
  const QRS = ["FIDO:/162870791865632382552704231438327900152302540348097243854039966655366469794954476199158014113179232779520163209900691930075274801398564434658077048963842109321447142660",
    "FIDO:/089962132878132862898875319509818655951233947060166026934941652203853844930597225184066237811614893181300344014421205790072080843938838513707157859599106109321447142404"]
  check("passkeys: Chrome's and Safari's QR codes read and write back the same", QRS.every((u) => `FIDO:/${h.base10(encode(h.parseQr(u)))}` === u))
  check("passkeys: tunnel servers by number, assigned and derived", JSON.stringify([0, 1, 266, 255, 0xf980].map(h.domainOf))
    === JSON.stringify(["cable.ua5v.com", "cable.auth.com", "cable.wufkweyy3uaxb.com", null, "cable.my4kstlhndi4c.net"]))
  const secret = Buffer.from([1, 254, 166, 247, 196, 128, 116, 147, 220, 37, 111, 158, 172, 247, 86, 201])
  const advert = Buffer.from([2, 125, 132, 237, 96, 118, 181, 94, 36, 124, 131, 15, 130, 149, 94, 77, 18, 110, 127, 67])
  const eid = h.readAdvert(advert, h.eidKey(secret))
  check("passkeys: a phone's real advert decrypts to its tunnel", !!eid && eid.domain === 0 && hex(eid.routingId) === "026555" && hex(eid.nonce) === "8bb5c5c9a44d913a5eb2"
    && h.connectUrl(h.domainOf(eid.domain)!, eid.routingId, h.tunnelId(secret)) === "wss://cable.ua5v.com/cable/connect/026555/367CBBF5F5085DF4098476AFE4B9B1D2", eid)
  const bad = Buffer.from(advert); bad[0] ^= 1
  check("passkeys: an advert for another QR code (or changed) is ignored", h.readAdvert(bad, h.eidKey(secret)) === null && h.readAdvert(advert.subarray(1), h.eidKey(secret)) === null)

  // kanidm's vector: a makeCredential as the tunnel frames it, then sealed with the new nonce layout
  const b = (a: number[]) => Buffer.from(a).toString("base64url")
  const mc = w.prepareCreate({ rp: { id: "webauthn.firstyear.id.au", name: "webauthn.firstyear.id.au" },
    user: { id: b([0xd6, 0xd7, 0xaa, 0x29, 0x8f, 0xe8, 0x4a, 0x6, 0xaa, 0xde, 0xd7, 0xe4, 0x9d, 0x90, 0xa, 0x62]), name: "a", displayName: "a" },
    challenge: b(Array(16).fill(7)), pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    excludeCredentials: [{ type: "public-key", id: b([0, 1, 2, 3]) }], authenticatorSelection: { residentKey: "discouraged", userVerification: "required" } }, "https://webauthn.firstyear.id.au")
  const frame = Buffer.concat([Buffer.from([1]), mc.command])
  frame.set(Buffer.from("3889285c8c6323950ced074984f9f9463bc1739bb621a9e5f1ee8dd9393ba280", "hex"), 6) // (the vector's client data hash)
  check("passkeys: a makeCredential is CTAP2's canonical CBOR", hex(frame) === "0101a60158203889285c8c6323950ced074984f9f9463bc1739bb621a9e5f1ee8dd9393ba28002a26269647818776562617574686e2e6669727374796561722e69642e6175646e616d657818776562617574686e2e6669727374796561722e69642e617503a362696450d6d7aa298fe84a06aaded7e49d900a62646e616d6561616b646973706c61794e616d6561610482a263616c672664747970656a7075626c69632d6b6579a263616c6739010064747970656a7075626c69632d6b65790581a2626964440001020364747970656a7075626c69632d6b657907a1627576f5", hex(frame))
  const writeKey = Buffer.from("1fba3cce17622c68268d9f75b5a8a3351b517f096fb5e294941af7e3a6a8d6e1", "hex"), readKey = Buffer.from("e34f1aa3747238c04d3bd25e07ef1b35fef359000d755615cd85be27cfc807d1", "hex")
  const sealed = new h.Crypter(readKey, writeKey, "new").encrypt(frame)
  check("passkeys: sealed as Chromium seals it (padding, nonce, key)", hex(sealed) === "5062cf34571e0827a7c0207f7c00184567d613eab0da080ad042d80664c59df7b01a13db17fd277575ccff53b6a34fdb4fbcf832f3d360f8e5a7daee7f265a9253a904d6ebff2f9370d35536d8bf054830aaadffb996b420b2b3170ac80a83796823ed3c284b177c23400ca0124d6a68263d39783cfef0273fdf3bfcfa0a6c33df319b126f6e8290d22c4cd32a7a978856ba2273d1be1c0a291e5ee197416aa0f7a104e4d0ac582b708482326d5ff0f1768c1416d016b1f89242e70e80312fe6b6d4029a40ada374b31e7d66fac3ba7283944b9b60da4b98f67804095fd39cd1d45d75c93d2d86cbfc21616f9f1a576ccf8c862ee185125fc1ed7ed2486e2c5fbfc39c919597dd86c338e7df553d51e8", hex(sealed).slice(0, 40))
  check("passkeys: the other side reads it, guessing the nonce layout", hex(new h.Crypter(writeKey, readKey).decrypt(sealed)) === hex(frame))

  check("passkeys: a page may use its own site's passkeys, never another's or a public suffix's", w.rpIdFor("https://accounts.google.com", "google.com") === "google.com"
    && w.rpIdFor("https://github.com", undefined) === "github.com" && w.rpIdFor("http://localhost:3000", undefined) === "localhost"
    && ["https://evil.com|google.com", "https://x.github.io|github.io", "http://example.com|", "https://10.0.0.1|"].every((c) => {
      const [o, id] = c.split("|"); try { w.rpIdFor(o, id || undefined); return false } catch (e) { return (e as Error).name === "SecurityError" }
    }))

  // A phone: a tunnel server on 127.0.0.1 that's also the phone at its far end, holding one P-256 passkey.
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1", handleProtocols: (p) => (p.has("fido.cable") ? "fido.cable" : false) })
  await new Promise((ok) => server.once("listening", ok))
  const port = portOf(server)
  const cred = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }), credId = crypto.randomBytes(16)
  const jwk = cred.publicKey.export({ format: "jwk" }) as { x: string; y: string }
  const cose = encode(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]) as never)
  let paths: string[] = [], phoneSaw: unknown = null
  const phone = (qr: string) => {
    const m = h.parseQr(qr)
    const identity = crypto.ECDH.convertKey(m.get(0) as Uint8Array, "prime256v1", undefined, undefined, "uncompressed") as Buffer
    const s = m.get(1) as Uint8Array, plain = Buffer.alloc(16)
    crypto.randomBytes(10).copy(plain, 1); plain.set([0xab, 0xcd, 0xef], 11); plain.writeUInt16LE(1, 14)
    server.once("connection", (ws, req) => {
      paths.push(req.url ?? "")
      let crypter: InstanceType<typeof h.Crypter> | null = null
      ws.on("message", (data: Buffer) => {
        if (!crypter) {
          const r = h.respond(identity, h.pskOf(s, plain), data)
          crypter = r.crypter
          ws.send(r.response)
          ws.send(crypter.encrypt(encode(new Map([[1, encode(new Map([[1, ["FIDO_2_0"]]]) as never)]]) as never)))
          return
        }
        const msg = crypter.decrypt(data)
        if (msg[0] !== 1) return
        const req2 = decode(msg.subarray(2)) as Map<number, unknown>
        phoneSaw = { cmd: msg[1], keys: [...req2.keys()] }
        const rpId = String(msg[1] === 1 ? (req2.get(2) as Map<string, string>).get("id") : req2.get(1))
        const rpHash = crypto.createHash("sha256").update(rpId).digest()
        let answer: Map<number, unknown>
        if (msg[1] === 1) {
          const att = Buffer.concat([Buffer.alloc(16), Buffer.from([0, credId.length]), credId, cose])
          const authData = Buffer.concat([rpHash, Buffer.from([0x45]), Buffer.alloc(4), att])
          answer = new Map<number, unknown>([[1, "packed"], [2, authData], [3, new Map([["alg", -7]])]])
        } else {
          const authData = Buffer.concat([rpHash, Buffer.from([0x05]), Buffer.from([0, 0, 0, 1])])
          const sig = crypto.sign("sha256", Buffer.concat([authData, req2.get(2) as Uint8Array]), cred.privateKey)
          answer = new Map<number, unknown>([[1, new Map<string, unknown>([["id", credId], ["type", "public-key"]])], [2, authData], [3, sig], [4, new Map([["id", Buffer.from("alice")]])]])
        }
        ws.send(crypter.encrypt(Buffer.concat([Buffer.from([1, 0]), encode(answer as never)])))
      })
    })
    return h.makeAdvert(plain, h.eidKey(s))
  }
  const ask = async (p: ReturnType<typeof w.prepareGet>) => {
    const secret2 = crypto.randomBytes(16), identity = h.newKey()
    const advertFor = phone(h.qrText({ identity: h.publicOf(identity, true), secret: secret2, type: p.type }))
    const states: string[] = []
    const answer = await h.run({ secret: secret2, identity, command: p.command, signal: AbortSignal.timeout(10_000), progress: (s) => states.push(s),
      adverts: (on) => { const t = setTimeout(() => { on(crypto.randomBytes(20)); on(advertFor) }, 20); return () => clearTimeout(t) },
      connect: (url) => new WebSocket(`ws://127.0.0.1:${port}${new URL(url).pathname}`, "fido.cable") })
    return { answer, states, tunnel: hex(h.tunnelId(secret2)).toUpperCase() }
  }
  const origin = "https://shop.example.com", challenge = crypto.randomBytes(32).toString("base64url")
  const made = w.prepareCreate({ rp: { id: "example.com", name: "Lighthouse" }, user: { id: b([1, 2, 3]), name: "alice@example.com", displayName: "Alice Park" },
    challenge, pubKeyCredParams: [{ type: "public-key", alg: -7 }], authenticatorSelection: { residentKey: "required" }, extensions: { credProps: true } }, origin)
  const created = await ask(made)
  const c = w.readCreate(created.answer, made)
  const attObj = decode(Buffer.from(c.response.attestationObject, "base64url")) as Map<string, unknown>
  const cd = JSON.parse(Buffer.from(c.response.clientDataJSON, "base64url").toString())
  check("passkeys: sign-up over the tunnel: the phone's passkey, attestation none, the page's origin", c.id === credId.toString("base64url") && attObj.get("fmt") === "none"
    && cd.type === "webauthn.create" && cd.challenge === challenge && cd.origin === origin && c.clientExtensionResults.credProps?.rk === true
    && paths[0] === `/cable/connect/ABCDEF/${created.tunnel}` && created.states.join() === "scan,connecting,phone", { c, paths, states: created.states })
  const key = crypto.createPublicKey({ key: Buffer.from(c.response.publicKey!, "base64url"), format: "der", type: "spki" })
  const got = w.prepareGet({ challenge, rpId: "example.com", allowCredentials: [{ type: "public-key", id: c.id }] }, origin)
  const signed = w.readGet((await ask(got)).answer, got)
  const data = Buffer.concat([Buffer.from(signed.response.authenticatorData, "base64url"), crypto.createHash("sha256").update(Buffer.from(signed.response.clientDataJSON, "base64url")).digest()])
  check("passkeys: sign-in over the tunnel: the phone's signature verifies with the key from sign-up", crypto.verify("sha256", data, key, Buffer.from(signed.response.signature, "base64url"))
    && signed.response.userHandle === Buffer.from("alice").toString("base64url"), { signed, phoneSaw })
  let none = ""
  try { w.readGet(Buffer.from([0x2e]), got) } catch (e) { none = (e as Error).name }
  check("passkeys: a phone without a passkey for the site: NotAllowedError", none === "NotAllowedError", none)
  let wrong = ""
  try { w.readGet(Buffer.concat([Buffer.from([0]), encode(new Map<number, unknown>([[1, new Map([["id", credId]])], [2, Buffer.concat([crypto.createHash("sha256").update("evil.com").digest(), Buffer.alloc(5)])], [3, Buffer.alloc(8)]]) as never)]), got) } catch (e) { wrong = (e as Error).name }
  check("passkeys: an answer for another site is refused", wrong === "NotAllowedError", wrong)
  server.close()
})
