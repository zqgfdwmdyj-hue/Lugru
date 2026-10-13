import type { Db } from '../db/db';
import { getAttempt, updateAttempt } from '../db/db';
import type { InventoryApi } from '../ebay/inventory';
import type { ListingAttempt, Settings } from '../types';
import { copyImagesToEps, type EpsUploader } from './epsCopy';
import { buildInventoryItemPayload, buildOfferPayload } from './payload';
import { buildGroupPayload, buildVariantItemPayload, buildVariantOfferPayload, isVariation, variationProblems } from './variants';

/**
 * Veröffentlicht einen Draft auf eBay: Bilder kopieren → InventoryItem → Offer
 * (neu oder Update) → Publish. Setup-Probleme (fehlende Policies etc.) werfen,
 * ohne den Attempt-Status anzufassen; eBay-Fehler landen als publish_failed am
 * Attempt.
 *
 * Die Bilder werden erst hier in den eigenen eBay-Bestand kopiert — so entsteht
 * kein Upload für Bilder, die in der Vorschau wieder gelöscht wurden.
 */
export async function publishAttempt(
  db: Db,
  inv: InventoryApi,
  settings: Settings,
  id: number,
  upload: EpsUploader
): Promise<ListingAttempt> {
  const attempt = await getAttempt(db, id);
  if (!attempt) throw new Error(`Listing-Versuch ${id} nicht gefunden.`);
  if (attempt.status === 'published') throw new Error('Dieses Listing wurde bereits veröffentlicht.');
  if (attempt.status === 'no_images') {
    throw new Error('Ohne Bild kann nicht veröffentlicht werden — der eBay-Katalog liefert für dieses Produkt kein Bild.');
  }
  if (attempt.status === 'no_catalog_match') {
    throw new Error('Ohne Katalogtreffer kann nicht veröffentlicht werden.');
  }
  if (!attempt.title || attempt.title.trim() === '') {
    throw new Error('Bitte zuerst einen Titel eingeben (in der Vorschau editierbar).');
  }

  const missing: string[] = [];
  if (!attempt.fulfillmentPolicyId && !settings.fulfillmentPolicyId) missing.push('Versandprofil');
  if (!settings.paymentPolicyId) missing.push('Zahlungsprofil');
  if (!settings.returnPolicyId) missing.push('Rückgabeprofil');
  if (!settings.merchantLocationKey) missing.push('Artikelstandort');
  if (missing.length > 0) {
    throw new Error(`Bitte zuerst in den Einstellungen festlegen: ${missing.join(', ')}.`);
  }
  if (isVariation(attempt)) return publishVariations(db, inv, settings, attempt, upload);

  // Ohne EAN (Treffer per Produkttitel gewählt) reicht die laufende Nummer als SKU.
  const sku = attempt.sku ?? (attempt.ean ? `LG-${attempt.ean}-${attempt.id}` : `LG-${attempt.id}`);
  let current = (await updateAttempt(db, id, { sku }))!;

  try {
    // Erst nach erfolgreichem Publish in die DB — schlägt er fehl, bleiben die
    // Original-URLs für den Retry stehen.
    const imageUrls = await copyImagesToEps(current.imageUrls ?? [], upload);
    const forPublish = { ...current, imageUrls };
    await inv.putInventoryItem(sku, buildInventoryItemPayload(forPublish));

    const offerPayload = buildOfferPayload(forPublish, settings);
    let offerId = current.offerId;
    if (offerId) {
      await inv.updateOffer(offerId, offerPayload);
    } else {
      offerId = await inv.createOffer(offerPayload);
      current = (await updateAttempt(db, id, { offerId }))!;
    }

    const listingId = await inv.publishOffer(offerId);
    // Bekanntes Fenster: stirbt der Prozess zwischen publishOffer und diesem
    // Update, ist das Listing live, während die DB es weiter als Entwurf führt
    // (mit den Original-Bild-URLs). Ein Retry liefe dann in einen eBay-Fehler.
    // Sauber lösen ließe sich das nur, indem der Status vor publishOffer auf
    // „unbestätigt" ginge und die Originale in einer eigenen Spalte blieben —
    // dafür ist der Nutzen hier zu klein. Der Fall betraf schon vor den Bildern
    // die listingId.
    return (await updateAttempt(db, id, { status: 'published', listingId, imageUrls, errorMessage: undefined }))!;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (await updateAttempt(db, id, { status: 'publish_failed', errorMessage: message }))!;
  }
}

/**
 * Mehrfachangebot: Bilder kopieren → je Variante ein InventoryItem → Gruppe → je Variante ein
 * Offer (neu oder Update) → die Gruppe als ein Angebot veröffentlichen. Jede neue offerId wird
 * sofort gespeichert, damit ein erneuter Versuch aktualisiert statt doppelt anzulegen.
 */
async function publishVariations(
  db: Db,
  inv: InventoryApi,
  settings: Settings,
  attempt: ListingAttempt,
  upload: EpsUploader
): Promise<ListingAttempt> {
  const problems = variationProblems(attempt);
  if (problems.length > 0) throw new Error(problems.join(' '));
  const id = attempt.id;
  const key = attempt.sku ?? `LG-${id}-G`;
  const current = (await updateAttempt(db, id, { sku: key }))!;
  const v = current.variants!;

  try {
    // Jedes Bild nur einmal kopieren – Varianten nutzen oft Bilder des Angebots.
    const variantImages = v.items.flatMap((i) => (i.imageUrl ? [i.imageUrl] : []));
    const originals = [...new Set([...(current.imageUrls ?? []), ...variantImages])];
    const copied = await copyImagesToEps(originals, upload);
    const eps = new Map(originals.map((u, i) => [u, copied[i]]));
    let groupImages = (current.imageUrls ?? []).map((u) => eps.get(u)!);
    // Ohne gemeinsame Bilder zeigt das Angebot die Bilder der Varianten.
    if (groupImages.length === 0) groupImages = [...new Set(variantImages)].slice(0, 24).map((u) => eps.get(u)!);
    const items = v.items.map((i) => ({ ...i, imageUrl: i.imageUrl ? eps.get(i.imageUrl) : undefined }));
    const forPublish: ListingAttempt = { ...current, imageUrls: groupImages, variants: { ...v, items } };

    for (const item of items) await inv.putInventoryItem(item.sku, buildVariantItemPayload(forPublish, item, groupImages));
    await inv.putInventoryItemGroup(key, buildGroupPayload(forPublish, groupImages));

    // Gespeichert werden die Original-Bild-URLs, bis das Angebot live ist (wie beim einfachen Angebot).
    const stored = v.items.map((i) => ({ ...i }));
    for (const [n, item] of items.entries()) {
      const payload = buildVariantOfferPayload(forPublish, item, settings);
      if (item.offerId) {
        await inv.updateOffer(item.offerId, payload);
      } else {
        item.offerId = await inv.createOffer(payload);
        stored[n].offerId = item.offerId;
        await updateAttempt(db, id, { variants: { ...v, items: stored } });
      }
    }

    const listingId = await inv.publishOfferByGroup(key);
    return (await updateAttempt(db, id, {
      status: 'published',
      listingId,
      imageUrls: groupImages,
      variants: { ...v, items },
      errorMessage: undefined,
    }))!;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (await updateAttempt(db, id, { status: 'publish_failed', errorMessage: message }))!;
  }
}
