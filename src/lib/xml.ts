// Kleiner XML-Leser für Schnittstellen-Antworten (eBay Trading API): Elemente werden zu Objekten,
// wiederholte Elemente zu Listen, Text zu Zeichenketten. Attribute und Namensräume fallen weg –
// für Antworten, deren Inhalt in Elementen steht, reicht das.

export type XmlValue = string | XmlObject | XmlValue[];
export type XmlObject = { [name: string]: XmlValue };

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

type Frame = { name: string; children: Map<string, XmlValue[]>; text: string };

const TOKEN = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;

const local = (name: string) => name.slice(name.indexOf(":") + 1);

function close(f: Frame): XmlValue {
  if (!f.children.size) return f.text.trim() ? f.text : f.text.trim();
  const o: XmlObject = {};
  for (const [k, list] of f.children) o[k] = list.length === 1 ? list[0] : list;
  return o;
}

/** XML → Objekt mit dem Wurzelelement als einzigem Schlüssel. Kaputtes XML → Fehler. */
export function parseXml(xml: string): XmlObject {
  const root: Frame = { name: "#root", children: new Map(), text: "" };
  const stack: Frame[] = [root];
  for (const m of xml.matchAll(TOKEN)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      top.text += m[1];
    } else if (m[3] !== undefined) {
      const name = local(m[3]);
      if (m[2] === "/") {
        const done = stack.pop();
        if (!done || done.name !== name || !stack.length) throw new Error(`XML: unerwartetes </${name}>`);
        const parent = stack[stack.length - 1];
        const list = parent.children.get(name) ?? [];
        list.push(close(done));
        parent.children.set(name, list);
      } else if (m[5] === "/") {
        const list = top.children.get(name) ?? [];
        list.push("");
        top.children.set(name, list);
      } else {
        stack.push({ name, children: new Map(), text: "" });
      }
    } else if (m[6] !== undefined) {
      top.text += decodeXml(m[6]);
    }
  }
  if (stack.length !== 1) throw new Error(`XML: <${stack[stack.length - 1].name}> nicht geschlossen`);
  return close(root) as XmlObject;
}

/** Immer eine Liste (ein Element oder keins → Liste mit einem bzw. keinem Eintrag). */
export const xmlList = (v: XmlValue | undefined): XmlValue[] => (v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v]);

/** Text eines Elements (bei Liste: des ersten). */
export function xmlText(v: XmlValue | undefined): string {
  if (v === undefined) return "";
  if (Array.isArray(v)) return xmlText(v[0]);
  return typeof v === "string" ? v.trim() : "";
}

/** Unterelement über einen Pfad, z. B. xmlAt(item, "SellingStatus", "CurrentPrice"). */
export function xmlAt(v: XmlValue | undefined, ...path: string[]): XmlValue | undefined {
  let cur = v;
  for (const p of path) {
    if (Array.isArray(cur)) cur = cur[0];
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as XmlObject)[p];
  }
  return cur;
}
