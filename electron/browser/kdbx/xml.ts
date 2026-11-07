// A small XML tree, parser and serializer for KDBX's XML (in place of @xmldom/xmldom): elements, attributes, text,
// comments and processing instructions. A DTD is refused, so no entity is ever expanded or fetched.
import { ErrorCodes } from './consts.ts';
import { KdbxError } from './kdbx-error.ts';
import type { ProtectedValue } from './protected-value.ts';

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;
export const PROCESSING_INSTRUCTION_NODE = 7;
export const COMMENT_NODE = 8;
export const DOCUMENT_NODE = 9;

// Deeper than any real file (groups in groups): a hostile one can't overflow the stack of the code reading it.
export const MaxDepth = 1000;

export class XmlNode {
    readonly nodeType: number;
    /** An element's name; '' for any other node. */
    readonly tagName: string;
    /** A text node's text, a comment's, or a processing instruction's (its target first). */
    data: string;
    readonly childNodes: XmlNode[] = [];
    parentNode: XmlNode | null = null;
    readonly ownerDocument: XmlDocument | null;
    protectedValue: ProtectedValue | undefined;
    lineNumber: number | undefined;
    private readonly attrs = new Map<string, string>();

    constructor(doc: XmlDocument | null, nodeType: number, tagName = '', data = '') {
        this.ownerDocument = doc;
        this.nodeType = nodeType;
        this.tagName = tagName;
        this.data = data;
    }

    get textContent(): string {
        if (this.nodeType === TEXT_NODE || this.nodeType === COMMENT_NODE) {
            return this.data;
        }
        if (this.nodeType === PROCESSING_INSTRUCTION_NODE) {
            return this.data;
        }
        const parts: string[] = [];
        const collect = (n: XmlNode) => {
            for (const c of n.childNodes) {
                if (c.nodeType === TEXT_NODE) {
                    parts.push(c.data);
                } else if (c.nodeType === ELEMENT_NODE) {
                    collect(c);
                }
            }
        };
        collect(this);
        return parts.join('');
    }

    set textContent(text: string) {
        if (this.nodeType !== ELEMENT_NODE) {
            this.data = text;
            return;
        }
        for (const c of this.childNodes) {
            c.parentNode = null;
        }
        this.childNodes.length = 0;
        if (text) {
            this.appendChild(new XmlNode(this.ownerDocument, TEXT_NODE, '', text));
        }
    }

    get nodeName(): string {
        const names: Record<number, string> = { 3: '#text', 7: '#pi', 8: '#comment', 9: '#document' };
        return this.nodeType === ELEMENT_NODE ? this.tagName : names[this.nodeType];
    }

    get firstChild(): XmlNode | null {
        return this.childNodes[0] ?? null;
    }

    get attributeNames(): string[] {
        return [...this.attrs.keys()];
    }

    getAttribute(name: string): string | null {
        return this.attrs.get(name) ?? null;
    }

    hasAttribute(name: string): boolean {
        return this.attrs.has(name);
    }

    setAttribute(name: string, value: string): void {
        this.attrs.set(name, String(value));
    }

    removeAttribute(name: string): void {
        this.attrs.delete(name);
    }

    get nextSibling(): XmlNode | null {
        const siblings = this.parentNode?.childNodes;
        if (!siblings) {
            return null;
        }
        return siblings[siblings.indexOf(this) + 1] ?? null;
    }

    appendChild<T extends XmlNode>(node: T): T {
        return this.insertBefore(node, null);
    }

    insertBefore<T extends XmlNode>(node: T, before: XmlNode | null): T {
        if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
        const at = before ? this.childNodes.indexOf(before) : -1;
        if (at < 0) {
            this.childNodes.push(node);
        } else {
            this.childNodes.splice(at, 0, node);
        }
        node.parentNode = this;
        return node;
    }

    removeChild<T extends XmlNode>(node: T): T {
        const at = this.childNodes.indexOf(node);
        if (at >= 0) {
            this.childNodes.splice(at, 1);
            node.parentNode = null;
        }
        return node;
    }
}

export class XmlDocument extends XmlNode {
    constructor() {
        super(null, DOCUMENT_NODE);
    }

    get documentElement(): XmlNode {
        const root = this.childNodes.find((c) => c.nodeType === ELEMENT_NODE);
        if (!root) {
            throw new KdbxError(ErrorCodes.FileCorrupt, 'bad xml: no root element');
        }
        return root;
    }

    createElement(tagName: string): XmlNode {
        if (!NameRegex.test(tagName)) {
            throw new KdbxError(ErrorCodes.InvalidArg, `bad xml name: ${tagName}`);
        }
        return new XmlNode(this, ELEMENT_NODE, tagName);
    }

    createTextNode(text: string): XmlNode {
        return new XmlNode(this, TEXT_NODE, '', text);
    }
}

// ---------- parsing ----------

const NameStart = 'A-Za-z_:\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD';
const NameChar = NameStart + '\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040';
const NameRegex = new RegExp(`^[${NameStart}][${NameChar}]*$`);
const NameAt = new RegExp(`[${NameStart}][${NameChar}]*`, 'y');
const SpaceAt = /[ \t\n\r]*/y;
const AttrValueAt = /"([^"<]*)"|'([^'<]*)'/y;
const Entities: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function fail(message: string, xml: string, pos: number): never {
    const line = xml.slice(0, pos).split('\n').length;
    throw new KdbxError(ErrorCodes.FileCorrupt, `bad xml: ${message} at line ${line}`);
}

function decode(raw: string, xml: string, pos: number): string {
    if (raw.indexOf('&') < 0) {
        return raw;
    }
    return raw.replace(/&([^;&<]*);?/g, (m: string, ref: string) => {
        if (!m.endsWith(';')) {
            fail('an unescaped &', xml, pos);
        }
        if (ref[0] === '#') {
            const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
            const ok = ref[1] === 'x' ? /^#x[0-9a-fA-F]+$/.test(ref) : /^#[0-9]+$/.test(ref);
            if (!ok || !(code > 0 && code <= 0x10ffff) || (code >= 0xd800 && code <= 0xdfff)) {
                fail(`a bad character reference &${ref};`, xml, pos);
            }
            return String.fromCodePoint(code);
        }
        const value = Object.hasOwn(Entities, ref) ? Entities[ref] : undefined;
        if (value === undefined) {
            fail(`an unknown entity &${ref};`, xml, pos);
        }
        return value;
    });
}

/** The document `xml` is (a string, its line ends as given): well-formed or a FileCorrupt error saying where not. */
export function parseXml(xml: string): XmlDocument {
    xml = xml.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const doc = new XmlDocument();
    const stack: XmlNode[] = [doc];
    let pos = 0;
    let line = 1;
    let lineCountedTo = 0;
    const lineAt = (p: number) => {
        for (let i = xml.indexOf('\n', lineCountedTo); i >= 0 && i < p; i = xml.indexOf('\n', i + 1)) {
            line++;
        }
        lineCountedTo = Math.max(lineCountedTo, p);
        return line;
    };
    const top = () => stack[stack.length - 1];
    const addText = (text: string) => {
        const parent = top();
        if (parent === doc) {
            if (/[^ \t\n]/.test(text)) {
                fail('text outside the root element', xml, pos);
            }
            return;
        }
        const last = parent.childNodes[parent.childNodes.length - 1];
        if (last?.nodeType === TEXT_NODE) {
            last.data += text;
        } else {
            parent.appendChild(new XmlNode(doc, TEXT_NODE, '', text));
        }
    };

    while (pos < xml.length) {
        const lt = xml.indexOf('<', pos);
        if (lt < 0) {
            addText(decode(xml.slice(pos), xml, pos));
            break;
        }
        if (lt > pos) {
            addText(decode(xml.slice(pos, lt), xml, pos));
        }
        pos = lt;
        if (xml.startsWith('<!--', pos)) {
            const end = xml.indexOf('-->', pos + 4);
            if (end < 0) {
                fail('an unclosed comment', xml, pos);
            }
            top().appendChild(new XmlNode(doc, COMMENT_NODE, '', xml.slice(pos + 4, end)));
            pos = end + 3;
        } else if (xml.startsWith('<![CDATA[', pos)) {
            const end = xml.indexOf(']]>', pos + 9);
            if (end < 0 || top() === doc) {
                fail('a bad CDATA section', xml, pos);
            }
            addText(xml.slice(pos + 9, end));
            pos = end + 3;
        } else if (xml.startsWith('<?', pos)) {
            const end = xml.indexOf('?>', pos + 2);
            if (end < 0) {
                fail('an unclosed processing instruction', xml, pos);
            }
            top().appendChild(new XmlNode(doc, PROCESSING_INSTRUCTION_NODE, '', xml.slice(pos + 2, end)));
            pos = end + 2;
        } else if (xml.startsWith('<!', pos)) {
            fail('a DTD or declaration, which KeePass files never have', xml, pos);
        } else if (xml[pos + 1] === '/') {
            NameAt.lastIndex = pos + 2;
            const name = NameAt.exec(xml)?.[0];
            const open = top();
            if (!name || open === doc || open.tagName !== name) {
                fail(`a closing tag </${name ?? ''}> that doesn't match`, xml, pos);
            }
            SpaceAt.lastIndex = pos + 2 + name.length;
            SpaceAt.exec(xml);
            if (xml[SpaceAt.lastIndex] !== '>') {
                fail('a bad closing tag', xml, pos);
            }
            stack.pop();
            pos = SpaceAt.lastIndex + 1;
        } else {
            NameAt.lastIndex = pos + 1;
            const name = NameAt.exec(xml)?.[0];
            if (!name) {
                fail('a bad tag', xml, pos);
            }
            const parent = top();
            if (parent === doc && doc.childNodes.some((c) => c.nodeType === ELEMENT_NODE)) {
                fail('a second root element', xml, pos);
            }
            if (stack.length > MaxDepth) {
                fail('elements nested too deep', xml, pos);
            }
            const el = new XmlNode(doc, ELEMENT_NODE, name);
            el.lineNumber = lineAt(pos);
            let at = pos + 1 + name.length;
            for (;;) {
                SpaceAt.lastIndex = at;
                const space = SpaceAt.exec(xml)![0].length;
                at += space;
                if (xml.startsWith('/>', at)) {
                    parent.appendChild(el);
                    at += 2;
                    break;
                }
                if (xml[at] === '>') {
                    parent.appendChild(el);
                    stack.push(el);
                    at += 1;
                    break;
                }
                NameAt.lastIndex = at;
                const attr = space ? NameAt.exec(xml)?.[0] : undefined;
                if (!attr) {
                    fail(`a bad attribute in <${name}>`, xml, at);
                }
                at += attr.length;
                SpaceAt.lastIndex = at;
                at += SpaceAt.exec(xml)![0].length;
                if (xml[at] !== '=') {
                    fail(`an attribute without a value in <${name}>`, xml, at);
                }
                SpaceAt.lastIndex = at + 1;
                at = at + 1 + SpaceAt.exec(xml)![0].length;
                AttrValueAt.lastIndex = at;
                const quoted = AttrValueAt.exec(xml);
                if (!quoted) {
                    fail(`a bad attribute value in <${name}>`, xml, at);
                }
                if (el.hasAttribute(attr)) {
                    fail(`a repeated attribute ${attr} in <${name}>`, xml, at);
                }
                // (attribute-value normalization: a literal tab or line end is a space; one by reference stays)
                const raw = (quoted[1] ?? quoted[2]).replace(/[\t\n]/g, ' ');
                el.setAttribute(attr, decode(raw, xml, at));
                at = AttrValueAt.lastIndex;
            }
            pos = at;
        }
    }
    if (stack.length > 1) {
        fail(`<${top().tagName}> isn't closed`, xml, pos);
    }
    if (!doc.childNodes.some((c) => c.nodeType === ELEMENT_NODE)) {
        fail('no root element', xml, pos);
    }
    return doc;
}

// ---------- serializing ----------

// (characters XML 1.0 can't carry: KeePass drops them when it saves too)
const Invalid = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g;
const escapeText = (s: string) =>
    s.replace(Invalid, '').replace(/[&<>\r]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&#xD;'));
const AttrEscapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\t': '&#x9;', '\n': '&#xA;', '\r': '&#xD;' };
const escapeAttr = (s: string) => s.replace(Invalid, '').replace(/[&<>"\t\n\r]/g, (c) => AttrEscapes[c]);

/** The text of `node` and what's in it, which parseXml reads back as the same tree. */
export function serializeXml(node: XmlNode): string {
    const out: string[] = [];
    const write = (n: XmlNode) => {
        switch (n.nodeType) {
            case DOCUMENT_NODE:
                n.childNodes.forEach(write);
                break;
            case TEXT_NODE:
                out.push(escapeText(n.data));
                break;
            case COMMENT_NODE:
                out.push('<!--', n.data.replace(/--/g, '- -'), '-->');
                break;
            case PROCESSING_INSTRUCTION_NODE:
                out.push('<?', n.data, '?>');
                break;
            case ELEMENT_NODE: {
                out.push('<', n.tagName);
                for (const name of n.attributeNames) {
                    out.push(' ', name, '="', escapeAttr(n.getAttribute(name) ?? ''), '"');
                }
                if (!n.childNodes.length) {
                    out.push('/>');
                } else {
                    out.push('>');
                    n.childNodes.forEach(write);
                    out.push('</', n.tagName, '>');
                }
                break;
            }
        }
    };
    write(node);
    return out.join('');
}
