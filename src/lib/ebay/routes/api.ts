import { h, Router } from './router';
import type { Db } from '../db/db';
import {
  getAttempt, getSetting, getSettings, getToken, listAttempts, listUnconfirmedPurchases, setSetting, updateAttempt,
} from '../db/db';
import { getPolicies, getShippingPolicies, optInToBusinessPolicies } from '../ebay/account';
import { buildConsentUrl, exchangeCode, extractCodeFromRedirectUrl, isExpired } from '../ebay/auth';
import { fetchItemByLegacyId, fetchItemByRef, lookupByEan, searchListings } from '../ebay/browse';
import { listingUrl } from '../ebay/config';
import { makeInventoryApi } from '../ebay/inventory';
import {
  applyFetchedItem,
  collectFromSelection,
  NO_ITEM_DATA_ERROR,
  recollectWithMatch,
  type CollectSources,
} from '../pipeline/collect';
import { groupArticles, keyOf } from '../pipeline/articles';
import { buildDescription } from '../pipeline/describe';
import { parseDescriptionHtml } from '../pipeline/descriptionHtml';
import { lookupIdealo } from '../idealo/idealo';
import { withOwnHistory } from '../idealo/history';
import { lookupKeepaImages } from '../keepa/keepa';
import { saveLocation } from '../setup/location';
import { estimateFee, resolveFeeRate } from '../pipeline/fees';
import { addImages, removeImage } from '../pipeline/images';
import { roundCents } from '../pipeline/money';
import { computeProfit } from '../pipeline/profit';
import { GROSS_NEEDS_VAT, NET_BASIS_SINCE, purchaseUnitNet } from '../pipeline/purchasePrice';
import { parseSource } from '../pipeline/source';
import { uploadPictureToEps } from '../ebay/pictures';
import { parseEbayItemUrl, parseSearchInputAsItemUrl } from '../pipeline/itemUrl';
import { publishAttempt } from '../pipeline/publish';
import { aspectProblems, aspectsFromError, missingRequired, normalizeAspects, parseEan, type CategoryAspect } from '../pipeline/aspects';
import { getCategoryAspects } from '../ebay/taxonomy';
import { truncateTitle } from '../pipeline/title';
import type { Condition, Env, ListingAttempt, Settings } from '../types';

const CONDITIONS: Condition[] = ['NEW', 'NEW_OTHER', 'USED_VERY_GOOD', 'USED_GOOD', 'USED_ACCEPTABLE'];
const ENV_KEYS = ['clientId', 'clientSecret', 'ruName', 'fulfillmentPolicyId', 'paymentPolicyId', 'returnPolicyId'] as const;
/** Gebühren und USt-Satz gelten unabhängig vom Environment — siehe getSettings in db/db.ts. */
const GLOBAL_KEYS = [
  'vatPercentage', 'feePercent', 'feeFixed', 'feeFixedAbove', 'feeFixedThreshold',
  'shippingAssumption', 'feeCategoryRates', 'keepaApiKey',
] as const;


/**
 * Beträge werden auf Cent gerundet gespeichert: eBay bekommt ohnehin zwei
 * Nachkommastellen, und Datenbank, Aufstellung und Angebot sollen dieselbe
 * Zahl führen.
 */
export function parsePrice(value: unknown): number {
  const p = Number(value);
  if (!Number.isFinite(p)) throw new Error('Bitte einen gültigen Preis eingeben.');
  const cents = roundCents(p);
  if (cents <= 0) throw new Error('Bitte einen gültigen Preis eingeben.');
  return cents;
}

export function parseQuantity(value: unknown): number {
  const q = Number(value);
  if (!Number.isInteger(q) || q < 1) throw new Error('Die Stückzahl muss eine ganze Zahl ab 1 sein.');
  return q;
}

export function parsePurchasedUnits(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error('Die gekauften Einheiten müssen eine ganze Zahl ab 1 sein.');
  return n;
}

export function parseOptionalPrice(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const p = Number(value);
  if (!Number.isFinite(p)) throw new Error('Bitte einen gültigen Betrag eingeben.');
  const cents = roundCents(p);
  if (cents <= 0) throw new Error('Bitte einen gültigen Betrag eingeben.');
  return cents;
}

export { purchaseUnitNet };

export function parseCondition(value: unknown): Condition {
  const cond = value as Condition;
  if (!CONDITIONS.includes(cond)) throw new Error('Unbekannter Zustand.');
  return cond;
}

async function makeSources(db: Db): Promise<CollectSources> {
  const settings = await getSettings(db);
  return {
    lookupByEan: (ean) => lookupByEan(db, settings, ean),
    fetchItemByRef: (ref, epidHint) => fetchItemByRef(db, settings, ref, epidHint),
  };
}

/**
 * Attempt um alles ergänzen, was die Oberfläche anzeigt, aber nicht selbst
 * rechnen soll. Die Einstellungen kommen als Parameter, damit eine Liste sie
 * nicht je Zeile neu aus der Datenbank liest.
 */
function decorate(settings: Settings, a: ListingAttempt) {
  const fee = resolveFeeRate(a.categoryId, a.condition, settings);
  const feeAmount = estimateFee(a.price, fee, settings);
  return {
    ...a,
    listingUrl: a.listingId ? listingUrl(settings.env, a.listingId) : undefined,
    fee: feeAmount,
    feePercent: fee.percent,
    feeMatched: fee.matched,
    shipping: settings.shippingAssumption ?? 0,
    /** Hinterlegter USt-Satz — die Vorschau braucht ihn für die Brutto-Eingabe. */
    vatPercentage: settings.vatPercentage,
    profit: computeProfit({
      salePrice: a.price,
      purchasePrice: a.purchasePrice,
      fee: feeAmount,
      shipping: settings.shippingAssumption,
      vatPercentage: settings.vatPercentage,
    }),
    source: a.purchaseSource ? parseSource(a.purchaseSource) : null,
  };
}

/** Merkmale der Kategorie — ohne Kategorie oder eBay-Verbindung eine leere Liste plus Grund. */
async function categoryAspects(db: Db, settings: Settings, categoryId?: string): Promise<{ aspects: CategoryAspect[]; error?: string }> {
  if (!categoryId) return { aspects: [], error: 'Noch keine Kategorie — die Merkmale der Kategorie kommen, sobald ein Katalogtreffer gewählt ist.' };
  try {
    return { aspects: await getCategoryAspects(db, settings, categoryId) };
  } catch (err) {
    return { aspects: [], error: `Merkmale der Kategorie nicht abrufbar: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Anschluss an das Seller-System (Wawi) – im eigenständigen Betrieb leer. */
export interface ApiHooks {
  /** Nach erfolgreichem Veröffentlichen: Angebot in die Wawi übernehmen, Hinweis für die Vorschau. */
  onPublished?: (attempt: ListingAttempt) => Promise<string | undefined>;
}

export function apiRouter(db: Db, hooks: ApiHooks = {}): Router {
  const r = new Router();

  // --- Listing-Versuche ---

  /** Entwurf aus dem gewählten Suchtreffer + den eingegebenen Verkaufsdaten. */
  r.post('/attempts', h(async (req, res) => {
    const { ref, epid, ean, price, quantity, condition, purchasedUnits, purchasePrice,
            purchasePriceMode, purchasePriceVat, purchaseSource, targetPrice } = req.body ?? {};
    const cleanRef = String(ref ?? '').trim();
    if (cleanRef === '') throw new Error('Bitte zuerst ein Listing aus den Suchtreffern auswählen.');
    const cleanEan = String(ean ?? '').replace(/\s/g, '');
    if (cleanEan !== '' && !/^\d{8,14}$/.test(cleanEan)) throw new Error('Die EAN muss 8–14 Ziffern haben.');

    const settings = await getSettings(db);
    const units = parsePurchasedUnits(purchasedUnits);
    const target = parseOptionalPrice(targetPrice);
    const source = String(purchaseSource ?? '').trim();

    const attempt = await collectFromSelection(db, await makeSources(db), {
      ref: cleanRef,
      epid: epid ? String(epid) : undefined,
      ean: cleanEan === '' ? undefined : cleanEan,
      // Der angedachte VK ist der Startwert des Angebotspreises.
      price: parsePrice(price ?? target),
      quantity: parseQuantity(quantity ?? 1),
      condition: parseCondition(condition ?? 'NEW'),
      purchasedUnits: units,
      purchasePrice: purchaseUnitNet(parseOptionalPrice(purchasePrice), {
        mode: purchasePriceMode,
        units,
        vatMode: purchasePriceVat,
        vatPercentage: settings.vatPercentage,
      }),
      purchaseSource: source === '' ? undefined : source,
      targetPrice: target,
    });
    res.json(decorate(settings, attempt));
  }));

  r.get('/attempts', h(async (_req, res) => {
    const settings = await getSettings(db);
    res.json((await listAttempts(db)).map((a) => decorate(settings, a)));
  }));

  // --- Artikel (Ableitung über die Versuche, keine eigene Tabelle) ---

  r.get('/articles', h(async (_req, res) => {
    res.json(groupArticles(await listAttempts(db), await getSettings(db)));
  }));

  r.get('/articles/:key', h(async (req, res) => {
    // Express dekodiert Routen-Parameter bereits — der Schlüssel kommt mit „:" an.
    const key = req.params.key;
    const attempts = (await listAttempts(db)).filter((a) => keyOf(a) === key);
    if (attempts.length === 0) throw new Error('Artikel nicht gefunden.');
    const settings = await getSettings(db);
    res.json({
      article: groupArticles(attempts, settings)[0],
      attempts: attempts.map((a) => decorate(settings, a)),
    });
  }));

  r.get('/attempts/:id', h(async (req, res) => {
    const attempt = await getAttempt(db, Number(req.params.id));
    if (!attempt) throw new Error('Listing-Versuch nicht gefunden.');
    res.json(decorate(await getSettings(db), attempt));
  }));

  // --- Altbestand: Einkaufspreise ohne bestätigte Basis ---

  r.get('/purchases/unconfirmed', h(async (_req, res) => {
    const settings = await getSettings(db);
    res.json({
      attempts: (await listUnconfirmedPurchases(db)).map((a) => decorate(settings, a)),
      vatPercentage: settings.vatPercentage,
      netBasisSince: NET_BASIS_SINCE,
    });
  }));

  /**
   * Bestätigt die Basis alter Einkaufspreise: `confirm` markiert sie als netto,
   * `convert` rechnet sie mit dem hinterlegten USt-Satz von brutto auf netto um.
   * Schon bestätigte Zeilen werden übergangen — nichts wird zweimal umgerechnet.
   */
  r.post('/purchases/basis', h(async (req, res) => {
    const { ids, action } = req.body ?? {};
    if (action !== 'confirm' && action !== 'convert') throw new Error('Unbekannte Aktion.');
    if (!Array.isArray(ids) || ids.length === 0) throw new Error('Keine Versuche angegeben.');
    const settings = await getSettings(db);
    if (action === 'convert' && !(settings.vatPercentage && settings.vatPercentage > 0)) throw new Error(GROSS_NEEDS_VAT);

    const updated = await db.transaction(async (tx) => {
      let n = 0;
      for (const raw of ids) {
        const attempt = await getAttempt(tx, Number(raw));
        if (!attempt || attempt.purchasePrice === undefined || attempt.purchasePriceBasis !== undefined) continue;
        if (action === 'convert') {
          await updateAttempt(tx, attempt.id, {
            purchasePrice: purchaseUnitNet(attempt.purchasePrice, { vatMode: 'gross', vatPercentage: settings.vatPercentage }),
          });
        } else {
          await updateAttempt(tx, attempt.id, { purchasePriceBasis: 'net' });
        }
        n += 1;
      }
      return n;
    });
    res.json({ updated });
  }));

  r.patch('/attempts/:id', h(async (req, res) => {
    const id = Number(req.params.id);
    const attempt = await getAttempt(db, id);
    if (!attempt) throw new Error('Listing-Versuch nicht gefunden.');
    const settings = await getSettings(db);

    const body = req.body ?? {};
    const purchaseKeys = ['purchasedUnits', 'purchasePrice', 'purchaseSource', 'targetPrice'];
    if (purchaseKeys.some((k) => k in body)) {
      // Einkaufsdaten sind Buchhaltung, kein Angebotsinhalt — auch nach dem Veröffentlichen änderbar.
      // Deshalb dürfen sie nicht mit Angebotsfeldern in einem Body kommen: dieser Zweig
      // kennt deren Schreibschutz nicht und würde sie stillschweigend verwerfen.
      const companions = ['purchasePriceMode', 'purchasePriceVat'];
      const foreign = Object.keys(body).filter(
        (k) => !purchaseKeys.includes(k) && !companions.includes(k)
      );
      if (foreign.length > 0) {
        throw new Error(
          `Einkaufsdaten und Angebotsdaten bitte getrennt speichern — unerwartet im selben Aufruf: ${foreign.join(', ')}.`
        );
      }
      const patch: Partial<ListingAttempt> = {};
      const units = 'purchasedUnits' in body ? parsePurchasedUnits(body.purchasedUnits) : attempt.purchasedUnits;
      if ('purchasedUnits' in body) patch.purchasedUnits = units;
      if ('purchasePrice' in body) {
        patch.purchasePrice = purchaseUnitNet(parseOptionalPrice(body.purchasePrice), {
          mode: body.purchasePriceMode,
          units,
          vatMode: body.purchasePriceVat,
          vatPercentage: settings.vatPercentage,
        });
      }
      if ('purchaseSource' in body) {
        const s = String(body.purchaseSource ?? '').trim();
        patch.purchaseSource = s === '' ? undefined : s;
      }
      if ('targetPrice' in body) patch.targetPrice = parseOptionalPrice(body.targetPrice);
      res.json(decorate(settings, (await updateAttempt(db, id, patch))!));
      return;
    }

    if (attempt.status === 'published') throw new Error('Veröffentlichte Listings können hier nicht mehr geändert werden.');

    const { title, price, quantity, condition, ref, url, epid, description, resetDescription, fulfillmentPolicyId, aspects, ean } =
      req.body ?? {};
    if (url) {
      const legacyId = parseEbayItemUrl(String(url));
      if (!legacyId) throw new Error('Das sieht nicht nach einem eBay-Artikel-Link (oder einer Artikelnummer) aus.');
      const item = await fetchItemByLegacyId(db, settings, legacyId);
      res.json(decorate(settings, await applyFetchedItem(db, id, item)));
      return;
    }
    if (ref) {
      const changed = await recollectWithMatch(db, await makeSources(db), id, String(ref), epid ? String(epid) : undefined);
      res.json(decorate(settings, changed));
      return;
    }
    const patch: Partial<ListingAttempt> = {};
    if (typeof title === 'string' && title.trim() !== '') patch.title = truncateTitle(title);
    if (price !== undefined) patch.price = parsePrice(price);
    if (quantity !== undefined) patch.quantity = parseQuantity(quantity);
    if (condition !== undefined) patch.condition = parseCondition(condition);
    if (description !== undefined) patch.description = parseDescriptionHtml(description);
    // Zurück zur erzeugten Beschreibung aus Titel und Artikelmerkmalen.
    if (resetDescription === true) {
      patch.description = buildDescription(patch.title ?? attempt.title ?? '', attempt.aspects ?? {});
    }
    if (aspects !== undefined) {
      const defs = (await categoryAspects(db, settings, attempt.categoryId)).aspects;
      patch.aspects = normalizeAspects(aspects, defs);
    }
    if (ean !== undefined) patch.ean = parseEan(ean);
    if (fulfillmentPolicyId !== undefined) {
      // Leer heißt: wieder das Standard-Versandprofil aus den Einstellungen.
      const v = String(fulfillmentPolicyId ?? '').trim();
      patch.fulfillmentPolicyId = v === '' ? undefined : v;
    }
    res.json(decorate(settings, (await updateAttempt(db, id, patch))!));
  }));

  /**
   * Artikelmerkmale der Kategorie für den Editor in der Vorschau: Pflicht, empfohlen,
   * erlaubte Werte — und was am Entwurf noch fehlt (auch aus eBays letzter Fehlermeldung).
   */
  r.get('/attempts/:id/aspects', h(async (req, res) => {
    const attempt = await getAttempt(db, Number(req.params.id));
    if (!attempt) throw new Error('Listing-Versuch nicht gefunden.');
    const settings = await getSettings(db);
    const { aspects, error } = await categoryAspects(db, settings, attempt.categoryId);
    const current = attempt.aspects ?? {};
    const fromError = aspectsFromError(attempt.errorMessage).filter((n) => !Object.keys(current).some((k) => k.toLowerCase() === n.toLowerCase()));
    res.json({
      aspects,
      error,
      missing: [...new Set([...missingRequired(aspects, current, attempt.ean), ...fromError])],
      fromError,
      problems: aspectProblems(aspects, current),
    });
  }));

  /** Preisvergleich bei idealo — per EAN, ohne EAN per Titel. */
  r.get('/attempts/:id/idealo', h(async (req, res) => {
    const attempt = await getAttempt(db, Number(req.params.id));
    if (!attempt) throw new Error('Listing-Versuch nicht gefunden.');
    res.json(await withOwnHistory(db, await lookupIdealo({ ean: attempt.ean, title: attempt.title })));
  }));

  /**
   * Amazon-Bilder über Keepa — nur nachschlagen, nicht übernehmen: welche Bilder
   * ins Listing kommen, wählt der Nutzer danach über POST …/images.
   */
  r.get('/attempts/:id/keepa-images', h(async (req, res) => {
    const attempt = await getAttempt(db, Number(req.params.id));
    if (!attempt) throw new Error('Listing-Versuch nicht gefunden.');
    const code = String(req.query.code ?? '').trim() || attempt.ean;
    res.json(await lookupKeepaImages(code, (await getSettings(db)).keepaApiKey));
  }));

  r.post('/attempts/:id/images', h(async (req, res) => {
    const id = Number(req.params.id);
    const { files, urls } = (req.body ?? {}) as { files?: { name?: string; dataBase64?: string }[]; urls?: string[] };
    const settings = await getSettings(db);
    const collected: string[] = [];

    for (const f of files ?? []) {
      if (!f?.dataBase64) continue;
      const buffer = Buffer.from(f.dataBase64, 'base64');
      if (buffer.length > 12 * 1024 * 1024) throw new Error('Bilder dürfen höchstens 12 MB groß sein.');
      collected.push(await uploadPictureToEps(db, settings, f.name || 'bild.jpg', buffer));
    }
    for (const u of urls ?? []) {
      if (typeof u === 'string' && u.trim() !== '') collected.push(u.trim());
    }
    if (collected.length === 0) throw new Error('Keine Bilder übergeben.');
    res.json(decorate(settings, await addImages(db, id, collected)));
  }));

  r.delete('/attempts/:id/images', h(async (req, res) => {
    const url = String(req.body?.url ?? '');
    if (!url) throw new Error('Keine Bild-URL angegeben.');
    res.json(decorate(await getSettings(db), await removeImage(db, Number(req.params.id), url)));
  }));

  /** Einstieg des Workflows: EAN, Produkttitel oder eingefügter eBay-Link. */
  r.get('/search', h(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) throw new Error('Bitte EAN oder Produkttitel eingeben (mindestens 2 Zeichen).');
    const settings = await getSettings(db);

    // Nackte Ziffern sind hier die EAN — nur echte Links gehen über die Artikelnummer.
    const legacyId = parseSearchInputAsItemUrl(q);
    if (legacyId) {
      const item = await fetchItemByLegacyId(db, settings, legacyId);
      if (!item.product) throw new Error(NO_ITEM_DATA_ERROR);
      res.json([
        {
          ref: item.ref,
          title: item.product.title || `eBay-Artikel ${legacyId}`,
          // Ohne Katalogbild wenigstens das Foto des Angebots — sonst zeigt die Karte nichts.
          imageUrl: item.product.imageUrls[0] ?? item.listingImages[0],
          epid: item.product.epid,
          categoryId: item.product.categoryId,
          itemWebUrl: `https://www.ebay.de/itm/${legacyId}`,
        },
      ]);
      return;
    }
    res.json(await searchListings(db, settings, q));
  }));

  r.post('/attempts/:id/publish', h(async (req, res) => {
    const settings = await getSettings(db);
    const draft = await getAttempt(db, Number(req.params.id));
    if (draft && draft.status !== 'published') {
      // Pflicht-Merkmale vorab prüfen — spart den Umweg über eBays Fehlermeldung.
      const { aspects } = await categoryAspects(db, settings, draft.categoryId);
      const missing = missingRequired(aspects, draft.aspects ?? {}, draft.ean);
      if (missing.length) throw new Error(`Bitte zuerst die Pflicht-Merkmale ausfüllen: ${missing.join(', ')}.`);
      const problems = aspectProblems(aspects, draft.aspects ?? {});
      if (problems.length) throw new Error(`Artikelmerkmale prüfen: ${problems.join(' ')}`);
    }
    const inv = makeInventoryApi(db, settings);
    const attempt = await publishAttempt(db, inv, settings, Number(req.params.id), (name, data) =>
      uploadPictureToEps(db, settings, name, data)
    );
    let wawiNote: string | undefined;
    if (attempt.status === 'published' && hooks.onPublished) {
      // Das Angebot ist live – ein Fehler bei der Wawi-Übernahme darf das nicht verdecken.
      wawiNote = await hooks.onPublished(attempt).catch(
        (err) => `Wawi-Übernahme fehlgeschlagen: ${err instanceof Error ? err.message : String(err)} – unter Listings „eBay-Angebote übernehmen“ nachholen.`
      );
    }
    res.json({ ...decorate(settings, attempt), wawiNote });
  }));

  // --- Einstellungen ---

  r.get('/settings', h(async (_req, res) => {
    const s = await getSettings(db);
    const env = s.env;
    res.json({
      ...s,
      clientSecret: s.clientSecret ? '***' : '',
      keepaApiKey: s.keepaApiKey ? '***' : '',
      locationAddressLine1: await getSetting(db, `${env}.locAddressLine1`) ?? '',
      locationCity: await getSetting(db, `${env}.locCity`) ?? '',
      locationPostalCode: await getSetting(db, `${env}.locPostalCode`) ?? '',
    });
  }));

  r.put('/settings', h(async (req, res) => {
    const body = req.body ?? {};
    if (body.env === 'sandbox' || body.env === 'production') await setSetting(db, 'env', body.env);
    const env: Env = (await getSetting(db, 'env') as Env | null) ?? 'sandbox';
    for (const key of ENV_KEYS) {
      const value = body[key];
      if (value === undefined || value === '***') continue;
      await setSetting(db, `${env}.${key}`, String(value));
    }
    for (const key of GLOBAL_KEYS) {
      const value = body[key];
      // '***' ist der maskierte Keepa-Schlüssel aus GET /settings — unverändert lassen.
      if (value === undefined || value === '***') continue;
      // feeCategoryRates darf als Objekt oder als JSON-String kommen — `String(obj)`
      // ergäbe sonst "[object Object]" und würde die Einstellung unbrauchbar machen.
      await setSetting(db, key, typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value));
    }
    res.json({ ok: true });
  }));

  r.post('/optin', h(async (_req, res) => {
    await optInToBusinessPolicies(db, await getSettings(db));
    res.json({ ok: true });
  }));

  r.get('/policies', h(async (_req, res) => {
    const settings = await getSettings(db);
    const [fulfillment, payment, ret] = await Promise.all([
      getPolicies(db, settings, 'fulfillment'),
      getPolicies(db, settings, 'payment'),
      getPolicies(db, settings, 'return'),
    ]);
    res.json({ fulfillment, payment, return: ret });
  }));

  /** Versandprofile mit Kosten — für die Auswahl direkt am Angebot. */
  r.get('/shipping-policies', h(async (_req, res) => {
    const settings = await getSettings(db);
    res.json({
      policies: await getShippingPolicies(db, settings),
      defaultId: settings.fulfillmentPolicyId ?? null,
    });
  }));

  r.post('/location', h(async (req, res) => {
    const { addressLine1, city, postalCode } = req.body ?? {};
    if (!addressLine1 || !city || !postalCode) throw new Error('Bitte Straße, Stadt und PLZ angeben.');
    await saveLocation(db, await getSettings(db), {
      addressLine1: String(addressLine1),
      city: String(city),
      postalCode: String(postalCode),
    });
    res.json({ ok: true });
  }));

  // --- eBay-Verbindung ---

  r.get('/auth/url', h(async (req, res) => {
    res.json({ url: buildConsentUrl(await getSettings(db), { withOrders: req.query.orders !== '0' }) });
  }));

  r.post('/auth/code', h(async (req, res) => {
    const redirectUrl = String(req.body?.redirectUrl ?? '');
    const code = extractCodeFromRedirectUrl(redirectUrl);
    await exchangeCode(db, await getSettings(db), code);
    res.json({ ok: true });
  }));

  r.get('/status', h(async (_req, res) => {
    const s = await getSettings(db);
    const userToken = await getToken(db, s.env, 'user');
    const connected = Boolean(
      userToken?.refreshToken && (!userToken.refreshExpiresAt || !isExpired(userToken.refreshExpiresAt, 0))
    );
    res.json({
      env: s.env,
      keysOk: Boolean(s.clientId && s.clientSecret && s.ruName),
      connected,
      connectionExpiresAt: connected ? userToken?.refreshExpiresAt ?? null : null,
      policiesOk: Boolean(s.fulfillmentPolicyId && s.paymentPolicyId && s.returnPolicyId),
      locationOk: Boolean(s.merchantLocationKey),
    });
  }));

  return r;
}
