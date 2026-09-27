import { h, Router } from './router';
import type { Db } from '../db/db';
import { getSettings } from '../db/db';
import { DEFAULT_EMAIL_SUBJECT, DEFAULT_EMAIL_TEXT, effectiveVatRate, missingSellerData } from '../invoices/build';
import { makeSmtpSender } from '../invoices/mail';
import { fetchOrders } from '../invoices/orders';
import { renderInvoicePdf } from '../invoices/pdf';
import {
  cancelInvoice, createInvoice, defaultMailer, openOrders, pdfFilename, sendInvoice, syncInvoices, type InvoiceDeps,
} from '../invoices/service';
import { getInvoice, getInvoiceSettings, getSyncStatus, listInvoices, saveInvoiceSettings } from '../invoices/store';
import type { InvoiceRecord, InvoiceSettings } from '../invoices/types';


export function invoiceDeps(db: Db): InvoiceDeps {
  return {
    fetchOrders: async (since) => fetchOrders(db, await getSettings(db), since),
    mailer: defaultMailer(db),
  };
}

function summary(inv: InvoiceRecord, all: InvoiceRecord[]) {
  return {
    id: inv.id,
    number: inv.number,
    kind: inv.kind,
    orderId: inv.orderId,
    date: inv.data.date,
    buyerName: inv.data.buyer.name,
    buyerEmail: inv.data.buyerEmail,
    total: inv.data.totalGross,
    currency: inv.data.currency,
    emailedAt: inv.emailedAt,
    emailTo: inv.emailTo,
    emailError: inv.emailError,
    cancelledBy: inv.cancelledById ? all.find((i) => i.id === inv.cancelledById)?.number : undefined,
    cancels: inv.data.cancels,
  };
}

const STRING_KEYS = [
  'companyName', 'ownerName', 'street', 'postalCode', 'city', 'country', 'email', 'phone', 'taxNumber', 'vatId',
  'prefix', 'footerText', 'emailSubject', 'emailText',
] as const;

/** Formularwerte übernehmen: Texte getrimmt, Zahlen geprüft, maskiertes Passwort unverändert. */
export function mergeInvoiceSettings(current: InvoiceSettings, body: Record<string, unknown>, now = new Date()): InvoiceSettings {
  const next: InvoiceSettings = { ...current };
  for (const key of STRING_KEYS) {
    if (key in body) {
      const v = String(body[key] ?? '').trim();
      (next as Record<string, unknown>)[key] = v === '' ? undefined : v;
    }
  }
  if ('prefix' in body && next.prefix !== undefined && !/^[\w-]{0,12}$/.test(next.prefix)) {
    throw new Error('Das Präfix darf nur Buchstaben, Ziffern, - und _ enthalten (höchstens 12 Zeichen).');
  }
  if ('kleinunternehmer' in body) next.kleinunternehmer = Boolean(body.kleinunternehmer);
  if ('autoSend' in body) next.autoSend = Boolean(body.autoSend);
  if ('autoCreate' in body) {
    next.autoCreate = Boolean(body.autoCreate);
    // Beim ersten Einschalten ab jetzt abrechnen — nicht rückwirkend alle alten Bestellungen.
    if (next.autoCreate && !current.startDate) next.startDate = now.toISOString();
  }
  if ('vatRate' in body) {
    const v = body.vatRate === '' || body.vatRate == null ? undefined : Number(body.vatRate);
    if (v !== undefined && !(Number.isFinite(v) && v >= 0 && v <= 100)) throw new Error('Der USt-Satz muss zwischen 0 und 100 liegen.');
    next.vatRate = v;
  }
  if ('startNumber' in body) {
    const v = body.startNumber === '' || body.startNumber == null ? undefined : Number(body.startNumber);
    if (v !== undefined && !(Number.isInteger(v) && v >= 1)) throw new Error('Die Startnummer muss eine ganze Zahl ab 1 sein.');
    next.startNumber = v;
    next.startNumberYear = v === undefined ? undefined : now.getFullYear();
  }
  if (body.smtp && typeof body.smtp === 'object') {
    const b = body.smtp as Record<string, unknown>;
    const port = b.port === '' || b.port == null ? undefined : Number(b.port);
    if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new Error('Ungültiger SMTP-Port.');
    next.smtp = {
      host: String(b.host ?? '').trim() || undefined,
      port,
      secure: b.secure === undefined ? undefined : Boolean(b.secure),
      user: String(b.user ?? '').trim() || undefined,
      pass: b.pass === '***' ? current.smtp?.pass : String(b.pass ?? '') || undefined,
      from: String(b.from ?? '').trim() || undefined,
    };
  }
  return next;
}

export function invoiceRouter(db: Db, deps: InvoiceDeps = invoiceDeps(db)): Router {
  const r = new Router();

  r.get('/invoice-settings', h(async (_req, res) => {
    const s = await getInvoiceSettings(db);
    const settings = await getSettings(db);
    res.json({
      settings: { ...s, smtp: s.smtp ? { ...s.smtp, pass: s.smtp.pass ? '***' : '' } : undefined },
      missing: missingSellerData(s),
      env: settings.env,
      vatRate: effectiveVatRate({ ...s, kleinunternehmer: false }, settings.vatPercentage),
      lastSync: await getSyncStatus(db),
      defaults: { emailSubject: DEFAULT_EMAIL_SUBJECT, emailText: DEFAULT_EMAIL_TEXT },
    });
  }));

  r.put('/invoice-settings', h(async (req, res) => {
    await saveInvoiceSettings(db, mergeInvoiceSettings(await getInvoiceSettings(db), (req.body ?? {}) as Record<string, unknown>));
    res.json({ ok: true });
  }));

  r.post('/invoice-settings/test-mail', h(async (req, res) => {
    const s = await getInvoiceSettings(db);
    const to = String(req.body?.to ?? s.email ?? '').trim();
    if (!to) throw new Error('Bitte eine Empfängeradresse für die Test-E-Mail angeben.');
    await makeSmtpSender(s.smtp ?? {}, s.email)({
      to,
      subject: 'Test-E-Mail vom LuGru eBay-Tool',
      text: 'Der E-Mail-Versand für Rechnungen funktioniert.',
    });
    res.json({ ok: true, to });
  }));

  r.get('/invoices', h(async (_req, res) => {
    const all = await listInvoices(db);
    res.json(all.map((i) => summary(i, all)));
  }));

  r.get('/invoices/open-orders', h(async (_req, res) => {
    res.json(await openOrders(db, deps));
  }));

  r.post('/invoices/sync', h(async (_req, res) => {
    res.json(await syncInvoices(db, deps));
  }));

  r.post('/invoices/from-order', h(async (req, res) => {
    const orderId = String(req.body?.orderId ?? '');
    const order = (await openOrders(db, deps)).find((o) => o.orderId === orderId);
    if (!order) throw new Error('Bestellung nicht gefunden oder bereits abgerechnet.');
    const inv = await createInvoice(db, order);
    res.json(summary(inv, await listInvoices(db)));
  }));

  r.get('/invoices/:id/pdf', h(async (req, res) => {
    const inv = await getInvoice(db, Number(req.params.id));
    if (!inv) throw new Error('Rechnung nicht gefunden.');
    const pdf = await renderInvoicePdf(inv.data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${pdfFilename(inv)}"`);
    res.send(Buffer.from(pdf));
  }));

  r.post('/invoices/:id/send', h(async (req, res) => {
    const to = req.body?.to ? String(req.body.to) : undefined;
    const inv = await sendInvoice(db, Number(req.params.id), to, await (deps.mailer ?? defaultMailer(db))());
    res.json(summary(inv, await listInvoices(db)));
  }));

  r.post('/invoices/:id/cancel', h(async (req, res) => {
    const storno = await cancelInvoice(db, Number(req.params.id));
    res.json(summary(storno, await listInvoices(db)));
  }));

  return r;
}
