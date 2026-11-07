# kdbx

kdbxweb, the KeePass (KDBX 3.1, 4.0 and 4.1) reader and writer by Antelle for KeeWeb (MIT license, `LICENSE` here),
vendored and changed. The npm package (2.1.1) was its last release, in 2021; this is ours now.

- Source: https://github.com/keeweb/kdbxweb
- Commit: 7601e45d2a437f35a7fa3d767164eab60bc05d42 (master, 2024-12-23): 2.1.1 plus the `Icons.DriveWindows` fix
  (38, not 39); its other commits since are lint, build and docs.
- Taken: 2026-11-07
- Tests: upstream's `test/` in `tools/test/kdbx/upstream`, its `resources/` in `tools/fixtures/kdbx`, run with ours
  by `node tools/test_kdbx.ts`.

## How it was brought in

`lib/*/*.ts` flattened into this folder (the browser engine imports nothing above itself), imports naming the `.ts`
file, and made erasable TypeScript for Node's type stripping: `type` imports and exports, the `ValueType` enum a const
object, `<T>x` casts `x as T`. Upstream's formatting is kept, so a file still diffs against its original; long doc
comments were cut to two lines (this repo's rule). The first commit adding this folder is upstream as is.

## What we changed, and why

Dependencies
- XML: `xml.ts`, a small tree, parser and serializer, in place of @xmldom/xmldom (several CVEs, GHSA-wh4c-j3r5-mjhp
  open upstream). It refuses a DTD outright, so no entity is expanded or fetched (XXE, billion laughs); elements nest
  at most 1000 deep; attributes are a Map (no prototype keys). On every fixture it reads the same tree xmldom did.
- GZip: Node's zlib in place of fflate, bounded: inflating stops at 1 GiB (`gzip.ts`), so a small file can't fill
  memory.
- Crypto: node:crypto for SHA-256/512, HMAC, AES-CBC, AES-KDF and randomness, in place of WebCrypto-or-Node branches.
  Electron's BoringSSL has no ChaCha20 or Salsa20, so `chacha20.ts` and `salsa20.ts` stay (tested against OpenSSL's
  ChaCha20); Argon2 is still the app's (`setArgon2Impl`, noble's in keepass.ts). Browser paths (DOMParser,
  `global.crypto`, atob) are gone: this runs in Node and Electron's main process only.

Hardening
- Hashes and MACs (header SHA-256 and HMAC, HMAC blocks, hashed blocks) are compared in constant time.
- KDBX 4's empty last HMAC block is verified, as KeePass does: upstream skipped it, so a file cut at a block boundary
  with a forged end block read as whole. KDBX 3's hashed blocks must be in order and end with a zero hash (KeePass).
- Reading past the data is an error (FileCorrupt), never a short read or a RangeError. Header fields are checked for
  length (cipher 16, master and transform seeds 32, IV 12 or 16, flags 4); a field the version doesn't have, or an
  unknown one, is skipped as KeePass and KeePassXC do, instead of throwing a TypeError.
- KDF parameters are bounded: Argon2 memory at most 1 GiB (`MaxArgon2Memory`: KeePassXC's default is 64 MiB; more is
  refused as Unsupported, not run), parallelism and iterations within Argon2's ranges, AES-KDF rounds a safe integer.
  AES-KDF yields between chunks so the main process never stalls.
- Base64 is decoded strictly (a bad character is FileCorrupt, as atob did; Buffer alone would skip it).
- Wiped after use: decrypted payloads, inflated XML bytes, protected attachments' plain bytes, derived keys (header
  HMAC key, block keys, the KDF input copy upstream left in `keyWithSeed.buffer.slice`), AES keys, node:crypto's
  digest Buffers, and the text buffer `ProtectedValue.getText` decoded.

Fixes
- Tabs in values are kept (upstream's control-character filter removed them; upstream PR 63).
- KDBX 4.1 custom data's and custom icons' LastModificationTime are written as binary dates, as KeePass requires
  (upstream issue 49, PR 62).
- A binary date past what a Date holds (KeePassDX writes some) reads as 9999-12-31, KeePass's latest, instead of
  failing the whole file (upstream issue 48).
- A carriage return in a value is written as `&#xD;`, so it reads back (xmldom wrote it raw and lost it); characters
  XML 1.0 can't carry are dropped when writing, as KeePass does.
- `createRandomKeyFile` no longer mixes in `Math.random`.
- `ProtectedValue.fromBinary` takes a Uint8Array without copying it, so the caller's plain bytes are masked in place
  as its doc says (upstream copied them and left them).

Kept as upstream: KDBX 3.1/4.0/4.1 read and write, AES and ChaCha20 ciphers, AES-KDF, Argon2d and Argon2id, key files
(1.0, 2.0, raw, hex, hashed), challenge-response, attachments, history, custom data and icons, merge and edit state.
Not supported, as upstream: the Twofish cipher (a KeePassXC option) and KeePass 1 (.kdb) files.

## Tests

Upstream's tests run as written through a small mocha and expect.js stand-in (`tools/test/kdbx/mocha.ts`), except:
the Web-Crypto and DOMParser variants (gone with those paths); reading past the end, which now throws; header tests'
seeds and IV, now the sizes that are checked; the compression-flag test's data (upstream's was truncated, passing only
by reading short); a test of `setArgon2Impl` unset. `tools/test/kdbx/ours.ts` adds round trips of every fixture and
format, wrong passwords, every truncation and bit flip of a file, hostile headers, zip bombs, hostile XML, and
KeePassXC reading what we write (and the other way round) where `keepassxc-cli` is installed.
