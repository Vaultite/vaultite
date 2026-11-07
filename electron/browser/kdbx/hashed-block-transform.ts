import { BinaryStream } from './binary-stream.ts';
import * as CryptoEngine from './crypto-engine.ts';
import { KdbxError } from './kdbx-error.ts';
import { arrayBufferEquals } from './byte-utils.ts';
import { ErrorCodes } from './consts.ts';

const BlockSize = 1024 * 1024;

export async function decrypt(data: ArrayBuffer): Promise<ArrayBuffer> {
    const stm = new BinaryStream(data);
    const buffers: ArrayBuffer[] = [];
    let totalLength = 0;
    // (as KeePass reads them: blocks in order, and the empty last one with a zero hash)
    for (let expectedIndex = 0; ; expectedIndex++) {
        const blockIndex = stm.getUint32(true);
        const blockHash = stm.readBytes(32);
        const blockLength = stm.getUint32(true);
        if (blockIndex !== expectedIndex) {
            throw new KdbxError(ErrorCodes.FileCorrupt, 'bad hash block index');
        }
        if (!blockLength) {
            if (new Uint8Array(blockHash).some((b) => b !== 0)) {
                throw new KdbxError(ErrorCodes.FileCorrupt, 'invalid hash block');
            }
            break;
        }
        const blockData = stm.readBytes(blockLength);
        const calculatedHash = await CryptoEngine.sha256(blockData);
        if (!arrayBufferEquals(calculatedHash, blockHash)) {
            throw new KdbxError(ErrorCodes.FileCorrupt, 'invalid hash block');
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

export function encrypt(data: ArrayBuffer): Promise<ArrayBuffer> {
    return Promise.resolve().then(() => {
        let bytesLeft = data.byteLength;
        let currentOffset = 0,
            blockIndex = 0,
            totalLength = 0;
        const buffers: ArrayBuffer[] = [];

        const next = (): Promise<ArrayBuffer> => {
            if (bytesLeft > 0) {
                const blockLength = Math.min(BlockSize, bytesLeft);
                bytesLeft -= blockLength;

                const blockData = data.slice(currentOffset, currentOffset + blockLength);
                return CryptoEngine.sha256(blockData).then((blockHash) => {
                    const blockBuffer = new ArrayBuffer(4 + 32 + 4);
                    const stm = new BinaryStream(blockBuffer);
                    stm.setUint32(blockIndex, true);
                    stm.writeBytes(blockHash);
                    stm.setUint32(blockLength, true);

                    buffers.push(blockBuffer);
                    totalLength += blockBuffer.byteLength;
                    buffers.push(blockData);
                    totalLength += blockData.byteLength;

                    blockIndex++;
                    currentOffset += blockLength;

                    return next();
                });
            } else {
                const endBlockData = new ArrayBuffer(4 + 32 + 4);
                const view = new DataView(endBlockData);
                view.setUint32(0, blockIndex, true);
                buffers.push(endBlockData);
                totalLength += endBlockData.byteLength;

                const ret = new Uint8Array(totalLength);
                let offset = 0;
                for (let i = 0; i < buffers.length; i++) {
                    ret.set(new Uint8Array(buffers[i]), offset);
                    offset += buffers[i].byteLength;
                }
                return Promise.resolve(ret.buffer);
            }
        };
        return next();
    });
}
