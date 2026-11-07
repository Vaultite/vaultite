// GZip for KDBX payloads and attachments, by Node's zlib (in place of fflate), bounded so a small hostile file can't
// inflate into all of memory.
import zlib from 'node:zlib';
import { ErrorCodes } from './consts.ts';
import { KdbxError } from './kdbx-error.ts';

// Past any real database (V8 can't make a string of its XML much over 512 MB anyway).
export const MaxInflatedSize = 1024 * 1024 * 1024;

export function gunzip(data: Uint8Array, maxSize = MaxInflatedSize): Uint8Array {
    try {
        return own(zlib.gunzipSync(data, { maxOutputLength: maxSize }));
    } catch (e) {
        const tooLarge = (e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE';
        throw new KdbxError(
            ErrorCodes.FileCorrupt,
            tooLarge ? `decompressed data over ${maxSize} bytes` : 'bad gzip data'
        );
    }
}

export function gzip(data: Uint8Array): Uint8Array {
    return own(zlib.gzipSync(data));
}

/** Its bytes in an ArrayBuffer of their own, the Buffer zlib made (maybe a slice of a shared pool) wiped. */
function own(buffer: Buffer): Uint8Array {
    const out = new Uint8Array(buffer.byteLength);
    out.set(buffer);
    buffer.fill(0);
    return out;
}
