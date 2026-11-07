import { Int64 } from './int64.ts';
import { arrayBufferEquals, arrayToBuffer, zeroBuffer } from './byte-utils.ts';
import * as CryptoEngine from './crypto-engine.ts';
import { BinaryStream } from './binary-stream.ts';
import { KdbxError } from './kdbx-error.ts';
import { ErrorCodes } from './consts.ts';

const BlockSize = 1024 * 1024;

export function getHmacKey(key: ArrayBuffer, blockIndex: Int64): Promise<ArrayBuffer> {
    const shaSrc = new Uint8Array(8 + key.byteLength);
    shaSrc.set(new Uint8Array(key), 8);
    const view = new DataView(shaSrc.buffer);
    view.setUint32(0, blockIndex.lo, true);
    view.setUint32(4, blockIndex.hi, true);
    return CryptoEngine.sha512(arrayToBuffer(shaSrc)).then((sha) => {
        zeroBuffer(shaSrc);
        return sha;
    });
}

function getBlockHmac(
    key: ArrayBuffer,
    blockIndex: number,
    blockLength: number,
    blockData: ArrayBuffer
): Promise<ArrayBuffer> {
    return getHmacKey(key, new Int64(blockIndex)).then((blockKey) => {
        const blockDataForHash = new Uint8Array(blockData.byteLength + 4 + 8);
        const blockDataForHashView = new DataView(blockDataForHash.buffer);
        blockDataForHash.set(new Uint8Array(blockData), 4 + 8);
        blockDataForHashView.setInt32(0, blockIndex, true);
        blockDataForHashView.setInt32(8, blockLength, true);
        return CryptoEngine.hmacSha256(blockKey, blockDataForHash).finally(() => zeroBuffer(blockKey));
    });
}

export async function decrypt(data: ArrayBuffer, key: ArrayBuffer): Promise<ArrayBuffer> {
    const stm = new BinaryStream(data);
    const buffers: ArrayBuffer[] = [];
    let totalLength = 0;
    for (let blockIndex = 0; ; blockIndex++) {
        const blockHash = stm.readBytes(32);
        const blockLength = stm.getUint32(true);
        const blockData = stm.readBytes(blockLength);
        // (the empty last block is checked too, as KeePass does: else a file cut at a block's end would pass)
        const calculatedBlockHash = await getBlockHmac(key, blockIndex, blockLength, blockData);
        if (!arrayBufferEquals(calculatedBlockHash, blockHash)) {
            throw new KdbxError(ErrorCodes.FileCorrupt, 'invalid hash block');
        }
        if (!blockLength) {
            break;
        }
        buffers.push(blockData);
        totalLength += blockLength;
    }
    const ret = new Uint8Array(totalLength);
    let offset = 0;
    for (const buffer of buffers) {
        ret.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
    }
    return ret.buffer;
}

export function encrypt(data: ArrayBuffer, key: ArrayBuffer): Promise<ArrayBuffer> {
    return Promise.resolve().then(() => {
        let bytesLeft = data.byteLength;
        let currentOffset = 0,
            blockIndex = 0,
            totalLength = 0;
        const buffers: ArrayBuffer[] = [];

        const next = (): Promise<ArrayBuffer> => {
            const blockLength = Math.min(BlockSize, bytesLeft);
            bytesLeft -= blockLength;

            const blockData = data.slice(currentOffset, currentOffset + blockLength);
            return getBlockHmac(key, blockIndex, blockLength, blockData).then((blockHash) => {
                const blockBuffer = new ArrayBuffer(32 + 4);
                const stm = new BinaryStream(blockBuffer);
                stm.writeBytes(blockHash);
                stm.setUint32(blockLength, true);

                buffers.push(blockBuffer);
                totalLength += blockBuffer.byteLength;

                if (blockData.byteLength > 0) {
                    buffers.push(blockData);
                    totalLength += blockData.byteLength;
                    blockIndex++;
                    currentOffset += blockLength;
                    return next();
                } else {
                    const ret = new Uint8Array(totalLength);
                    let offset = 0;
                    for (let i = 0; i < buffers.length; i++) {
                        ret.set(new Uint8Array(buffers[i]), offset);
                        offset += buffers[i].byteLength;
                    }
                    return ret.buffer;
                }
            });
        };
        return next();
    });
}
