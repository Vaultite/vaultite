import { arrayToBuffer, base64ToBytes, bytesToBase64 } from './byte-utils.ts';
import { ErrorCodes } from './consts.ts';
import { KdbxError } from './kdbx-error.ts';
import * as CryptoEngine from './crypto-engine.ts';

const UuidLength = 16;
const EmptyUuidStr = 'AAAAAAAAAAAAAAAAAAAAAA==';

export class KdbxUuid {
    readonly id: string;
    readonly empty: boolean;

    constructor(ab?: ArrayBuffer | string) {
        if (ab === undefined) {
            ab = new ArrayBuffer(UuidLength);
        } else if (typeof ab === 'string') {
            ab = arrayToBuffer(base64ToBytes(ab));
        }
        if (ab.byteLength !== UuidLength) {
            throw new KdbxError(ErrorCodes.FileCorrupt, `bad UUID length: ${ab.byteLength}`);
        }
        this.id = bytesToBase64(ab);
        this.empty = this.id === EmptyUuidStr;
    }

    equals(other: KdbxUuid | string | null | undefined): boolean {
        return (other && other.toString() === this.toString()) || false;
    }

    get bytes(): ArrayBuffer {
        return this.toBytes();
    }

    static random(): KdbxUuid {
        return new KdbxUuid(arrayToBuffer(CryptoEngine.random(UuidLength)));
    }

    toString(): string {
        return this.id;
    }

    valueOf(): string {
        return this.id;
    }

    toBytes(): ArrayBuffer {
        return arrayToBuffer(base64ToBytes(this.id));
    }
}
