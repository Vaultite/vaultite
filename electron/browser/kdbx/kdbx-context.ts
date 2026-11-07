import * as XmlUtils from './xml-utils.ts';
import { Kdbx } from './kdbx.ts';
import type { XmlNode } from './xml.ts';

export class KdbxContext {
    readonly kdbx: Kdbx;
    exportXml: boolean;

    constructor(opts: { kdbx: Kdbx; exportXml?: boolean }) {
        this.kdbx = opts.kdbx;
        this.exportXml = !!opts.exportXml;
    }

    setXmlDate(node: XmlNode, dt: Date | undefined): void {
        const isBinary = this.kdbx.versionMajor >= 4 && !this.exportXml;
        XmlUtils.setDate(node, dt, isBinary);
    }
}
