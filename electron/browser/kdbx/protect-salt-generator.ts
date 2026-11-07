import { Salsa20 } from './salsa20.ts';
import { ChaCha20 } from './chacha20.ts';
import { arrayToBuffer } from './byte-utils.ts';
import { CrsAlgorithm, ErrorCodes } from './consts.ts';
import { KdbxError } from './kdbx-error.ts';
import * as CryptoEngine from './crypto-engine.ts';

const SalsaNonce = new Uint8Array([0xe8, 0x30, 0x09, 0x4b, 0x97, 0x20, 0x5d, 0x2a]);

/** Protect information used for decrypt and encrypt protected data fields. */
export class ProtectSaltGenerator {
    private _algo: Salsa20 | ChaCha20;

    constructor(algo: Salsa20 | ChaCha20) {
        this._algo = algo;
    }

    getSalt(len: number): ArrayBuffer {
        return arrayToBuffer(this._algo.getBytes(len));
    }

    static create(
        key: ArrayBuffer | Uint8Array,
        crsAlgorithm: number
    ): Promise<ProtectSaltGenerator> {
        switch (crsAlgorithm) {
            case CrsAlgorithm.Salsa20:
                return CryptoEngine.sha256(arrayToBuffer(key)).then((hash) => {
                    const key = new Uint8Array(hash);
                    const algo = new Salsa20(key, SalsaNonce);
                    return new ProtectSaltGenerator(algo);
                });
            case CrsAlgorithm.ChaCha20:
                return CryptoEngine.sha512(arrayToBuffer(key)).then((hash) => {
                    const key = new Uint8Array(hash, 0, 32);
                    const nonce = new Uint8Array(hash, 32, 12);
                    const algo = new ChaCha20(key, nonce);
                    return new ProtectSaltGenerator(algo);
                });
            default:
                return Promise.reject(new KdbxError(ErrorCodes.Unsupported, 'crsAlgorithm'));
        }
    }
}
