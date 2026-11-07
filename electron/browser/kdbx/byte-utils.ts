import { timingSafeEqual } from 'node:crypto';
import { ErrorCodes } from './consts.ts';
import { KdbxError } from './kdbx-error.ts';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type ArrayBufferOrArray = ArrayBuffer | Uint8Array;

const view = (arr: ArrayBufferOrArray) => (arr instanceof ArrayBuffer ? new Uint8Array(arr) : arr);

/** Whether two buffers hold the same bytes, in time that doesn't depend on where they differ (hashes, MACs). */
export function arrayBufferEquals(ab1: ArrayBufferOrArray, ab2: ArrayBufferOrArray): boolean {
    if (ab1.byteLength !== ab2.byteLength) {
        return false;
    }
    return timingSafeEqual(view(ab1), view(ab2));
}

export function bytesToString(arr: ArrayBufferOrArray): string {
    return textDecoder.decode(view(arr));
}

export function stringToBytes(str: string): Uint8Array {
    return textEncoder.encode(str);
}

// (as strict as atob, which upstream used: Buffer alone would skip bad characters and read a damaged value)
const Base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;

export function base64ToBytes(str: string): Uint8Array {
    const clean = str.replace(/[\t\n\f\r ]+/g, '');
    if (!Base64Regex.test(clean) || clean.length % 4 === 1) {
        throw new KdbxError(ErrorCodes.FileCorrupt, 'bad base64');
    }
    const buffer = Buffer.from(clean, 'base64');
    const bytes = new Uint8Array(buffer.byteLength);
    bytes.set(buffer);
    buffer.fill(0);
    return bytes;
}

export function bytesToBase64(arr: ArrayBufferOrArray): string {
    const bytes = view(arr);
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

export function hexToBytes(hex: string): Uint8Array {
    const arr = new Uint8Array(Math.ceil(hex.length / 2));
    for (let i = 0; i < arr.length; i++) {
        arr[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return arr;
}

export function bytesToHex(arr: ArrayBufferOrArray): string {
    const bytes = view(arr);
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex');
}

/** The bytes as an ArrayBuffer of their own: `arr`'s when it's all of it, else a copy. */
export function arrayToBuffer(arr: ArrayBufferOrArray): ArrayBuffer {
    if (arr instanceof ArrayBuffer) {
        return arr;
    }
    const ab = arr.buffer as ArrayBuffer;
    if (arr.byteOffset === 0 && arr.byteLength === ab.byteLength) {
        return ab;
    }
    return ab.slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
}

export function zeroBuffer(arr: ArrayBufferOrArray): void {
    view(arr).fill(0);
}
