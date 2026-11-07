import { KdbxError } from './kdbx-error.ts';
import { ErrorCodes } from './consts.ts';
import * as XmlNames from './xml-names.ts';
import { arrayToBuffer, base64ToBytes, bytesToBase64 } from './byte-utils.ts';
import { gunzip } from './gzip.ts';
import { Int64 } from './int64.ts';
import { KdbxUuid } from './kdbx-uuid.ts';
import { ProtectedValue } from './protected-value.ts';
import type { ProtectSaltGenerator } from './protect-salt-generator.ts';
import { KdbxBinaries, type KdbxBinaryOrRef } from './kdbx-binaries.ts';
import {
    PROCESSING_INSTRUCTION_NODE,
    TEXT_NODE,
    parseXml,
    serializeXml,
    type XmlDocument,
    type XmlNode
} from './xml.ts';

const DateRegex = /\.\d\d\d/;
const EpochSeconds = 62135596800;
// .NET's DateTime.MaxValue (9999-12-31T23:59:59Z), the latest date KeePass itself can hold
const MaxDateSeconds = 315537897599;
const TagsSplitRegex = /\s*[;,:]\s*/;

export function parse(xml: string): XmlDocument {
    // (characters XML 1.0 forbids, which some writers leave in: a tab, line feed and carriage return are allowed)
    // eslint-disable-next-line no-control-regex
    xml = xml.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');
    return parseXml(xml);
}

export function serialize(doc: XmlNode, prettyPrint = false): string {
    if (prettyPrint) {
        prettyPrintXmlNode(doc, 0);
    }
    let xml = serializeXml(doc);
    if (prettyPrint && xml.startsWith('<?')) {
        xml = xml.replace(/^(<\?.*?\?>)</, '$1\n<');
    }
    return xml;
}

function prettyPrintXmlNode(node: XmlNode, indentationLevel: number): void {
    const numChildNodes = node.childNodes.length;

    if (numChildNodes === 0) {
        return;
    }

    const formatStr = '\n' + '    '.repeat(indentationLevel);
    const prevFormatStr = indentationLevel > 0 ? '\n' + '    '.repeat(indentationLevel - 1) : '';
    const doc = node.ownerDocument || (node as XmlDocument);

    const childNodes = node.childNodes.filter(
        (c) => c.nodeType !== TEXT_NODE && c.nodeType !== PROCESSING_INSTRUCTION_NODE
    );

    for (let j = 0; j < childNodes.length; j++) {
        const childNode = childNodes[j];

        const isFirstDocumentNode = indentationLevel === 0 && j === 0;
        if (!isFirstDocumentNode) {
            node.insertBefore(doc.createTextNode(formatStr), childNode);
        }

        if (!childNode.nextSibling && indentationLevel > 0) {
            node.appendChild(doc.createTextNode(prevFormatStr));
        }

        prettyPrintXmlNode(childNode, indentationLevel + 1);
    }
}

export function create(rootNode: string): XmlDocument {
    return parse('<?xml version="1.0" encoding="utf-8" standalone="yes"?><' + rootNode + '/>');
}

export function getChildNode(node: XmlNode | null, tagName: string): XmlNode | null;
export function getChildNode(node: XmlNode | null, tagName: string, errorMsgIfAbsent: string): XmlNode;
export function getChildNode(
    node: XmlNode | null,
    tagName: string,
    errorMsgIfAbsent?: string
): XmlNode | null {
    if (node && node.childNodes) {
        for (let i = 0, cn = node.childNodes, len = cn.length; i < len; i++) {
            if (cn[i].tagName === tagName) {
                return cn[i];
            }
        }
    }
    if (errorMsgIfAbsent) {
        throw new KdbxError(ErrorCodes.FileCorrupt, errorMsgIfAbsent);
    } else {
        return null;
    }
}

export function addChildNode(node: XmlNode, tagName: string): XmlNode {
    return node.appendChild((node.ownerDocument || (node as XmlDocument)).createElement(tagName));
}

export function getText(node: XmlNode | null): string | undefined {
    if (!node?.childNodes) {
        return undefined;
    }
    return node.protectedValue ? node.protectedValue.getText() : (node.textContent ?? undefined);
}

export function setText(node: XmlNode, text: string | undefined): void {
    node.textContent = text || '';
}

export function getTags(node: XmlNode): string[] {
    const text = getText(node);
    if (!text) {
        return [];
    }
    return text
        .split(TagsSplitRegex)
        .map((t) => t.trim())
        .filter((s) => s);
}

export function setTags(node: XmlNode, tags: string[]): void {
    setText(node, tags.join(', '));
}

export function getBytes(node: XmlNode): ArrayBuffer | undefined {
    const text = getText(node);
    return text ? arrayToBuffer(base64ToBytes(text)) : undefined;
}

export function setBytes(node: XmlNode, bytes: ArrayBuffer | Uint8Array | string | undefined): void {
    if (typeof bytes === 'string') {
        bytes = base64ToBytes(bytes);
    }
    setText(node, bytes ? bytesToBase64(arrayToBuffer(bytes)) : undefined);
}

export function getDate(node: XmlNode): Date | undefined {
    const text = getText(node);
    if (!text) {
        return undefined;
    }
    if (text.indexOf(':') > 0) {
        return new Date(text);
    }
    const bytes = new DataView(arrayToBuffer(base64ToBytes(text)));
    if (bytes.byteLength < 8) {
        throw new KdbxError(ErrorCodes.FileCorrupt, `bad date: ${text}`);
    }
    // (some writers put far-off dates, past what a Date holds: read as the latest KeePass can, not an error)
    const lo = bytes.getUint32(0, true), hi = bytes.getUint32(4, true);
    const secondsFrom00 = hi >= 0x200000 ? MaxDateSeconds : Math.min(new Int64(lo, hi).value, MaxDateSeconds);
    return new Date((secondsFrom00 - EpochSeconds) * 1000);
}

export function setDate(node: XmlNode, date: Date | undefined, binary = false): void {
    if (date) {
        if (binary) {
            const secondsFrom00 = Math.floor(date.getTime() / 1000) + EpochSeconds;
            const bytes = new DataView(new ArrayBuffer(8));
            const val64 = Int64.from(secondsFrom00);
            bytes.setUint32(0, val64.lo, true);
            bytes.setUint32(4, val64.hi, true);
            setText(node, bytesToBase64(bytes.buffer));
        } else {
            setText(node, date.toISOString().replace(DateRegex, ''));
        }
    } else {
        setText(node, '');
    }
}

export function getNumber(node: XmlNode): number | undefined {
    const text = getText(node);
    return text ? +text : undefined;
}

export function setNumber(node: XmlNode, number: number | undefined): void {
    setText(node, typeof number === 'number' && !isNaN(number) ? number.toString() : undefined);
}

export function getBoolean(node: XmlNode): boolean | null | undefined {
    const text = getText(node);
    return text ? strToBoolean(text) : undefined;
}

export function setBoolean(node: XmlNode, boolean: boolean | null | undefined): void {
    setText(
        node,
        boolean === undefined ? '' : boolean === null ? 'null' : boolean ? 'True' : 'False'
    );
}

export function strToBoolean(str: string | null | undefined): boolean | null | undefined {
    switch (str?.toLowerCase()) {
        case 'true':
            return true;
        case 'false':
            return false;
        case 'null':
            return null;
    }
    return undefined;
}

export function getUuid(node: XmlNode): KdbxUuid | undefined {
    const bytes = getBytes(node);
    return bytes ? new KdbxUuid(bytes) : undefined;
}

export function setUuid(
    node: XmlNode,
    uuid: KdbxUuid | ArrayBuffer | Uint8Array | string | undefined
): void {
    const uuidBytes = uuid instanceof KdbxUuid ? uuid.toBytes() : uuid;
    setBytes(node, uuidBytes);
}

export function getProtectedText(node: XmlNode): ProtectedValue | string | undefined {
    return (node.protectedValue || node.textContent) ?? undefined;
}

export function setProtectedText(node: XmlNode, text: ProtectedValue | string): void {
    if (text instanceof ProtectedValue) {
        node.protectedValue = text;
        node.setAttribute(XmlNames.Attr.Protected, 'True');
    } else {
        setText(node, text);
    }
}

export function getProtectedBinary(node: XmlNode): KdbxBinaryOrRef | undefined {
    if (node.protectedValue) {
        return node.protectedValue;
    }
    const text = node.textContent;
    const ref = node.getAttribute(XmlNames.Attr.Ref);
    if (ref) {
        return { ref };
    }
    if (!text) {
        return undefined;
    }
    const compressed = strToBoolean(node.getAttribute(XmlNames.Attr.Compressed));
    let bytes = base64ToBytes(text);
    if (compressed) {
        bytes = gunzip(bytes);
    }
    return arrayToBuffer(bytes);
}

export function setProtectedBinary(node: XmlNode, binary: KdbxBinaryOrRef): void {
    if (binary instanceof ProtectedValue) {
        node.protectedValue = binary;
        node.setAttribute(XmlNames.Attr.Protected, 'True');
    } else if (KdbxBinaries.isKdbxBinaryRef(binary)) {
        node.setAttribute(XmlNames.Attr.Ref, binary.ref);
    } else {
        setBytes(node, binary);
    }
}

export function traverse(node: XmlNode, callback: (node: XmlNode) => void): void {
    callback(node);
    for (let i = 0, cn = node.childNodes, len = cn.length; i < len; i++) {
        const childNode = cn[i];
        if (childNode.tagName) {
            traverse(childNode, callback);
        }
    }
}

export function setProtectedValues(node: XmlNode, protectSaltGenerator: ProtectSaltGenerator): void {
    traverse(node, (node) => {
        if (strToBoolean(node.getAttribute(XmlNames.Attr.Protected))) {
            try {
                const value = arrayToBuffer(base64ToBytes(node.textContent || ''));
                if (value.byteLength) {
                    const salt = protectSaltGenerator.getSalt(value.byteLength);
                    node.protectedValue = new ProtectedValue(value, salt);
                }
            } catch (e) {
                throw new KdbxError(
                    ErrorCodes.FileCorrupt,
                    `bad protected value at line ${node.lineNumber}: ${e}`
                );
            }
        }
    });
}

export function updateProtectedValuesSalt(
    node: XmlNode,
    protectSaltGenerator: ProtectSaltGenerator
): void {
    traverse(node, (node) => {
        if (strToBoolean(node.getAttribute(XmlNames.Attr.Protected)) && node.protectedValue) {
            const newSalt = protectSaltGenerator.getSalt(node.protectedValue.byteLength);
            node.protectedValue.setSalt(newSalt);
            node.textContent = node.protectedValue.toString();
        }
    });
}

export function unprotectValues(node: XmlNode): void {
    traverse(node, (node) => {
        if (strToBoolean(node.getAttribute(XmlNames.Attr.Protected)) && node.protectedValue) {
            node.removeAttribute(XmlNames.Attr.Protected);
            node.setAttribute(XmlNames.Attr.ProtectedInMemPlainXml, 'True');
            node.textContent = node.protectedValue.getText();
        }
    });
}

export function protectUnprotectedValues(node: XmlNode): void {
    traverse(node, (node) => {
        if (
            strToBoolean(node.getAttribute(XmlNames.Attr.ProtectedInMemPlainXml)) &&
            node.protectedValue
        ) {
            node.removeAttribute(XmlNames.Attr.ProtectedInMemPlainXml);
            node.setAttribute(XmlNames.Attr.Protected, 'True');
            node.textContent = node.protectedValue.toString();
        }
    });
}

export function protectPlainValues(node: XmlNode): void {
    traverse(node, (node) => {
        if (strToBoolean(node.getAttribute(XmlNames.Attr.ProtectedInMemPlainXml))) {
            node.protectedValue = ProtectedValue.fromString(node.textContent || '');
            node.textContent = node.protectedValue.toString();
            node.removeAttribute(XmlNames.Attr.ProtectedInMemPlainXml);
            node.setAttribute(XmlNames.Attr.Protected, 'True');
        }
    });
}
