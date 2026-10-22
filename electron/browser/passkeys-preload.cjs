// A page's own frame's navigator.credentials for public keys, sent to the app (passkeys.ts). In the page's main world, as
// its scripts call it there: it holds only the bridge's ask and cancel, no global; the app checks the origin itself.
"use strict"
const { contextBridge, ipcRenderer } = require("electron")

if (process.isMainFrame && /^https?:/.test(location.href)) {
  contextBridge.executeInMainWorld({
    func: install,
    args: [(kind, json) => ipcRenderer.invoke("vaultite:passkey", kind, json), () => ipcRenderer.send("vaultite:passkey:cancel")],
  })
}

// (serialized into the page's world: it sees only its arguments)
function install(ask, cancel) {
  const Container = window.CredentialsContainer, PKC = window.PublicKeyCredential
  if (!Container || !PKC || !window.AuthenticatorAttestationResponse) return
  const nativeGet = Container.prototype.get, nativeCreate = Container.prototype.create

  const enc = (v) => {
    const u = v instanceof ArrayBuffer ? new Uint8Array(v) : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : null
    if (!u) throw new TypeError("Expected a BufferSource")
    let s = ""
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  }
  const dec = (s) => {
    const t = atob(s.replace(/-/g, "+").replace(/_/g, "/"))
    const u = new Uint8Array(t.length)
    for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i)
    return u.buffer
  }
  const list = (l) => (Array.isArray(l) ? l.map((d) => ({ type: d.type, id: enc(d.id) })) : undefined)
  const sel = (s) => (s ? { authenticatorAttachment: s.authenticatorAttachment, residentKey: s.residentKey, requireResidentKey: s.requireResidentKey, userVerification: s.userVerification } : undefined)
  const forCreate = (o) => ({
    rp: { id: o.rp.id, name: o.rp.name },
    user: { id: enc(o.user.id), name: o.user.name, displayName: o.user.displayName },
    challenge: enc(o.challenge), timeout: o.timeout, attestation: o.attestation,
    pubKeyCredParams: Array.isArray(o.pubKeyCredParams) ? o.pubKeyCredParams.map((p) => ({ type: p.type, alg: p.alg })) : [],
    excludeCredentials: list(o.excludeCredentials), authenticatorSelection: sel(o.authenticatorSelection),
    extensions: { credProps: !!(o.extensions && o.extensions.credProps) },
  })
  const forGet = (o) => ({ challenge: enc(o.challenge), timeout: o.timeout, rpId: o.rpId, allowCredentials: list(o.allowCredentials), userVerification: o.userVerification })

  // A PublicKeyCredential the page can't tell from Chromium's: the real prototypes, with its values as own properties.
  const own = (o, values, methods) => {
    for (const k in values) Object.defineProperty(o, k, { value: values[k], enumerable: true, configurable: true })
    for (const k in methods) Object.defineProperty(o, k, { value: methods[k], configurable: true, writable: true })
    return o
  }
  const credential = (r, create) => {
    const x = r.response
    const response = create
      ? own(Object.create(window.AuthenticatorAttestationResponse.prototype), { clientDataJSON: dec(x.clientDataJSON), attestationObject: dec(x.attestationObject) }, {
          getTransports: () => x.transports.slice(),
          getAuthenticatorData: () => dec(x.authenticatorData),
          getPublicKey: () => (x.publicKey ? dec(x.publicKey) : null),
          getPublicKeyAlgorithm: () => x.publicKeyAlgorithm,
          toJSON: () => ({ clientDataJSON: x.clientDataJSON, attestationObject: x.attestationObject, authenticatorData: x.authenticatorData,
            transports: x.transports.slice(), ...(x.publicKey ? { publicKey: x.publicKey } : {}), publicKeyAlgorithm: x.publicKeyAlgorithm }),
        })
      : own(Object.create(window.AuthenticatorAssertionResponse.prototype), { clientDataJSON: dec(x.clientDataJSON), authenticatorData: dec(x.authenticatorData),
          signature: dec(x.signature), userHandle: x.userHandle ? dec(x.userHandle) : null }, {
          toJSON: () => ({ clientDataJSON: x.clientDataJSON, authenticatorData: x.authenticatorData, signature: x.signature, ...(x.userHandle ? { userHandle: x.userHandle } : {}) }),
        })
    return own(Object.create(PKC.prototype), { id: r.id, rawId: dec(r.rawId), type: "public-key", authenticatorAttachment: r.authenticatorAttachment, response }, {
      getClientExtensionResults: () => JSON.parse(JSON.stringify(r.clientExtensionResults)),
      toJSON: () => ({ id: r.id, rawId: r.rawId, type: "public-key", authenticatorAttachment: r.authenticatorAttachment, response: response.toJSON(),
        clientExtensionResults: JSON.parse(JSON.stringify(r.clientExtensionResults)) }),
    })
  }
  const abortError = (signal) => (signal.reason !== undefined ? signal.reason : new DOMException("The operation was aborted.", "AbortError"))

  const run = (kind, options) => {
    const signal = options.signal
    if (signal && signal.aborted) return Promise.reject(abortError(signal))
    let json
    try { json = JSON.stringify(kind === "create" ? forCreate(options.publicKey) : forGet(options.publicKey)) } catch (e) {
      return Promise.reject(e instanceof TypeError ? e : new TypeError("Invalid options"))
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => { cancel(); reject(abortError(signal)) }
      if (signal) signal.addEventListener("abort", onAbort, { once: true })
      ask(kind, json).then((out) => {
        if (signal) signal.removeEventListener("abort", onAbort)
        const r = JSON.parse(out)
        if (r.ok) resolve(credential(r.ok, kind === "create"))
        else reject(r.error.name === "TypeError" ? new TypeError(r.error.message) : new DOMException(r.error.message, r.error.name))
      }, () => reject(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError")))
    })
  }

  const methods = {
    get(options) {
      if (!options || !options.publicKey) return nativeGet.call(this, options)
      // (no passkeys to offer in a form's autofill: a conditional request waits till the page ends it)
      if (options.mediation === "conditional") {
        return new Promise((_, reject) => { if (options.signal) options.signal.addEventListener("abort", () => reject(abortError(options.signal)), { once: true }) })
      }
      if (options.mediation === "immediate") return Promise.reject(new DOMException("No passkey is available right away.", "NotAllowedError"))
      return run("get", options)
    },
    create(options) {
      if (!options || !options.publicKey) return nativeCreate.call(this, options)
      return run("create", options)
    },
  }
  for (const k of ["get", "create"]) Object.defineProperty(Container.prototype, k, { value: methods[k], configurable: true, writable: true })
  const statics = {
    isConditionalMediationAvailable: () => Promise.resolve(false),
    isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(false),
    getClientCapabilities: () => Promise.resolve({ conditionalCreate: false, conditionalGet: false, hybridTransport: true,
      passkeyPlatformAuthenticator: true, userVerifyingPlatformAuthenticator: false, relatedOrigins: false,
      signalAllAcceptedCredentials: false, signalCurrentUserDetails: false, signalUnknownCredential: false, "extension:credProps": true }),
  }
  for (const k in statics) Object.defineProperty(PKC, k, { value: statics[k], configurable: true, writable: true })
}
