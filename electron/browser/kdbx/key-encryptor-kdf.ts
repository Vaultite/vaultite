import * as CryptoEngine from './crypto-engine.ts';
import * as KeyEncryptorAes from './key-encryptor-aes.ts';
import { VarDictionary, type VarDictionaryAnyValue } from './var-dictionary.ts';
import { KdbxError } from './kdbx-error.ts';
import { ErrorCodes, KdfId } from './consts.ts';
import { bytesToBase64, zeroBuffer } from './byte-utils.ts';
import { type Argon2Type } from './crypto-engine.ts';
import { Int64 } from './int64.ts';

// A file asking for more Argon2 memory is refused, not run: KeePassXC's default is 64 MiB, and a hostile file could
// otherwise ask for all of the machine's.
export const MaxArgon2Memory = 1024 * 1024 * 1024;

export function encrypt(key: ArrayBuffer, kdfParams: VarDictionary): Promise<ArrayBuffer> {
    const uuid = kdfParams.get('$UUID');
    if (!uuid || !(uuid instanceof ArrayBuffer)) {
        return Promise.reject(new KdbxError(ErrorCodes.FileCorrupt, 'no kdf uuid'));
    }
    const kdfUuid = bytesToBase64(uuid);
    switch (kdfUuid) {
        case KdfId.Argon2d:
            return encryptArgon2(key, kdfParams, CryptoEngine.Argon2TypeArgon2d);
        case KdfId.Argon2id:
            return encryptArgon2(key, kdfParams, CryptoEngine.Argon2TypeArgon2id);
        case KdfId.Aes:
            return encryptAes(key, kdfParams);
        default:
            return Promise.reject(new KdbxError(ErrorCodes.Unsupported, 'bad kdf'));
    }
}

function encryptArgon2(
    key: ArrayBuffer,
    kdfParams: VarDictionary,
    argon2type: Argon2Type
): Promise<ArrayBuffer> {
    const salt = kdfParams.get('S');
    if (!(salt instanceof ArrayBuffer) || salt.byteLength !== 32) {
        return Promise.reject(new KdbxError(ErrorCodes.FileCorrupt, 'bad argon2 salt'));
    }

    const parallelism = toNumber(kdfParams.get('P'));
    if (typeof parallelism !== 'number' || parallelism < 1 || parallelism > 0xffffff) {
        return Promise.reject(new KdbxError(ErrorCodes.FileCorrupt, 'bad argon2 parallelism'));
    }

    const iterations = toNumber(kdfParams.get('I'));
    if (typeof iterations !== 'number' || iterations < 1 || iterations > 0xffffffff) {
        return Promise.reject(new KdbxError(ErrorCodes.FileCorrupt, 'bad argon2 iterations'));
    }

    const memory = toNumber(kdfParams.get('M'));
    if (typeof memory !== 'number' || memory < 1 || memory % 1024 !== 0) {
        return Promise.reject(new KdbxError(ErrorCodes.FileCorrupt, 'bad argon2 memory'));
    }
    if (memory > MaxArgon2Memory) {
        return Promise.reject(
            new KdbxError(ErrorCodes.Unsupported, `argon2 memory over ${MaxArgon2Memory} bytes`)
        );
    }

    const version = kdfParams.get('V');
    if (version !== 0x13 && version !== 0x10) {
        return Promise.reject(new KdbxError(ErrorCodes.FileCorrupt, 'bad argon2 version'));
    }

    const secretKey = kdfParams.get('K');
    if (secretKey) {
        return Promise.reject(new KdbxError(ErrorCodes.Unsupported, 'argon2 secret key'));
    }

    const assocData = kdfParams.get('A');
    if (assocData) {
        return Promise.reject(new KdbxError(ErrorCodes.Unsupported, 'argon2 assoc data'));
    }

    return CryptoEngine.argon2(
        key,
        salt,
        memory / 1024,
        iterations,
        32,
        parallelism,
        argon2type,
        version
    );
}

function encryptAes(key: ArrayBuffer, kdfParams: VarDictionary) {
    const salt = kdfParams.get('S');
    if (!(salt instanceof ArrayBuffer) || salt.byteLength !== 32) {
        return Promise.reject(new KdbxError(ErrorCodes.FileCorrupt, 'bad aes salt'));
    }

    const rounds = toNumber(kdfParams.get('R'));
    if (typeof rounds !== 'number' || rounds < 1) {
        return Promise.reject(new KdbxError(ErrorCodes.FileCorrupt, 'bad aes rounds'));
    }

    return KeyEncryptorAes.encrypt(new Uint8Array(key), new Uint8Array(salt), rounds).then(
        (key) => {
            return CryptoEngine.sha256(key).then((hash) => {
                zeroBuffer(key);
                return hash;
            });
        }
    );
}

function toNumber(number: VarDictionaryAnyValue): number | undefined {
    if (typeof number === 'number') {
        return number;
    } else if (number instanceof Int64) {
        return number.hi < 0x200000 ? number.value : undefined;
    }
    return undefined;
}
