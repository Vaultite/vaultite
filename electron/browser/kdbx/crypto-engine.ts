// Hashes, HMAC, AES and randomness from node:crypto (Electron's main process too: BoringSSL there). It has no ChaCha20
// nor Argon2, so ChaCha20 is chacha20.ts and Argon2 is whatever the app sets (setArgon2Impl).
import nodeCrypto from 'node:crypto';
import { KdbxError } from './kdbx-error.ts';
import { ErrorCodes } from './consts.ts';
import { arrayToBuffer, zeroBuffer } from './byte-utils.ts';
import { ChaCha20 } from './chacha20.ts';

type Bytes = ArrayBuffer | Uint8Array;

const bytes = (data: Bytes) => (data instanceof ArrayBuffer ? new Uint8Array(data) : data);

/** A digest's bytes copied out of the Buffer node:crypto made (maybe a slice of a shared pool), which is wiped. */
function own(buffer: Buffer): ArrayBuffer {
    const out = new Uint8Array(buffer.byteLength);
    out.set(buffer);
    buffer.fill(0);
    return out.buffer;
}

export async function sha256(data: Bytes): Promise<ArrayBuffer> {
    return own(nodeCrypto.createHash('sha256').update(bytes(data)).digest());
}

export async function sha512(data: Bytes): Promise<ArrayBuffer> {
    return own(nodeCrypto.createHash('sha512').update(bytes(data)).digest());
}

export async function hmacSha256(key: Bytes, data: Bytes): Promise<ArrayBuffer> {
    return own(nodeCrypto.createHmac('sha256', bytes(key)).update(bytes(data)).digest());
}

export class AesCbc {
    private _key: Uint8Array | undefined;

    private get key(): Uint8Array {
        if (!this._key) {
            throw new KdbxError(ErrorCodes.InvalidState, 'no key');
        }
        return this._key;
    }

    async importKey(key: Bytes): Promise<void> {
        if (key.byteLength !== 32) {
            throw new KdbxError(ErrorCodes.InvalidArg, 'bad AES key length');
        }
        this._key = new Uint8Array(key.byteLength);
        this._key.set(bytes(key));
    }

    async encrypt(data: Bytes, iv: Bytes): Promise<ArrayBuffer> {
        const cipher = nodeCrypto.createCipheriv('aes-256-cbc', this.key, checkIv(iv));
        return concat(cipher.update(bytes(data)), cipher.final());
    }

    /** Encrypts without padding: `data` is whole blocks, and so is what comes out. */
    encryptBlocksSync(data: Uint8Array, iv: Bytes): Buffer {
        const cipher = nodeCrypto.createCipheriv('aes-256-cbc', this.key, checkIv(iv));
        cipher.setAutoPadding(false);
        return Buffer.concat([cipher.update(data), cipher.final()]);
    }

    async decrypt(data: Bytes, iv: Bytes): Promise<ArrayBuffer> {
        const decipher = nodeCrypto.createDecipheriv('aes-256-cbc', this.key, checkIv(iv));
        try {
            return concat(decipher.update(bytes(data)), decipher.final());
        } catch {
            throw new KdbxError(ErrorCodes.InvalidKey, 'invalid key');
        }
    }

    /** Wipes the key. */
    dispose(): void {
        if (this._key) {
            zeroBuffer(this._key);
            this._key = undefined;
        }
    }
}

function checkIv(iv: Bytes): Uint8Array {
    if (iv.byteLength !== 16) {
        throw new KdbxError(ErrorCodes.FileCorrupt, 'bad AES IV length');
    }
    return bytes(iv);
}

function concat(a: Buffer, b: Buffer): ArrayBuffer {
    const out = new Uint8Array(a.byteLength + b.byteLength);
    out.set(a);
    out.set(b, a.byteLength);
    a.fill(0);
    b.fill(0);
    return out.buffer;
}

export function createAesCbc(): AesCbc {
    return new AesCbc();
}

export function random(len: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(len);
    nodeCrypto.randomFillSync(out);
    return out;
}

export async function chacha20(data: Bytes, key: Bytes, iv: Bytes): Promise<ArrayBuffer> {
    // (12 bytes is KDBX 4's nonce; kdbxweb wrote KDBX 3.1 files with a 16-byte IV, of which ChaCha20 takes 8)
    if (key.byteLength !== 32 || ![8, 12, 16].includes(iv.byteLength)) {
        throw new KdbxError(ErrorCodes.FileCorrupt, 'bad ChaCha20 key or nonce length');
    }
    const algo = new ChaCha20(bytes(key), bytes(iv));
    return arrayToBuffer(algo.encrypt(bytes(data)));
}

export const Argon2TypeArgon2d = 0;
export const Argon2TypeArgon2id = 2;

export type Argon2Type = typeof Argon2TypeArgon2d | typeof Argon2TypeArgon2id;
export type Argon2Version = 0x10 | 0x13;

export type Argon2Fn = (
    password: ArrayBuffer,
    salt: ArrayBuffer,
    memory: number,
    iterations: number,
    length: number,
    parallelism: number,
    type: Argon2Type,
    version: Argon2Version
) => Promise<ArrayBuffer | Uint8Array>;

let argon2impl: Argon2Fn | undefined;

export function argon2(
    password: ArrayBuffer,
    salt: ArrayBuffer,
    memory: number,
    iterations: number,
    length: number,
    parallelism: number,
    type: Argon2Type,
    version: Argon2Version
): Promise<ArrayBuffer> {
    if (argon2impl) {
        return argon2impl(
            password,
            salt,
            memory,
            iterations,
            length,
            parallelism,
            type,
            version
        ).then(arrayToBuffer);
    }
    return Promise.reject(new KdbxError(ErrorCodes.NotImplemented, 'argon2 not implemented'));
}

export function setArgon2Impl(impl: Argon2Fn | undefined): void {
    argon2impl = impl;
}
