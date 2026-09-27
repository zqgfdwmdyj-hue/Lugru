import type { Db } from '../db/db';
import { getToken, saveToken } from '../db/db';
import type { Settings } from '../types';
import { apiBase, consentBase, SCOPES_APP, SCOPES_USER, SCOPES_USER_LEGACY, SCOPES_USER_READONLY } from './config';

const EXPIRY_SKEW_MS = 5 * 60_000;

export function isExpired(expiresAtIso: string, skewMs: number = EXPIRY_SKEW_MS): boolean {
  return Date.parse(expiresAtIso) - skewMs <= Date.now();
}

/**
 * Anmelde-Adresse für die eBay-Zustimmung. `withOrders: false` lässt die
 * Berechtigung zum Lesen von Bestellungen weg — für Entwicklerzugänge, bei
 * denen eBay sie ablehnt; alles außer den Rechnungen funktioniert dann trotzdem.
 */
export function buildConsentUrl(settings: Settings, opts: { withOrders?: boolean } = {}): string {
  requireKeys(settings);
  if (!settings.ruName || settings.ruName.trim() === '') {
    throw new Error(
      `RuName fehlt: Bitte in den Einstellungen den ${settings.env}-RuName eintragen. ` +
        'Du findest ihn auf developer.ebay.com unter Application Keys → User Tokens → „Get a Token from eBay via Your Application" → eBay Redirect URL (siehe SETUP.md, Schritt 3).'
    );
  }
  const scopes = opts.withOrders === false ? SCOPES_USER_LEGACY : SCOPES_USER;
  // Von Hand zusammengesetzt statt über URLSearchParams: das kodiert Leerzeichen
  // als „+", eBays Beispiele trennen die Scopes aber mit %20.
  const params = [
    ['client_id', settings.clientId!],
    ['redirect_uri', settings.ruName.trim()],
    ['response_type', 'code'],
    ['scope', scopes.join(' ')],
  ].map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  return `${consentBase(settings.env)}/oauth2/authorize?${params.join('&')}`;
}

/**
 * Hilfetext, wenn eBay die Anmeldung schon beim Aufruf ablehnt (Fehlerseite
 * …/oauth2/errorOauth?errorId=invalid_request). Dann gibt es keinen Code —
 * die Ursache liegt in Client ID, RuName oder den angefragten Berechtigungen.
 */
export const CONSENT_REJECTED_HELP =
  'eBay hat die Anmeldung abgelehnt, bevor du zustimmen konntest („invalid_request"). Häufige Ursachen:\n' +
  '  0. Die Adresse kam unvollständig im Browser an. Dann die Adresse aus diesem Fenster komplett markieren,\n' +
  '     kopieren und von Hand in die Adresszeile des Browsers einfügen.\n' +
  '  1. Der RuName passt nicht zur Client ID — z.B. ein Sandbox-RuName bei Production oder ein Tippfehler.\n' +
  '     Der RuName steht auf developer.ebay.com → Application Keys → User Tokens → eBay Redirect URL\n' +
  '     (nicht der Anzeigename und nicht die „auth accepted URL").\n' +
  '  2. Die Berechtigung „Bestellungen lesen" (für Rechnungen) ist für deinen Entwicklerzugang nicht freigegeben.\n' +
  '     Dann ohne diese Berechtigung verbinden — alles außer Rechnungen funktioniert.\n' +
  '  3. Client ID aus der falschen Umgebung (Sandbox statt Production).';

export class ConsentRejectedError extends Error {
  constructor() {
    super(CONSENT_REJECTED_HELP);
  }
}

export function extractCodeFromRedirectUrl(redirectUrl: string): string {
  const raw = redirectUrl.trim();
  if (raw === '') throw new Error('Es wurde nichts eingefügt. Bitte die komplette Adresse aus der Browser-Adresszeile kopieren (Rechtsklick ins Fenster fügt ein).');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Das sieht nicht nach einer vollständigen URL aus. Bitte die komplette Adresse aus der Browser-Adresszeile kopieren.');
  }
  const errorId = url.searchParams.get('errorId') ?? url.searchParams.get('error');
  if (url.pathname.includes('errorOauth') || errorId) {
    if (errorId === 'access_denied') throw new Error('Die Zustimmung wurde bei eBay abgelehnt. Bitte erneut verbinden und auf „Zustimmen" klicken.');
    throw new ConsentRejectedError();
  }
  const code = url.searchParams.get('code');
  if (!code) throw new Error('In der URL fehlt der code-Parameter. Bitte die Weiterleitungs-URL direkt nach der eBay-Zustimmung kopieren.');
  return code;
}

function requireKeys(settings: Settings): void {
  if (!settings.clientId || !settings.clientSecret) {
    throw new Error(`App-Keys fehlen: Bitte in den Einstellungen Client ID und Client Secret für ${settings.env} hinterlegen.`);
  }
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

async function tokenRequest(settings: Settings, body: URLSearchParams): Promise<TokenResponse> {
  requireKeys(settings);
  const res = await fetch(`${apiBase(settings.env)}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail = json.error_description ?? json.error ?? `HTTP ${res.status}`;
    throw new Error(`eBay-Token-Anfrage fehlgeschlagen: ${detail}`);
  }
  return json as unknown as TokenResponse;
}

function expiryIso(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export async function getAppAccessToken(db: Db, settings: Settings): Promise<string> {
  const cached = await getToken(db, settings.env, 'app');
  if (cached && !isExpired(cached.accessExpiresAt)) return cached.accessToken;

  const t = await tokenRequest(
    settings,
    new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPES_APP.join(' ') })
  );
  await saveToken(db, settings.env, 'app', {
    accessToken: t.access_token,
    accessExpiresAt: expiryIso(t.expires_in),
  });
  return t.access_token;
}

/** Prüft Client ID und Secret mit einer App-Token-Anfrage, ohne etwas zu speichern. */
export async function checkClientCredentials(settings: Settings): Promise<void> {
  await tokenRequest(settings, new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPES_APP.join(' ') }));
}

export async function exchangeCode(db: Db, settings: Settings, code: string): Promise<void> {
  const t = await tokenRequest(
    settings,
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: settings.ruName ?? '' })
  );
  await saveToken(db, settings.env, 'user', {
    accessToken: t.access_token,
    accessExpiresAt: expiryIso(t.expires_in),
    refreshToken: t.refresh_token,
    refreshExpiresAt: t.refresh_token_expires_in ? expiryIso(t.refresh_token_expires_in) : undefined,
  });
}

export async function refreshUserToken(db: Db, settings: Settings): Promise<string> {
  const stored = await getToken(db, settings.env, 'user');
  if (!stored?.refreshToken) throw new Error('NOT_CONNECTED');

  const refresh = (scopes: string[]) =>
    tokenRequest(
      settings,
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: stored.refreshToken!, scope: scopes.join(' ') })
    );
  // Die Verbindung kann aus verschiedenen Zeiten stammen: mit Schreibrecht für Bestellungen
  // (Seller-System), nur lesend (Rechnungen im bisherigen Tool) oder ganz ohne Bestellungen.
  // eBay lehnt einen Refresh mit mehr Scopes als zugestimmt ab — deshalb der Reihe nach.
  let t: TokenResponse | undefined;
  let lastErr: unknown;
  for (const scopes of [SCOPES_USER, SCOPES_USER_READONLY, SCOPES_USER_LEGACY]) {
    try {
      t = await refresh(scopes);
      break;
    } catch (err) {
      lastErr = err;
      if (!(err instanceof Error && /scope/i.test(err.message))) throw err;
    }
  }
  if (!t) throw lastErr;
  await saveToken(db, settings.env, 'user', {
    accessToken: t.access_token,
    accessExpiresAt: expiryIso(t.expires_in),
    // eBay liefert beim Refresh keinen neuen Refresh-Token — den alten behalten.
    refreshToken: t.refresh_token ?? stored.refreshToken,
    refreshExpiresAt: t.refresh_token_expires_in ? expiryIso(t.refresh_token_expires_in) : stored.refreshExpiresAt,
  });
  return t.access_token;
}

export async function getUserAccessToken(db: Db, settings: Settings): Promise<string> {
  const stored = await getToken(db, settings.env, 'user');
  if (!stored?.refreshToken) throw new Error('NOT_CONNECTED');
  if (!isExpired(stored.accessExpiresAt)) return stored.accessToken;
  return refreshUserToken(db, settings);
}
