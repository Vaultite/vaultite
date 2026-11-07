import * as CryptoEngine from './crypto-engine.ts';
import { ErrorCodes } from './consts.ts';
import { KdbxError } from './kdbx-error.ts';
import { zeroBuffer } from './byte-utils.ts';

const maxRoundsPerIteration = 65536;
const aesBlockSize = 16;
const credentialSize = 32;

// AES-KDF is `rounds` AES-ECB encryptions of each half of the key: CBC over zero blocks is the same chain (each block
// is the previous one encrypted), done in chunks with a yield between so the main process never stalls.
export async function encrypt(
    credentials: Uint8Array,
    key: Uint8Array | ArrayBuffer,
    rounds: number
): Promise<Uint8Array> {
    if (!Number.isSafeInteger(rounds) || rounds < 0) {
        throw new KdbxError(ErrorCodes.Unsupported, 'bad AES-KDF rounds');
    }
    const algo = CryptoEngine.createAesCbc();
    await algo.importKey(key);
    const zeros = new Uint8Array(aesBlockSize * Math.min(Math.max(rounds, 1), maxRoundsPerIteration));
    const res = new Uint8Array(credentialSize);
    try {
        for (let idx = 0; idx < credentialSize; idx += aesBlockSize) {
            let block: Uint8Array = credentials.slice(idx, idx + aesBlockSize);
            for (let left = rounds; left > 0; ) {
                const now = Math.min(left, maxRoundsPerIteration);
                left -= now;
                const out = algo.encryptBlocksSync(zeros.subarray(0, now * aesBlockSize), block);
                zeroBuffer(block);
                block = new Uint8Array(out.subarray(out.byteLength - aesBlockSize));
                out.fill(0);
                if (left > 0) {
                    await new Promise((resolve) => setImmediate(resolve));
                }
            }
            res.set(block, idx);
            zeroBuffer(block);
        }
    } finally {
        algo.dispose();
    }
    return res;
}
