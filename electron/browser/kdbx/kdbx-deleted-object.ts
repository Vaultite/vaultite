import * as XmlUtils from './xml-utils.ts';
import * as XmlNames from './xml-names.ts';
import { KdbxUuid } from './kdbx-uuid.ts';
import { KdbxContext } from './kdbx-context.ts';
import type { XmlNode } from './xml.ts';

export class KdbxDeletedObject {
    uuid: KdbxUuid | undefined;
    deletionTime: Date | undefined;

    private readNode(node: XmlNode): void {
        switch (node.tagName) {
            case XmlNames.Elem.Uuid:
                this.uuid = XmlUtils.getUuid(node);
                break;
            case XmlNames.Elem.DeletionTime:
                this.deletionTime = XmlUtils.getDate(node);
                break;
        }
    }

    write(parentNode: XmlNode, ctx: KdbxContext): void {
        const node = XmlUtils.addChildNode(parentNode, XmlNames.Elem.DeletedObject);
        XmlUtils.setUuid(XmlUtils.addChildNode(node, XmlNames.Elem.Uuid), this.uuid);
        ctx.setXmlDate(XmlUtils.addChildNode(node, XmlNames.Elem.DeletionTime), this.deletionTime);
    }

    static read(xmlNode: XmlNode): KdbxDeletedObject {
        const obj = new KdbxDeletedObject();
        for (let i = 0, cn = xmlNode.childNodes, len = cn.length; i < len; i++) {
            const childNode = cn[i];
            if (childNode.tagName) {
                obj.readNode(childNode);
            }
        }
        return obj;
    }
}
