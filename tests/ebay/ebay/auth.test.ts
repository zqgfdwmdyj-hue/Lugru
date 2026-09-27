import { afterEach, describe, expect, it, vi } from 'vitest';
import {saveToken, getToken} from '@/lib/ebay/db/db';
import type { Db } from '@/lib/ebay/db/db';
import { openMemoryDb } from '@/lib/ebay/db/memory';
import type { Settings } from '@/lib/ebay/types';
import {
  buildConsentUrl,
  extractCodeFromRedirectUrl,
  isExpired,
  getAppAccessToken,
  getUserAccessToken,
} from '@/lib/ebay/ebay/auth';

const settings: Settings = {
  env: 'sandbox',
  clientId: 'my-client',
  clientSecret: 'my-secret',
  ruName: 'Pascal-Witti-abcd-efgh',
};

function tokenResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(async () => {
  vi.unstubAllGlobals();
});

describe('buildConsentUrl', () => {
  it('trennt Scopes mit %20 und lässt auf Wunsch die Bestell-Berechtigung weg', async () => {
    const full = buildConsentUrl(settings);
    expect(full).toContain('%20');
    expect(full).not.toContain('+');
    // Seller-System: Bestellungen auch bearbeiten (Sendungsnummer zurückmelden).
    expect(full).toContain('sell.fulfillment');
    expect(full).not.toContain('sell.fulfillment.readonly');
    expect(buildConsentUrl(settings, { withOrders: false })).not.toContain('sell.fulfillment');
  });

  it('baut die Sandbox-Consent-URL mit RuName und Scopes', async () => {
    const url = buildConsentUrl(settings);
    expect(url.startsWith('https://auth.sandbox.ebay.com/oauth2/authorize?')).toBe(true);
    const u = new URL(url);
    expect(u.searchParams.get('client_id')).toBe('my-client');
    expect(u.searchParams.get('redirect_uri')).toBe('Pascal-Witti-abcd-efgh');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toContain('sell.inventory');
    expect(u.searchParams.get('scope')).toContain('sell.account');
    expect(u.searchParams.get('scope')).toContain('sell.fulfillment');
  });

  it('nutzt für production auth.ebay.com', async () => {
    const url = buildConsentUrl({ ...settings, env: 'production' });
    expect(url.startsWith('https://auth.ebay.com/')).toBe(true);
  });

  it('wirft ohne RuName eine verständliche Meldung statt eine kaputte URL zu bauen', async () => {
    expect(() => buildConsentUrl({ ...settings, ruName: undefined })).toThrow(/RuName/);
    expect(() => buildConsentUrl({ ...settings, ruName: '  ' })).toThrow(/RuName/);
  });
});

describe('extractCodeFromRedirectUrl — eBay-Fehlerseiten', () => {
  it('erkennt die abgelehnte Anmeldung und nennt die Ursachen', async () => {
    expect(() => extractCodeFromRedirectUrl('https://auth2.ebay.com/oauth2/errorOauth?errorId=invalid_request')).toThrow(/RuName passt nicht/);
    expect(() => extractCodeFromRedirectUrl('https://www.ebay.de/?error=access_denied')).toThrow(/abgelehnt/);
    expect(() => extractCodeFromRedirectUrl('   ')).toThrow(/nichts eingefügt/);
  });
});

describe('extractCodeFromRedirectUrl', () => {
  it('extrahiert und decodiert den code-Parameter', async () => {
    const code = extractCodeFromRedirectUrl(
      'https://example.com/cb?code=v%5E1.1%23i%5E1%23f%5E0&expires_in=299'
    );
    expect(code).toBe('v^1.1#i^1#f^0');
  });

  it('wirft bei fehlendem code eine verständliche Meldung', async () => {
    expect(() => extractCodeFromRedirectUrl('https://example.com/cb?foo=1')).toThrow(/code/i);
    expect(() => extractCodeFromRedirectUrl('kein url')).toThrow();
  });
});

describe('isExpired', () => {
  it('abgelaufen bzw. innerhalb des Sicherheitspuffers → true', async () => {
    expect(isExpired(new Date(Date.now() - 1000).toISOString())).toBe(true);
    expect(isExpired(new Date(Date.now() + 60_000).toISOString())).toBe(true); // < 5 min Puffer
  });
  it('weit in der Zukunft → false', async () => {
    expect(isExpired(new Date(Date.now() + 60 * 60_000).toISOString())).toBe(false);
  });
});

describe('getAppAccessToken', () => {
  it('holt per client_credentials und cached danach', async () => {
    const db = openMemoryDb();
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.sandbox.ebay.com/identity/v1/oauth2/token');
      const auth = (init?.headers as Record<string, string>).Authorization;
      expect(auth).toBe('Basic ' + Buffer.from('my-client:my-secret').toString('base64'));
      const body = String(init?.body);
      expect(body).toContain('grant_type=client_credentials');
      return tokenResponse({ access_token: 'app-tok-1', expires_in: 7200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await getAppAccessToken(db, settings)).toBe('app-tok-1');
    expect(await getAppAccessToken(db, settings)).toBe('app-tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('erneuert einen abgelaufenen App-Token', async () => {
    const db = openMemoryDb();
    await saveToken(db, 'sandbox', 'app', {
      accessToken: 'alt',
      accessExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse({ access_token: 'neu', expires_in: 7200 })));
    expect(await getAppAccessToken(db, settings)).toBe('neu');
  });

  it('wirft ohne App-Keys einen klaren Fehler', async () => {
    const db = openMemoryDb();
    await expect(getAppAccessToken(db, { env: 'sandbox' })).rejects.toThrow(/App-Keys/);
  });
});

describe('getUserAccessToken', () => {
  it('wirft NOT_CONNECTED ohne gespeicherte Verbindung', async () => {
    const db = openMemoryDb();
    await expect(getUserAccessToken(db, settings)).rejects.toThrow('NOT_CONNECTED');
  });

  it('liefert gültigen Access-Token ohne fetch', async () => {
    const db = openMemoryDb();
    await saveToken(db, 'sandbox', 'user', {
      accessToken: 'user-tok',
      accessExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      refreshToken: 'refresh-1',
      refreshExpiresAt: new Date(Date.now() + 999 * 86400_000).toISOString(),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await getUserAccessToken(db, settings)).toBe('user-tok');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refresht abgelaufenen Access-Token und behält den Refresh-Token', async () => {
    const db = openMemoryDb();
    await saveToken(db, 'sandbox', 'user', {
      accessToken: 'alt',
      accessExpiresAt: new Date(Date.now() - 1000).toISOString(),
      refreshToken: 'refresh-1',
      refreshExpiresAt: new Date(Date.now() + 999 * 86400_000).toISOString(),
    });
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = String(init?.body);
      expect(body).toContain('grant_type=refresh_token');
      expect(body).toContain('refresh_token=refresh-1');
      return tokenResponse({ access_token: 'frisch', expires_in: 7200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await getUserAccessToken(db, settings)).toBe('frisch');
    const stored = await getToken(db, 'sandbox', 'user');
    expect(stored?.refreshToken).toBe('refresh-1');
    expect(stored?.accessToken).toBe('frisch');
  });

  it('fällt bei alten Verbindungen ohne Bestell-Scope auf die bisherigen Scopes zurück', async () => {
    const db = openMemoryDb();
    await saveToken(db, 'sandbox', 'user', {
      accessToken: 'alt',
      accessExpiresAt: new Date(Date.now() - 1000).toISOString(),
      refreshToken: 'refresh-1',
    });
    const scopes: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      const scope = new URLSearchParams(String(init?.body)).get('scope') ?? '';
      scopes.push(scope);
      if (scope.includes('sell.fulfillment')) {
        return new Response(JSON.stringify({ error: 'invalid_scope', error_description: 'The requested scope is invalid' }), { status: 400 });
      }
      return tokenResponse({ access_token: 'ohne-bestellungen', expires_in: 7200 });
    }));
    expect(await getUserAccessToken(db, settings)).toBe('ohne-bestellungen');
    // Erst mit Schreibrecht, dann nur lesend, dann ohne Bestellungen.
    expect(scopes).toHaveLength(3);
    expect(scopes[1]).toContain('sell.fulfillment.readonly');
    expect(scopes[2]).not.toContain('sell.fulfillment');
  });

  it('nimmt bei Verbindungen des bisherigen Tools die nur lesende Bestell-Berechtigung', async () => {
    const db = openMemoryDb();
    await saveToken(db, 'sandbox', 'user', {
      accessToken: 'alt',
      accessExpiresAt: new Date(Date.now() - 1000).toISOString(),
      refreshToken: 'refresh-1',
    });
    const scopes: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      const scope = new URLSearchParams(String(init?.body)).get('scope') ?? '';
      scopes.push(scope);
      if (!scope.includes('sell.fulfillment.readonly')) {
        return new Response(JSON.stringify({ error: 'invalid_scope', error_description: 'The requested scope is invalid' }), { status: 400 });
      }
      return tokenResponse({ access_token: 'nur-lesen', expires_in: 7200 });
    }));
    expect(await getUserAccessToken(db, settings)).toBe('nur-lesen');
    expect(scopes).toHaveLength(2);
  });

  it('meldet eBay-Fehlerdetails beim Token-Tausch', async () => {
    const db = openMemoryDb();
    await saveToken(db, 'sandbox', 'user', {
      accessToken: 'alt',
      accessExpiresAt: new Date(Date.now() - 1000).toISOString(),
      refreshToken: 'kaputt',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'refresh token abgelaufen' }), { status: 400 }))
    );
    await expect(getUserAccessToken(db, settings)).rejects.toThrow(/refresh token abgelaufen/);
  });
});
