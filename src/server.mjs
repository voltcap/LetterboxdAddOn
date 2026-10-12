import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CATALOG_ID, WatchlistService, manifestFor, normaliseUsername } from './catalog.mjs';

const PUBLIC = new URL('../public/', import.meta.url);
const assets = await Promise.all(['index.html', 'app.css', 'app.js'].map(async filename =>
  [filename, await readFile(new URL(filename, PUBLIC), 'utf8')]
)).then(entries => new Map(entries));

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

export function createAddonServer(service = new WatchlistService()) {
  return createServer(async (request, response) => {
    function send(status, data, contentType = 'application/json; charset=utf-8', seconds = 0) {
      response.writeHead(status, {
        ...HEADERS,
        'Content-Type': contentType,
        'Cache-Control': `public, max-age=${seconds}`,
        ...(contentType.startsWith('text/html') ? { 'Content-Security-Policy': CSP } : {}),
      });
      response.end(request.method === 'HEAD' ? '' : contentType.startsWith('application/json') ? JSON.stringify(data) : data);
    }
    const sendJson = (status, data, seconds = 0) => send(status, data, 'application/json; charset=utf-8', seconds);

    if (request.method === 'OPTIONS') return sendJson(200, {});
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(405, { error: 'Method not allowed' });

    try {
      const url = new URL(request.url, 'http://localhost');
      const path = url.pathname;
      if (path === '/' || path === '/configure') return send(200, assets.get('index.html'), 'text/html; charset=utf-8');
      if (path === '/app.css') return send(200, assets.get('app.css'), 'text/css; charset=utf-8', 3600);
      if (path === '/app.js') return send(200, assets.get('app.js'), 'text/javascript; charset=utf-8', 3600);
      if (path === '/health') return sendJson(200, { ok: true });
      if (path === '/manifest.json') return sendJson(400, { error: 'Choose a public Letterboxd username on the home page to get your personal manifest URL.' });

      const route = path.match(/^\/u\/([A-Za-z0-9_-]{1,32})\/(.*)$/);
      if (!route) return sendJson(404, { error: 'Not found' });
      const username = normaliseUsername(route[1]);
      const resource = route[2];

      if (resource === 'manifest.json') return sendJson(200, manifestFor(username), 300);
      const catalogPattern = new RegExp(`^catalog/movie/${CATALOG_ID}(?:/skip=(\\d+))?\\.json$`);
      const catalogMatch = resource.match(catalogPattern);
      if (catalogMatch) {
        const skip = catalogMatch[1] === undefined ? 0 : Number(catalogMatch[1]);
        return sendJson(200, await service.getCatalog(username, skip), 300);
      }
      if (resource.startsWith(`catalog/movie/${CATALOG_ID}`)) {
        return sendJson(400, { error: 'Unsupported catalog parameter. Use skip=100, skip=200, etc.' });
      }
      const metaMatch = resource.match(/^meta\/movie\/(letterboxd:[^/]+|tmdb:\d+)\.json$/);
      if (metaMatch) {
        const id = metaMatch[1];
        const meta = service.getMeta(id);
        return meta ? sendJson(200, { meta }, 3600) : sendJson(404, {
          error: 'Metadata not cached yet. Browse the catalog before requesting this fallback film ID.',
        });
      }
      return sendJson(404, { error: 'Not found' });
    } catch (error) {
      // Avoid printing personal usernames, request paths, or profile information in logs.
      console.error('[addon] Request failed:', error.status ?? 'upstream/error');
      const status = error.status === 400 ? 400 : 502;
      sendJson(status, { error: error.message || 'Watchlist temporarily unavailable' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
  createAddonServer().listen(port, '0.0.0.0', () => {
    console.log(`Community Letterboxd catalogue running on port ${port}`);
  });
}
