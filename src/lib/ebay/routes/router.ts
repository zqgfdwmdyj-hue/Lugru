/**
 * Schlanker Ersatz für den Express-Router des bisherigen Tools: dieselbe Schreibweise
 * (`r.get('/attempts/:id', h(async (req, res) => …))`), ausgeführt in einem
 * Next.js-Route-Handler. So bleiben die Routen fast unverändert.
 */

export interface Request {
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

export class Response {
  statusCode = 200;
  headers: Record<string, string> = {};
  payload: BodyInit | null = null;
  done = false;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  setHeader(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }
  type(t: string): this {
    this.headers['Content-Type'] = t === 'text/plain' ? 'text/plain; charset=utf-8' : t;
    return this;
  }
  json(value: unknown): void {
    this.headers['Content-Type'] = 'application/json; charset=utf-8';
    this.payload = JSON.stringify(value ?? null);
    this.done = true;
  }
  send(data: Buffer | Uint8Array | string): void {
    this.payload = typeof data === 'string' ? data : new Uint8Array(data);
    this.done = true;
  }
  toResponse(): globalThis.Response {
    return new globalThis.Response(this.payload, { status: this.statusCode, headers: this.headers });
  }
}

export type NextFunction = (err?: unknown) => void;
export type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        keys.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { pattern: new RegExp(`^${source}/?$`), keys };
}

export class Router {
  private routes: Route[] = [];

  private add(method: string, path: string, handler: Handler) {
    this.routes.push({ method, ...compile(path), handler });
  }
  get(path: string, handler: Handler) {
    this.add('GET', path, handler);
  }
  post(path: string, handler: Handler) {
    this.add('POST', path, handler);
  }
  put(path: string, handler: Handler) {
    this.add('PUT', path, handler);
  }
  patch(path: string, handler: Handler) {
    this.add('PATCH', path, handler);
  }
  delete(path: string, handler: Handler) {
    this.add('DELETE', path, handler);
  }

  /** Sucht die passende Route; liefert null, wenn keine passt. */
  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.pattern.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { handler: r.handler, params };
    }
    return null;
  }
}

/** Wie im bisherigen Tool: Fehler aus asynchronen Handlern an die zentrale Fehlerbehandlung geben. */
export function h(fn: (req: Request, res: Response) => Promise<void> | void): Handler {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };
}
