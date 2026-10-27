const http = require('http');
// Breite des ersten Bilds der Anfrage (JPEG-Kopf) – Testbilder mit 950 px Breite zeigen „mehrere Produkte“.
function firstImageWidth(reqJson) {
  const b64 = (JSON.stringify(reqJson.messages || []).match(/"data":"([^"]+)"/) || [])[1] || '';
  const buf = Buffer.from(b64, 'base64');
  for (let i = 2; i < buf.length - 9; ) { if (buf[i] !== 0xff) break; const m = buf[i + 1], len = buf.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc2) return buf.readUInt16BE(i + 7); i += 2 + len; }
  return 0;
}
let n = 0;
http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    n++;
    if (body.includes('Welches Bild zeigt die Vorderseite')) {
      console.log('titelbild');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_v' + n, type: 'message', role: 'assistant', model: 'claude-haiku-4-5', stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text: '{"vorne": 2}' }], usage: { input_tokens: 900, output_tokens: 8 } }));
      return;
    }
    if (body.includes('Foodsharing-Team bei einer')) {
      const req = JSON.parse(body);
      const msg = req.messages[0].content;
      const names = [...msg.matchAll(/^- (.+?) \(/gm)].map((m) => m[1]);
      const pick = (i) => names[i % names.length];
      const answer = { titel: 'Herbstliche Schätze zum kleinen Preis', einleitung: 'Aus den geretteten Lebensmitteln lassen sich wunderbare Pakete und Gerichte zaubern.',
        pakete: [{ name: 'Halloween-Naschpaket', beschreibung: 'Süßes für die Gruselparty.', produkte: [pick(0), pick(1), pick(2)] }, { name: 'Gemütliches Winterpaket', beschreibung: 'Für kalte Abende auf dem Sofa.', produkte: [pick(3), pick(4)] }],
        rezepte: [{ name: 'Schnelle Tomaten-Pasta', aus_der_verteilung: [pick(0), pick(3)], zusaetzlich: ['Nudeln', 'Olivenöl', 'Knoblauch'], anleitung: 'Nudeln kochen. Tomaten klein schneiden und in Öl anbraten. Alles mischen und mit Salz abschmecken.', dauer: '20 Min.' }],
        aktionstext: '🎃 Samstag ist Verteilung!\nDiesmal mit Halloween-Naschpaket und Winterpaket.\nKommt vorbei – gegen kleine Spende, solange der Vorrat reicht.', tipps: ['Pakete in Körben vorbereiten und mit Schild auslegen.'],
        plakat: { thema: 'winter', titel: 'Bevorratet euch für den Winter!', untertitel: 'Bei vielen Produkten lohnt es sich, gleich ganze Packungen mitzunehmen.', notiz: 'Gemeinsam Lebensmittel retten und gut vorbereitet in die kalte Jahreszeit starten!',
          hervorgehoben: names.slice(0, 6), gruppen: [{ titel: 'Wenn es mal schnell gehen muss …', text: 'Schnelle Gerichte und Snacks für zwischendurch.', produkte: names.slice(6, 9) }, { titel: 'Für gemütliche Stunden …', text: 'Tee, Kakao und Leckereien für die Couch.', produkte: names.slice(3, 6) }],
          schluss: 'Wir freuen uns auf euch bei unserer nächsten Verteilung!' } };
      if (msg.includes('Modus: Verwendungs-Ideen')) { answer.pakete = []; answer.rezepte = []; answer.plakat = null; answer.verwendung = names.map((nm) => ({ produkt: nm, ideen: ['Ideal für ein schnelles Abendessen.', 'Passt gut zu Brot und Salat.'] })); }
      if (msg.includes('Modus: Rezept-Ideen')) { answer.pakete = []; answer.plakat = null; answer.rezepte = [1,2,3,4,5].map((k) => ({ name: 'Rezept ' + k + ' mit ' + pick(k), aus_der_verteilung: [pick(k), pick(k + 1)], zusaetzlich: ['Salz'], anleitung: 'Alles zusammen kochen und genießen.', dauer: (10 * k) + ' Min.' })); }
      console.log('ideen', names.length, 'Produkte, Wunsch:', /Themen: (.*)/.exec(msg)?.[1]);
      setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'msg_i' + n, type: 'message', role: 'assistant', model: req.model, stop_reason: 'end_turn', stop_sequence: null,
          content: [{ type: 'text', text: JSON.stringify(answer) }], usage: { input_tokens: 2100, output_tokens: 1400 } })); }, 2000);
      return;
    }
    if (body.includes('nachträglich ins Bild')) {
      // Testbilder: Breite 900 = „Je 60 Cent“, 901 = „1 €“, sonst kein Preis.
      const b64 = (body.match(/"data":"([^"]+)"/) || [])[1] || '';
      const buf = Buffer.from(b64, 'base64');
      let w = 0;
      for (let i = 2; i < buf.length - 9; ) { if (buf[i] !== 0xff) break; const m = buf[i + 1], len = buf.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc2) { w = buf.readUInt16BE(i + 7); break; } i += 2 + len; }
      const answer = w === 900 ? '{"preis_text": "Je 60 Cent", "preis": 0.6, "rahmen": [28, 83, 72, 94]}' : w === 901 ? '{"preis_text": "1 €", "preis": 1, "rahmen": [38, 83, 62, 94]}' : w === 902 ? '{"preis_text": "1,50 €", "preis": 1.5, "rahmen": [35, 86, 65, 96]}' : w === 903 ? '{"preis_text": "40 Cent", "preis": 0.4, "rahmen": [32, 86, 68, 96]}' : '{"preis_text": null}';
      console.log('preis-im-foto', w, answer);
      setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_p' + n, type: 'message', role: 'assistant', model: 'claude-haiku-4-5', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: answer }], usage: { input_tokens: 1600, output_tokens: 40 } })); }, 1500);
      return;
    }
    if (body.includes('Haltbarkeitsdatum')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: 'msg_m' + n, type: 'message', role: 'assistant', model: 'claude-haiku-4-5', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: '{"text": "mindestens haltbar bis 12.10.26", "datum": "2026-10-12"}' }], usage: { input_tokens: 1500, output_tokens: 30 } }));
    }
    const reqJson = JSON.parse(body || '{}');
    console.log(JSON.stringify({ model: reqJson.model, tools: (reqJson.tools||[]).map(t => t.type + ':' + t.max_uses), effort: reqJson.output_config?.effort, fallbacks: reqJson.fallbacks }));
    const hasImage = JSON.stringify(reqJson.messages).includes('"type":"image"');
    const names = ['Bio Kimchi', 'Getrocknete Tomaten', 'Hafer Porridge Beere', 'Proteinriegel Erdnuss', 'Kräutertee Frauentee'];
    const name = names[n % names.length];
    const noSearch = !(reqJson.tools||[]).length;
    const result = { name, variant: '500 g', category: 'Lebensmittel', offers: noSearch ? [] : [
      { shop: 'REWE', title: name + ' 500g', price: 3.49, unit: '6,98 €/kg', url: 'https://shop.rewe.de/p/beispiel-' + n },
      { shop: 'dm', title: name, price: 2.95, unit: null, url: 'https://www.dm.de/beispiel-' + n },
      { shop: 'Amazon.de', title: name + ' (Vorratspack)', price: 4.19, unit: null, url: 'https://www.amazon.de/dp/BEISPIEL' + n },
    ], summary: (hasImage ? 'Auf dem Foto erkannt. ' : '') + 'Testantwort vom Mock-Server.', mehrere: firstImageWidth(reqJson) === 950 };
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_' + n, type: 'message', role: 'assistant', model: reqJson.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: 'Hier das Ergebnis:\n```json\n' + JSON.stringify(result) + '\n```' }],
        usage: { input_tokens: 5200, output_tokens: 900, server_tool_use: { web_search_requests: 4 } } }));
    }, 3000);
  });
}).listen(3999);
