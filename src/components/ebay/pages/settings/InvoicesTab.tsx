import { useEffect, useState } from 'react';
import { api } from '../../api';

interface Smtp { host?: string; port?: number; secure?: boolean; user?: string; pass?: string; from?: string }
interface Form {
  companyName?: string; ownerName?: string; street?: string; postalCode?: string; city?: string; country?: string;
  email?: string; phone?: string; taxNumber?: string; vatId?: string; kleinunternehmer?: boolean; vatRate?: number;
  prefix?: string; startNumber?: number; footerText?: string; autoCreate?: boolean; autoSend?: boolean; startDate?: string;
  emailSubject?: string; emailText?: string; smtp?: Smtp;
}
interface Info { settings: Form; missing: string[]; vatRate: number; defaults: { emailSubject: string; emailText: string } }

/** Absenderdaten, Nummernkreis, Automatik und E-Mail-Versand für Rechnungen. */
export function InvoicesTab() {
  const [info, setInfo] = useState<Info | null>(null);
  const [f, setF] = useState<Form>({});
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [testTo, setTestTo] = useState('');

  const load = () =>
    api<Info>('/invoice-settings').then((i) => {
      setInfo(i);
      setF({ prefix: 'RE-', ...i.settings, smtp: { ...i.settings.smtp } });
      setDirty(false);
    }).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);

  const set = (patch: Partial<Form>) => { setF({ ...f, ...patch }); setDirty(true); setMsg(''); };
  const setSmtp = (patch: Partial<Smtp>) => set({ smtp: { ...f.smtp, ...patch } });

  async function run(fn: () => Promise<void>, success: string) {
    setError('');
    setMsg('');
    try {
      await fn();
      setMsg(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const save = () => run(async () => {
    await api('/invoice-settings', { method: 'PUT', body: JSON.stringify(f) });
    await load();
  }, 'Gespeichert.');

  if (!info) return <p className="muted">{error || 'Lädt …'}</p>;

  const text = (key: keyof Form, label: string, placeholder?: string) => (
    <label>
      {label}
      <input value={(f[key] as string | undefined) ?? ''} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value })} />
    </label>
  );
  const year = new Date().getFullYear();

  return (
    <section className="stack">
      {msg && <div className="banner success">{msg}</div>}
      {error && <div className="banner error">{error}</div>}

      <h3>Deine Rechnungsangaben</h3>
      <p className="muted">Pflichtangaben nach § 14 UStG. Sie stehen im Kopf und Fuß jeder Rechnung.</p>
      {info.missing.length > 0 && <div className="banner warn">Noch offen: {info.missing.join(', ')}</div>}
      {text('companyName', 'Firmenname', 'z.B. LuGru Handel')}
      {text('ownerName', 'Inhaber / Geschäftsführer (optional)')}
      {text('street', 'Straße und Hausnummer')}
      <div className="row">
        {text('postalCode', 'PLZ')}
        {text('city', 'Ort')}
        {text('country', 'Land', 'Deutschland')}
      </div>
      <div className="row">
        {text('email', 'E-Mail')}
        {text('phone', 'Telefon (optional)')}
      </div>
      <div className="row">
        {text('taxNumber', 'Steuernummer', 'z.B. 12/345/67890')}
        {text('vatId', 'USt-IdNr.', 'z.B. DE123456789')}
      </div>
      <label className="check">
        <input type="checkbox" checked={Boolean(f.kleinunternehmer)} onChange={(e) => set({ kleinunternehmer: e.target.checked })} />
        Kleinunternehmer nach § 19 UStG (keine Umsatzsteuer ausweisen)
      </label>
      {!f.kleinunternehmer && (
        <label>
          Umsatzsteuersatz in %
          <input
            type="number" min={0} max={100} step={0.1}
            value={f.vatRate ?? ''}
            placeholder={`${info.vatRate} (aus der Kalkulation)`}
            onChange={(e) => set({ vatRate: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </label>
      )}
      <label>
        Fußzeile (optional)
        <textarea className="code plain" rows={3} value={f.footerText ?? ''} placeholder={'Bankverbindung: IBAN DE…\nAmtsgericht …'} onChange={(e) => set({ footerText: e.target.value })} />
      </label>

      <h3>Rechnungsnummern</h3>
      <div className="row">
        {text('prefix', 'Präfix', 'RE-')}
        <label>
          Erste Nummer in {year}
          <input
            type="number" min={1} step={1}
            value={f.startNumber ?? ''}
            placeholder="1"
            onChange={(e) => set({ startNumber: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </label>
      </div>
      <p className="muted">
        Beispiel: {(f.prefix ?? 'RE-')}{year}-{String(f.startNumber ?? 1).padStart(4, '0')}. Die Nummern laufen lückenlos weiter und
        beginnen jedes Jahr neu. Die erste Nummer nur ändern, wenn du bisher mit einem anderen Programm Rechnungen geschrieben hast.
      </p>

      <h3>Automatik</h3>
      <label className="check">
        <input type="checkbox" checked={Boolean(f.autoCreate)} onChange={(e) => set({ autoCreate: e.target.checked })} />
        Für neue bezahlte eBay-Bestellungen automatisch Rechnungen erstellen
      </label>
      <p className="muted">
        Läuft alle 15 Minuten, solange das Tool geöffnet ist.
        {f.startDate ? ` Abgerechnet werden Bestellungen ab ${new Date(f.startDate).toLocaleString('de-DE')}.` : ' Beim Einschalten zählen nur Bestellungen ab diesem Zeitpunkt — ältere lassen sich auf der Seite Rechnungen einzeln abrechnen.'}
      </p>
      <label className="check">
        <input type="checkbox" checked={Boolean(f.autoSend)} onChange={(e) => set({ autoSend: e.target.checked })} />
        Automatisch erstellte Rechnungen per E-Mail an den Käufer senden
      </label>

      <h3>E-Mail-Versand</h3>
      <p className="muted">
        Rechnungen gehen über dein eigenes E-Mail-Postfach raus. Die Zugangsdaten stehen bei deinem Anbieter,
        z.B. GMX: mail.gmx.net, Port 465 · Web.de: smtp.web.de, Port 465 · Gmail: smtp.gmail.com, Port 465 mit App-Passwort.
      </p>
      <div className="row">
        <label>
          SMTP-Server
          <input value={f.smtp?.host ?? ''} placeholder="z.B. smtp.web.de" onChange={(e) => setSmtp({ host: e.target.value })} />
        </label>
        <label>
          Port
          <input type="number" value={f.smtp?.port ?? ''} placeholder="465" onChange={(e) => setSmtp({ port: e.target.value === '' ? undefined : Number(e.target.value) })} />
        </label>
        <label>
          Verschlüsselung
          <select
            value={f.smtp?.secure === false ? 'starttls' : 'ssl'}
            onChange={(e) => setSmtp({ secure: e.target.value === 'ssl' })}
          >
            <option value="ssl">SSL/TLS (465)</option>
            <option value="starttls">STARTTLS (587)</option>
          </select>
        </label>
      </div>
      <div className="row">
        <label>
          Benutzername
          <input value={f.smtp?.user ?? ''} autoComplete="off" onChange={(e) => setSmtp({ user: e.target.value })} />
        </label>
        <label>
          Passwort
          <input
            type="password" autoComplete="new-password"
            value={f.smtp?.pass ?? ''}
            placeholder={f.smtp?.pass === '***' ? 'gespeichert' : ''}
            onFocus={() => { if (f.smtp?.pass === '***') setSmtp({ pass: '' }); }}
            onChange={(e) => setSmtp({ pass: e.target.value })}
          />
        </label>
        <label>
          Absenderadresse
          <input value={f.smtp?.from ?? ''} placeholder={f.email || 'shop@beispiel.de'} onChange={(e) => setSmtp({ from: e.target.value })} />
        </label>
      </div>
      <label>
        Betreff
        <input value={f.emailSubject ?? ''} placeholder={info.defaults.emailSubject} onChange={(e) => set({ emailSubject: e.target.value })} />
      </label>
      <label>
        Text
        <textarea className="code plain" rows={6} value={f.emailText ?? ''} placeholder={info.defaults.emailText} onChange={(e) => set({ emailText: e.target.value })} />
      </label>
      <p className="muted">Platzhalter: {'{name}'}, {'{nummer}'}, {'{bestellnummer}'}. Die Rechnung hängt als PDF an.</p>

      <div className="tab-actions">
        <button
          className="primary"
          disabled={!dirty}
          onClick={() => {
            // Ein leer gelassenes Passwortfeld nach dem Fokussieren heißt: altes behalten.
            if (f.smtp && f.smtp.pass === '' && info.settings.smtp?.pass === '***') f.smtp.pass = '***';
            void save();
          }}
        >
          Speichern
        </button>
        {dirty && <span className="muted">Es gibt ungespeicherte Änderungen.</span>}
      </div>

      <h3>Test-E-Mail</h3>
      <span className="with-toggle">
        <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={f.email || 'Empfänger'} />
        <button
          disabled={dirty}
          title={dirty ? 'Erst speichern' : undefined}
          onClick={() => void run(async () => {
            await api('/invoice-settings/test-mail', { method: 'POST', body: JSON.stringify({ to: testTo || undefined }) });
          }, 'Test-E-Mail gesendet — bitte im Postfach nachsehen.')}
        >
          Test-E-Mail senden
        </button>
      </span>
    </section>
  );
}
