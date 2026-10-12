import { parseFilmDetails, parseWatchlistPage } from './parser.mjs';

export const CATALOG_ID = 'letterboxd-watchlist';
export const LB_PAGE_SIZE = 28; // Letterboxd's public grid page size at time of development.
export const CATALOG_PAGE_SIZE = 100; // Stremio/Nuvio use 100-item catalog pagination.
const MINUTE = 60_000;
const USER_AGENT = 'CommunityLetterboxdCatalogue/1.0 (public watchlists; no authentication)';

export function normaliseUsername(input) {
  if (typeof input !== 'string') throw Object.assign(new Error('Invalid Letterboxd username'), { status: 400 });
  const username = input.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(username)) {
    throw Object.assign(new Error('Use a Letterboxd username containing letters, numbers, underscores or hyphens (maximum 32 characters).'), { status: 400 });
  }
  return username;
}

export function manifestFor(usernameInput) {
  const username = normaliseUsername(usernameInput);
  // Unique per user: installing two different watchlists does not overwrite one another.
  const accountHex = Buffer.from(username, 'utf8').toString('hex');
  return {
    id: `community.letterboxd.watchlist.${accountHex}`,
    version: '1.1.0',
    name: `Letterboxd Watchlist (${username})`,
    description: 'Browse a public Letterboxd watchlist in Nuvio or other Stremio-compatible apps. No streaming content is provided.',
    resources: ['catalog', { name: 'meta', types: ['movie'], idPrefixes: ['letterboxd:', 'tmdb:'] }],
    types: ['movie'],
    catalogs: [{ type: 'movie', id: CATALOG_ID, name: 'Letterboxd Watchlist', extra: [{ name: 'skip', isRequired: false }] }],
    behaviorHints: { configurable: true },
  };
}

async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}

/**
 * Public HTML only; shared film mappings, isolated per-account watchlist pages.
 * Everything is cached in memory and cleared when the process restarts. No DB,
 * tracking, account credentials, or API keys are collected or needed.
 */
export class WatchlistService {
  constructor({ fetchImpl = globalThis.fetch, now = () => Date.now(), pageTtl = 15 * MINUTE,
    idTtl = 7 * 24 * 60 * MINUTE, concurrency = 7, requestTimeout = 15_000,
    throttleMs = 160, cacheLimit = 20_000 } = {}) {
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.pageTtl = pageTtl;
    this.idTtl = idTtl;
    this.concurrency = concurrency;
    this.requestTimeout = requestTimeout;
    this.throttleMs = throttleMs;
    this.cacheLimit = cacheLimit;
    this.nextRequestTime = 0;
    this.requestQueue = Promise.resolve();
    this.cache = new Map();
    this.inflight = new Map();
    this.metaById = new Map();
  }

  async cached(key, ttl, loader) {
    const previous = this.cache.get(key);
    if (previous?.until > this.now()) {
      this.cache.delete(key);
      this.cache.set(key, previous); // LRU
      return previous.value;
    }
    if (this.inflight.has(key)) return this.inflight.get(key);
    const work = (async () => {
      try {
        const value = await loader();
        this.cache.delete(key);
        this.cache.set(key, { until: this.now() + ttl, value });
        while (this.cache.size > this.cacheLimit) this.cache.delete(this.cache.keys().next().value);
        return value;
      } catch (error) {
        // An earlier successful fetch can still be used during a transient outage.
        if (previous) return previous.value;
        throw error;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, work);
    return work;
  }

  async paceRequest() {
    const step = this.requestQueue.then(async () => {
      const wait = Math.max(0, this.nextRequestTime - Date.now());
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      this.nextRequestTime = Date.now() + this.throttleMs;
    });
    this.requestQueue = step.catch(() => {});
    await step;
  }

  async getHtml(path) {
    // No caller-supplied hosts, credentials, redirects or arbitrary URLs.
    await this.paceRequest();
    const response = await this.fetchImpl(`https://letterboxd.com${path}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(this.requestTimeout),
      redirect: 'error',
    });
    if (!response.ok) {
      const message = response.status === 404
        ? 'Letterboxd returned 404. Check that the account/watchlist is public.'
        : `Letterboxd returned HTTP ${response.status}. The site may be rate-limiting this host.`;
      throw Object.assign(new Error(message), { status: response.status });
    }
    const html = await response.text();
    if (!html || /just a moment\.{0,3}(?:<|\s)|cf-chl-/i.test(html)) {
      throw new Error('Letterboxd returned a blank page or an access challenge.');
    }
    return html;
  }

  page(usernameInput, page) {
    const username = normaliseUsername(usernameInput);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) {
      throw Object.assign(new Error('Invalid Letterboxd page'), { status: 400 });
    }
    return this.cached(`page:${username}:${page}`, this.pageTtl, async () => {
      const path = page === 1
        ? `/${username}/watchlist/`
        : `/${username}/watchlist/page/${page}/`;
      const films = parseWatchlistPage(await this.getHtml(path));
      if (!films.length) {
        throw new Error('No films found. The watchlist could be empty/private, the account invalid, or Letterboxd may have changed its HTML.');
      }
      return films;
    });
  }

  ids(slug) {
    if (!/^[\p{L}\p{N}_-]{1,180}$/u.test(slug)) {
      throw Object.assign(new Error('Invalid film slug'), { status: 400 });
    }
    return this.cached(`film:${slug}`, this.idTtl, async () => {
      const ids = parseFilmDetails(await this.getHtml(`/film/${encodeURIComponent(slug)}/`));
      return ids;
    });
  }

  async filmToMeta(film) {
    let ids = {};
    try {
      ids = await this.ids(film.slug);
    } catch {
      // Keep the film in the catalog when a mapping request fails.
      // This fallback ID may not work with third-party playback add-ons.
    }
    const id = ids.imdbId || (ids.tmdbId ? `tmdb:${ids.tmdbId}` : `letterboxd:${film.slug}`);
    const meta = {
      id,
      type: 'movie',
      name: film.name,
      ...(film.year ? { releaseInfo: String(film.year) } : {}),
      ...(film.poster || ids.poster ? { poster: film.poster || ids.poster, posterShape: 'poster' } : {}),
    };
    this.metaById.delete(id);
    this.metaById.set(id, meta);
    while (this.metaById.size > this.cacheLimit) this.metaById.delete(this.metaById.keys().next().value);
    return meta;
  }

  async getCatalog(usernameInput, skip = 0) {
    const username = normaliseUsername(usernameInput);
    if (!Number.isSafeInteger(skip) || skip < 0 || skip > 500_000) {
      throw Object.assign(new Error('skip must be an integer between 0 and 500000'), { status: 400 });
    }
    let page = Math.floor(skip / LB_PAGE_SIZE) + 1;
    let offset = skip % LB_PAGE_SIZE;
    const selected = [];
    while (selected.length < CATALOG_PAGE_SIZE) {
      let films;
      try {
        films = await this.page(username, page);
      } catch (error) {
        if (page > 1 && error.status === 404) break;
        throw error;
      }
      selected.push(...films.slice(offset, offset + CATALOG_PAGE_SIZE - selected.length));
      if (films.length < LB_PAGE_SIZE) break;
      page++;
      offset = 0;
    }
    return { metas: await mapLimited(selected, this.concurrency, film => this.filmToMeta(film)) };
  }

  getMeta(id) { return this.metaById.get(id); }
}
