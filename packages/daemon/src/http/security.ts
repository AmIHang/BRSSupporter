import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Origins of the Tauri webview (Windows uses http(s)://tauri.localhost). */
export const DEFAULT_ALLOWED_ORIGINS = [
  'http://tauri.localhost',
  'https://tauri.localhost',
  'tauri://localhost',
];

const CORS_ALLOW_HEADERS = [
  'Authorization',
  'Content-Type',
  'Last-Event-ID',
  'Mcp-Session-Id',
  'Mcp-Protocol-Version',
].join(', ');

function deny(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

/**
 * DNS-rebinding protection: a rebound hostname still sends its own name in `Host`,
 * so only literal loopback names with our port are accepted.
 */
export function hostCheck(getPort: () => number): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const host = (req.headers.host ?? '').toLowerCase();
    const port = getPort();
    if (host === `127.0.0.1:${port}` || host === `localhost:${port}`) return next();
    deny(res, 403, 'forbidden_host');
  };
}

/**
 * Browsers always send `Origin` on cross-origin requests. Native clients (MCP, curl) send none.
 * Unknown origins (including `null`) are rejected; allowed ones get CORS headers so the
 * Tauri webview can call the API. Preflights are answered here, before authentication.
 */
export function originCheck(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins.map((o) => o.toLowerCase()));
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin === undefined) return next();
    if (!allowed.has(origin.toLowerCase())) return deny(res, 403, 'forbidden_origin');

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
      res.setHeader('Access-Control-Max-Age', '600');
      res.status(204).end();
      return;
    }
    next();
  };
}
