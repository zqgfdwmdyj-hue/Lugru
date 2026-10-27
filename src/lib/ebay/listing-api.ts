// Neue eBay-Listing-API (GraphQL, https://graphqlapi.ebay.com/graphql) – Ersatz für die Trading-Aufrufe
// GetMyeBaySelling, GetItem, ReviseFixedPriceItem und ReviseInventoryStatus. Die Abfragen sind gegen eBays
// veröffentlichtes Schema (listing.graphqls) geprüft. Benötigt die Berechtigung sell.listing; fehlt sie,
// melden die Aufrufe einen ListingScopeError und der Aufrufer nutzt die Trading API weiter.

export class ListingApiError extends Error {
  constructor(
    message: string,
    public readonly codes: string[] = [],
  ) {
    super(message);
  }
}
/** Die Verbindung erlaubt die neue Schnittstelle (noch) nicht – einmal neu verbinden. */
export class ListingScopeError extends ListingApiError {}

export type GqlConn = { url: string; token: string; marketplaceId: string };

/** Ein GraphQL-Aufruf; Fehler (HTTP oder `errors`) werden als ListingApiError gemeldet. */
export async function gql<T>(c: GqlConn, query: string, variables: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<T> {
  const res = await fetcher(c.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json", Accept: "application/json", "Accept-Language": "de-DE", "X-EBAY-C-MARKETPLACE-ID": c.marketplaceId },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let json: { data?: T | null; errors?: { message?: string; extensions?: { errorCode?: string; code?: string } }[] } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new ListingApiError(`eBay (Listing API): unerwartete Antwort (HTTP ${res.status}).`);
  }
  const codes = (json.errors ?? []).map((e) => e.extensions?.errorCode ?? e.extensions?.code ?? "").filter(Boolean);
  const msg = [...new Set((json.errors ?? []).map((e) => e.message?.trim().replace(/\.+$/, "")).filter(Boolean))].join(" | ");
  if (res.status === 401 || res.status === 403 || codes.some((x) => /UNAUTHORI[SZ]ED|FORBIDDEN|INSUFFICIENT_SCOPE|ACCESS_DENIED/i.test(x)) || /scope/i.test(msg)) {
    throw new ListingScopeError(`eBay (Listing API): keine Berechtigung${msg ? ` – ${msg}` : ""}. Unter eBay → eBay-Einstellungen → Verbindung einmal neu verbinden.`, codes);
  }
  if (!res.ok || json.errors?.length || !json.data) throw new ListingApiError(`eBay (Listing API): ${msg || `HTTP ${res.status}`}`, codes);
  return json.data;
}

// ---- Abfragen ------------------------------------------------------------------------------------------

const ADDRESS = "address { addressLine1 addressLine2 city postalCode country } contact { email phone }";

/** Alle Angaben eines Angebots – genug für Wawi-Übernahme und „Angebote prüfen“. */
export const LISTING_FULL = `
fragment ListingFull on ListingV2 {
  __typename
  listingId
  marketplace
  sellerProduct {
    title
    description
    aspects { name values }
    categories { primaryCategory { categoryId name } }
    images { ebayImageUrl externalImageUrl order }
    itemCondition { itemConditionId displayName }
  }
  listingTerms {
    listingFormat
    bestOfferTerms { acceptBestOffer }
    lifecycleTerms { startAt listingStatus }
    listingFulfillmentTerms {
      freeShippingAvailable
      shippingTerms { handlingTimeDuration shippingServices { rank shippingCostAmount { original { value currency } } } }
    }
    listingReturnTerms { domesticReturnTerms { returnAccepted returnDuration returnShipmentInvoicee } }
    regulatory {
      manufacturer { companyName ${ADDRESS} }
      responsiblePersons { companyName ${ADDRESS} }
    }
  }
  items {
    itemId
    sku
    itemSellerProduct { productIdentifiers { globalIdentifiers { ean upc isbn } } traits { name value } }
    itemTerms { availability { quantityAvailable quantitySold } pricingTerms { fixedPrice { original { value currency } } } }
  }
  ... on VariationListing {
    sku
    listingVariations {
      variationTraits { name values }
      imagesVaryByTrait { traitName traitValueImages { traitValue traitImages { ebayImageUrl externalImageUrl } } }
    }
  }
}`;

/** Wenige Angaben je Angebot für die Liste aller laufenden Angebote. */
export const LISTING_LIGHT = `
fragment ListingLight on ListingV2 {
  __typename
  listingId
  sellerProduct { title images { ebayImageUrl externalImageUrl order } }
  items { sku itemTerms { availability { quantityAvailable } pricingTerms { fixedPrice { original { value } } } } }
  ... on VariationListing { sku }
}`;

export const ACTIVE_LISTINGS_QUERY = `
query ActiveListings($input: SellerActiveListingSearchInput) {
  sellerListingSearch {
    activeListings(searchInput: $input) {
      __typename
      ... on SellerListings { listings { listingId listing { ...ListingLight } } pagination { nextCursor totalElements totalPages } }
      ... on SellerListingSearchInvalidInput { errorCode errorMessage validationErrors { errorDescription } }
    }
  }
}
${LISTING_LIGHT}`;

export const LISTING_QUERY = `
query OneListing($input: SellerListingsInput!) {
  sellerListings(input: $input) {
    __typename
    ... on ListingsSuccess {
      listings {
        __typename
        ... on ListingSuccess { listingId listing { ...ListingFull } }
        ... on ListingPartialSuccess { listingId listing { ...ListingFull } errors { errorCode errorMessage } }
      }
    }
    ... on ListingIdsMaxLimitError { errorCode errorMessage }
  }
}
${LISTING_FULL}`;

export const UPDATE_LISTING_MUTATION = `
mutation UpdateListing($input: UpdateListingInput!) {
  updateListing(input: $input) {
    __typename
    ... on UpdateListingSuccess { warnings { warningCode warningMessage } }
    ... on UpdateListingValidationSuccess { warnings { warningCode warningMessage } }
    ... on UpdateListingValidationError { errorCode errorMessage violations { violationCode violationDescription } }
  }
}`;

export const BULK_INVENTORY_MUTATION = `
mutation BulkUpdateInventory($input: BulkUpdateInventoryInput!) {
  bulkUpdateInventory(input: $input) {
    __typename
    ... on BulkUpdateInventorySuccess { successes { listingItemIdentifier { listingId sku } } }
    ... on BulkUpdateInventoryPartialFailure { errorCode errorMessage failures { listingItemIdentifier { listingId sku } violations { violationCode violationDescription } } }
    ... on BulkUpdateInventoryFailure { errorCode errorMessage failures { listingItemIdentifier { listingId sku } violations { violationCode violationDescription } } }
  }
}`;

// ---- Antworttypen (nur was abgefragt wird) ----------------------------------------------------------------

type Money = { original?: { value?: string | number | null; currency?: string | null } | null } | null;
type Addr = { companyName?: string | null; address?: { addressLine1?: string | null; addressLine2?: string | null; city?: string | null; postalCode?: string | null; country?: string | null } | null; contact?: { email?: string | null; phone?: string | null } | null };
export type GqlItem = {
  itemId?: string | null;
  sku?: string | null;
  itemSellerProduct?: { productIdentifiers?: { globalIdentifiers?: { ean?: string | null; upc?: string | null; isbn?: string | null } | null } | null; traits?: { name: string; value: string }[] | null } | null;
  itemTerms?: { availability?: { quantityAvailable?: number | null; quantitySold?: number | null } | null; pricingTerms?: { fixedPrice?: Money } | null } | null;
};
export type GqlListing = {
  /** SingleSkuListing oder VariationListing. */
  __typename?: string;
  listingId: string;
  marketplace?: string | null;
  sku?: string | null;
  sellerProduct?: {
    title?: string | null;
    description?: string | null;
    aspects?: { name?: string | null; values?: string[] | null }[] | null;
    categories?: { primaryCategory?: { categoryId?: string | null; name?: string | null } | null } | null;
    images?: { ebayImageUrl?: string | null; externalImageUrl?: string | null; order?: number | null }[] | null;
    itemCondition?: { itemConditionId?: string | null; displayName?: string | null } | null;
  } | null;
  listingTerms?: {
    listingFormat?: string | null;
    bestOfferTerms?: { acceptBestOffer?: boolean | null } | null;
    lifecycleTerms?: { startAt?: string | null; listingStatus?: string | null } | null;
    listingFulfillmentTerms?: { freeShippingAvailable?: boolean | null; shippingTerms?: { handlingTimeDuration?: string | null; shippingServices?: { rank?: number | null; shippingCostAmount?: Money }[] | null } | null } | null;
    listingReturnTerms?: { domesticReturnTerms?: { returnAccepted?: boolean | null; returnDuration?: string | null; returnShipmentInvoicee?: string | null } | null } | null;
    regulatory?: { manufacturer?: Addr | null; responsiblePersons?: Addr[] | null } | null;
  } | null;
  items?: GqlItem[] | null;
  listingVariations?: {
    variationTraits?: { name?: string | null; values?: string[] | null }[] | null;
    imagesVaryByTrait?: { traitName?: string | null; traitValueImages?: { traitValue?: string | null; traitImages?: { ebayImageUrl?: string | null; externalImageUrl?: string | null }[] | null }[] | null } | null;
  } | null;
};

type ActiveResult = {
  sellerListingSearch: {
    activeListings:
      | { __typename: "SellerListings"; listings?: { listingId: string; listing?: GqlListing | null }[] | null; pagination?: { nextCursor?: string | null; totalElements?: number | null; totalPages?: number | null } | null }
      | { __typename: "SellerListingSearchInvalidInput"; errorCode?: string; errorMessage?: string; validationErrors?: { errorDescription?: string }[] };
  };
};

/** Alle laufenden Angebote (Seite für Seite über den Cursor). */
export async function fetchActiveListings(c: GqlConn, opts: { pageSize?: number; maxPages?: number; fetcher?: typeof fetch } = {}): Promise<GqlListing[]> {
  const out: GqlListing[] = [];
  let cursor: string | null = null;
  for (let page = 1; page <= (opts.maxPages ?? 200); page++) {
    const pagination: Record<string, unknown> = cursor ? { pageCursor: cursor, pageIndex: page } : { maxPageSize: opts.pageSize ?? 100 };
    const d: ActiveResult = await gql<ActiveResult>(c, ACTIVE_LISTINGS_QUERY, { input: { pagination } }, opts.fetcher);
    const r = d.sellerListingSearch.activeListings;
    if (r.__typename !== "SellerListings") throw new ListingApiError(`eBay (Angebotsliste): ${r.errorMessage ?? "ungültige Anfrage"}${r.validationErrors?.length ? ` – ${r.validationErrors.map((v) => v.errorDescription).join("; ")}` : ""}`, r.errorCode ? [r.errorCode] : []);
    for (const l of r.listings ?? []) out.push({ ...(l.listing ?? {}), listingId: l.listing?.listingId ?? l.listingId });
    cursor = r.pagination?.nextCursor || null;
    if (!cursor) break;
  }
  return out;
}

type OneResult = {
  sellerListings:
    | { __typename: "ListingsSuccess"; listings: ({ __typename: "ListingSuccess"; listingId: string; listing?: GqlListing | null } | { __typename: "ListingPartialSuccess"; listingId: string; listing?: GqlListing | null; errors?: { errorCode?: string; errorMessage?: string }[] })[] }
    | { __typename: "ListingIdsMaxLimitError"; errorCode?: string; errorMessage?: string }
    | null;
};

/** Ein Angebot mit allen Angaben. Teilweise gelieferte Angebote gelten als vollständig genug, wenn das Angebot selbst da ist. */
export async function fetchListing(c: GqlConn, listingId: string, fetcher?: typeof fetch): Promise<GqlListing> {
  const d = await gql<OneResult>(c, LISTING_QUERY, { input: { listings: [{ listingId }] } }, fetcher);
  const r = d.sellerListings;
  if (!r || r.__typename !== "ListingsSuccess") throw new ListingApiError(`eBay (Angebot ${listingId}): ${(r && "errorMessage" in r && r.errorMessage) || "nicht gefunden"}`);
  const hit = r.listings.find((l) => l.listingId === listingId) ?? r.listings[0];
  if (!hit?.listing) throw new ListingApiError(`eBay (Angebot ${listingId}): ${hit && "errors" in hit && hit.errors?.length ? hit.errors.map((e) => e.errorMessage).join("; ") : "nicht gefunden"}`);
  return { ...hit.listing, listingId: hit.listing.listingId ?? hit.listingId };
}

type UpdateResult = { updateListing: { __typename: string; warnings?: { warningMessage?: string }[]; errorMessage?: string; violations?: { violationDescription?: string }[] } | null };

/** Angebot ändern (Titel, Merkmale, Beschreibung, Bilder, Preisvorschlag). Listen werden von eBay vollständig ersetzt. */
export async function updateListing(c: GqlConn, input: Record<string, unknown>, fetcher?: typeof fetch): Promise<{ warnings: string[] }> {
  const d = await gql<UpdateResult>(c, UPDATE_LISTING_MUTATION, { input }, fetcher);
  const r = d.updateListing;
  if (!r) throw new ListingApiError("eBay (Angebot ändern): keine Antwort.");
  if (r.__typename === "UpdateListingValidationError") throw new ListingApiError(`eBay (Angebot ändern): ${[r.errorMessage, ...(r.violations ?? []).map((v) => v.violationDescription)].filter(Boolean).join(" | ") || "abgelehnt"}`);
  return { warnings: (r.warnings ?? []).map((w) => w.warningMessage ?? "").filter(Boolean) };
}

type InvResult = { bulkUpdateInventory: { __typename: string; errorMessage?: string; failures?: { listingItemIdentifier?: { listingId?: string; sku?: string }; violations?: { violationDescription?: string }[] }[] } | null };

/** Menge und/oder Preis setzen (höchstens 4 Positionen je Aufruf). */
export async function bulkUpdateInventory(c: GqlConn, inventory: { listingId: string; sku?: string | null; availableQuantity?: number; fixedPrice?: number }[], fetcher?: typeof fetch): Promise<void> {
  for (let i = 0; i < inventory.length; i += 4) {
    const chunk = inventory.slice(i, i + 4).map((x) => ({
      listingItemIdentifier: { listingId: x.listingId, ...(x.sku ? { sku: x.sku } : {}) },
      ...(x.availableQuantity !== undefined ? { availableQuantity: Math.max(0, Math.floor(x.availableQuantity)) } : {}),
      ...(x.fixedPrice !== undefined ? { fixedPrice: x.fixedPrice.toFixed(2) } : {}),
    }));
    const d = await gql<InvResult>(c, BULK_INVENTORY_MUTATION, { input: { inventory: chunk } }, fetcher);
    const r = d.bulkUpdateInventory;
    if (!r) throw new ListingApiError("eBay (Menge/Preis): keine Antwort.");
    if (r.__typename !== "BulkUpdateInventorySuccess") {
      const why = (r.failures ?? []).flatMap((f) => (f.violations ?? []).map((v) => v.violationDescription)).filter(Boolean);
      throw new ListingApiError(`eBay (Menge/Preis): ${[r.errorMessage, ...why].filter(Boolean).join(" | ") || "abgelehnt"}`);
    }
  }
}
