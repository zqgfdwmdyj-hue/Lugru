// Kleiner XML-Leser für CalDAV-Antworten (WebDAV-Multistatus). Namensräume werden
// weggelassen: <d:href>, <D:href> und <href xmlns="DAV:"> heißen hier alle „href".

export type XmlNode = { name: string; children: XmlNode[]; text: string; attrs?: Record<string, string> };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

const local = (tag: string) => tag.slice(tag.indexOf(":") + 1).toLowerCase();

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#root", children: [], text: "" };
  const stack: XmlNode[] = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      if (stack.length > 1) stack.pop();
    } else if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[local(a[1])] = decode(a[2] ?? a[3] ?? "");
      const node: XmlNode = { name: local(m[3]), children: [], text: "", attrs };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6]) top.text += decode(m[6]);
  }
  return root;
}

/** Alle Nachfahren mit diesem Namen (Tiefensuche). */
export function findAll(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

export function find(node: XmlNode, name: string): XmlNode | undefined {
  return findAll(node, name)[0];
}

/** Text eines Knotens samt Nachfahren, getrimmt. */
export function textOf(node: XmlNode | undefined): string {
  if (!node) return "";
  return (node.text + node.children.map(textOf).join("")).trim();
}

export type DavResponse = { href: string; props: Map<string, XmlNode>; status: number };

/** Liest ein WebDAV-Multistatus: je <response> die Eigenschaften mit Status 200. */
export function parseMultistatus(xml: string): DavResponse[] {
  const root = parseXml(xml);
  return findAll(root, "response").map((r) => {
    const href = decodeURIComponent(textOf(r.children.find((c) => c.name === "href")));
    const props = new Map<string, XmlNode>();
    let status = 0;
    for (const ps of r.children.filter((c) => c.name === "propstat")) {
      const code = Number(/\s(\d{3})\s/.exec(` ${textOf(ps.children.find((c) => c.name === "status"))} `)?.[1] ?? 0);
      if (code !== 200) continue;
      status = 200;
      const prop = ps.children.find((c) => c.name === "prop");
      for (const p of prop?.children ?? []) props.set(p.name, p);
    }
    const direct = r.children.find((c) => c.name === "status");
    if (!status && direct) status = Number(/\s(\d{3})\s/.exec(` ${textOf(direct)} `)?.[1] ?? 0);
    return { href, props, status };
  });
}
