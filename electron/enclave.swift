// A secret sealed to a key of this Mac's Secure Enclave that only Touch ID uses, as a Node addon (electron/enclave.ts).
// Not a Keychain item: those take an access control only with an entitlement our builds don't have (browser/CLAUDE.md).
import CryptoKit
import Foundation
import LocalAuthentication
import Security

// ---------- Node-API: the few calls used, declared (the host exports them), so building needs no headers

typealias Env = OpaquePointer
typealias Value = OpaquePointer
typealias Callback = @convention(c) (Env?, OpaquePointer?) -> Value?
typealias Execute = @convention(c) (Env?, UnsafeMutableRawPointer?) -> Void
typealias Complete = @convention(c) (Env?, Int32, UnsafeMutableRawPointer?) -> Void
@_silgen_name("napi_get_cb_info") func napi_get_cb_info(_: Env?, _: OpaquePointer?, _: UnsafeMutablePointer<Int>?, _: UnsafeMutablePointer<Value?>?, _: UnsafeMutablePointer<Value?>?, _: UnsafeMutablePointer<UnsafeMutableRawPointer?>?) -> Int32
@_silgen_name("napi_get_buffer_info") func napi_get_buffer_info(_: Env?, _: Value?, _: UnsafeMutablePointer<UnsafeMutableRawPointer?>?, _: UnsafeMutablePointer<Int>?) -> Int32
@_silgen_name("napi_create_buffer_copy") func napi_create_buffer_copy(_: Env?, _: Int, _: UnsafeRawPointer?, _: UnsafeMutablePointer<UnsafeMutableRawPointer?>?, _: UnsafeMutablePointer<Value?>?) -> Int32
@_silgen_name("napi_get_value_bool") func napi_get_value_bool(_: Env?, _: Value?, _: UnsafeMutablePointer<Bool>?) -> Int32
@_silgen_name("napi_get_boolean") func napi_get_boolean(_: Env?, _: Bool, _: UnsafeMutablePointer<Value?>?) -> Int32
@_silgen_name("napi_get_value_string_utf8") func napi_get_value_string_utf8(_: Env?, _: Value?, _: UnsafeMutablePointer<CChar>?, _: Int, _: UnsafeMutablePointer<Int>?) -> Int32
@_silgen_name("napi_create_string_utf8") func napi_create_string_utf8(_: Env?, _: UnsafePointer<CChar>?, _: Int, _: UnsafeMutablePointer<Value?>?) -> Int32
@_silgen_name("napi_create_error") func napi_create_error(_: Env?, _: Value?, _: Value?, _: UnsafeMutablePointer<Value?>?) -> Int32
@_silgen_name("napi_throw_error") func napi_throw_error(_: Env?, _: UnsafePointer<CChar>?, _: UnsafePointer<CChar>?) -> Int32
@_silgen_name("napi_create_promise") func napi_create_promise(_: Env?, _: UnsafeMutablePointer<OpaquePointer?>?, _: UnsafeMutablePointer<Value?>?) -> Int32
@_silgen_name("napi_resolve_deferred") func napi_resolve_deferred(_: Env?, _: OpaquePointer?, _: Value?) -> Int32
@_silgen_name("napi_reject_deferred") func napi_reject_deferred(_: Env?, _: OpaquePointer?, _: Value?) -> Int32
@_silgen_name("napi_create_async_work") func napi_create_async_work(_: Env?, _: Value?, _: Value?, _: Execute?, _: Complete?, _: UnsafeMutableRawPointer?, _: UnsafeMutablePointer<OpaquePointer?>?) -> Int32
@_silgen_name("napi_queue_async_work") func napi_queue_async_work(_: Env?, _: OpaquePointer?) -> Int32
@_silgen_name("napi_delete_async_work") func napi_delete_async_work(_: Env?, _: OpaquePointer?) -> Int32
@_silgen_name("napi_create_function") func napi_create_function(_: Env?, _: UnsafePointer<CChar>?, _: Int, _: Callback?, _: UnsafeMutableRawPointer?, _: UnsafeMutablePointer<Value?>?) -> Int32
@_silgen_name("napi_set_named_property") func napi_set_named_property(_: Env?, _: Value?, _: UnsafePointer<CChar>?, _: Value?) -> Int32

private func arguments(_ env: Env?, _ info: OpaquePointer?, _ n: Int) -> [Value?] {
  var count = n, args = [Value?](repeating: nil, count: n)
  _ = napi_get_cb_info(env, info, &count, &args, nil, nil)
  return args
}
private func bytes(_ env: Env?, _ v: Value?) -> Data {
  var p: UnsafeMutableRawPointer?, n = 0
  guard napi_get_buffer_info(env, v, &p, &n) == 0, let p else { return Data() }
  return Data(bytes: p, count: n)
}
private func buffer(_ env: Env?, _ d: Data) -> Value? {
  var out: Value?
  d.withUnsafeBytes { _ = napi_create_buffer_copy(env, d.count, $0.baseAddress, nil, &out) }
  return out
}
private func text(_ env: Env?, _ s: String) -> Value? {
  var out: Value?
  _ = napi_create_string_utf8(env, s, s.utf8.count, &out)
  return out
}

// ---------- sealing: ECDH with the Enclave's key, then HKDF and AES-GCM

private enum Failed: Error { case unreadable }
private let INFO = Data("vaultite secret 1".utf8)

private func cipherKey(_ shared: SharedSecret, _ ephemeral: Data, _ enclave: Data) -> SymmetricKey {
  shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: ephemeral + enclave, sharedInfo: INFO, outputByteCount: 32)
}

/** `finger`: only a finger enrolled now opens it (no login password, and none enrolled later). Off is the tests'. */
private func seal(_ secret: Data, finger: Bool) throws -> Data {
  var error: Unmanaged<CFError>?
  let flags: SecAccessControlCreateFlags = finger ? [.privateKeyUsage, .biometryCurrentSet] : [.privateKeyUsage]
  guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, flags, &error) else { throw error!.takeRetainedValue() }
  let key = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: access)
  let once = P256.KeyAgreement.PrivateKey(), pub = once.publicKey.x963Representation
  let shared = try once.sharedSecretFromKeyAgreement(with: key.publicKey)
  let box = try AES.GCM.seal(secret, using: cipherKey(shared, pub, key.publicKey.x963Representation))
  let blob = key.dataRepresentation
  return Data([1, UInt8(blob.count >> 8), UInt8(blob.count & 255)]) + blob + pub + box.combined!
}

private func unseal(_ sealed: Data, _ reason: String, quiet: Bool) throws -> Data {
  let d = [UInt8](sealed)
  guard d.count > 3, d[0] == 1 else { throw Failed.unreadable }
  let n = Int(d[1]) << 8 | Int(d[2])
  guard d.count > 3 + n + 65 else { throw Failed.unreadable }
  let context = LAContext()
  context.localizedReason = reason
  context.localizedFallbackTitle = ""
  context.interactionNotAllowed = quiet
  let key = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: Data(d[3 ..< 3 + n]), authenticationContext: context)
  let pub = Data(d[(3 + n) ..< (3 + n + 65)])
  let shared = try key.sharedSecretFromKeyAgreement(with: P256.KeyAgreement.PublicKey(x963Representation: pub))
  return try AES.GCM.open(AES.GCM.SealedBox(combined: Data(d[(3 + n + 65)...])), using: cipherKey(shared, pub, key.publicKey.x963Representation))
}

/** Why it didn't open: the user said no, Touch ID can't be used now, or this key is no good (fingers changed). */
private func why(_ e: Error) -> String {
  let n = e as NSError
  guard n.domain == LAError.errorDomain, let code = LAError.Code(rawValue: n.code) else { return "invalid" }
  switch code {
  case .userCancel, .appCancel, .systemCancel, .userFallback, .authenticationFailed: return "cancelled"
  case .biometryNotAvailable, .biometryNotEnrolled, .biometryLockout, .notInteractive, .passcodeNotSet: return "unavailable"
  default: return "invalid"
  }
}

// ---------- what Node calls

/** An open under way, off the main thread: it waits for the finger. */
private final class Opening {
  let sealed: Data, reason: String, quiet: Bool
  var deferred: OpaquePointer?, work: OpaquePointer?
  var out: Result<Data, Error> = .failure(Failed.unreadable)
  init(_ s: Data, _ r: String, _ q: Bool) { sealed = s; reason = r; quiet = q }
}

/** ready(finger): the Enclave is there, and with `finger` Touch ID can be used now. */
private let ready: Callback = { env, info in
  var finger = true, out: Value?
  _ = napi_get_value_bool(env, arguments(env, info, 1)[0], &finger)
  _ = napi_get_boolean(env, SecureEnclave.isAvailable && (!finger || LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)), &out)
  return out
}

/** seal(secret, finger): a Buffer. */
private let sealing: Callback = { env, info in
  let a = arguments(env, info, 2)
  var finger = true
  _ = napi_get_value_bool(env, a[1], &finger)
  var secret = bytes(env, a[0])
  defer { secret.resetBytes(in: 0 ..< secret.count) }
  do { return buffer(env, try seal(secret, finger: finger)) } catch { _ = napi_throw_error(env, nil, "the Secure Enclave didn't seal it: \(error.localizedDescription)"); return nil }
}

/** open(sealed, reason, quiet): a promise of the secret; `quiet` never asks for a finger. It fails with why()'s word. */
private let opening: Callback = { env, info in
  let a = arguments(env, info, 3)
  var length = 0, quiet = false
  _ = napi_get_value_string_utf8(env, a[1], nil, 0, &length)
  var chars = [CChar](repeating: 0, count: length + 1)
  _ = napi_get_value_string_utf8(env, a[1], &chars, length + 1, &length)
  _ = napi_get_value_bool(env, a[2], &quiet)
  let o = Opening(bytes(env, a[0]), String(cString: chars), quiet)
  var promise: Value?
  _ = napi_create_promise(env, &o.deferred, &promise)
  let held = Unmanaged.passRetained(o).toOpaque()
  _ = napi_create_async_work(env, nil, text(env, "vaultite.enclave"), { _, p in
    let o = Unmanaged<Opening>.fromOpaque(p!).takeUnretainedValue()
    o.out = Result { try unseal(o.sealed, o.reason, quiet: o.quiet) }
  }, { env, _, p in
    let o = Unmanaged<Opening>.fromOpaque(p!).takeRetainedValue()
    switch o.out {
    case .success(var d):
      _ = napi_resolve_deferred(env, o.deferred, buffer(env, d))
      d.resetBytes(in: 0 ..< d.count)
    case .failure(let e):
      var err: Value?
      _ = napi_create_error(env, nil, text(env, why(e)), &err)
      _ = napi_reject_deferred(env, o.deferred, err)
    }
    _ = napi_delete_async_work(env, o.work)
  }, held, &o.work)
  _ = napi_queue_async_work(env, o.work)
  return promise
}

@_cdecl("napi_register_module_v1")
public func register(_ env: OpaquePointer?, _ exports: OpaquePointer?) -> OpaquePointer? {
  for (name, fn) in [("ready", ready), ("seal", sealing), ("open", opening)] {
    var f: Value?
    _ = napi_create_function(env, name, name.utf8.count, fn, nil, &f)
    _ = napi_set_named_property(env, exports, name, f)
  }
  return exports
}
