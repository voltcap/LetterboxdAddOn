/** Parse only public film metadata. This intentionally uses no credentials or API keys. */
const named = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…',
};

export function decodeHtml(value = '') {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, entity) => {
    if (entity.startsWith('#')) {
      const code = entity[1].toLowerCase() === 'x'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function attributes(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    out[m[1].toLowerCase()] = decodeHtml(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

function publicPoster(attrs) {
  for (const name of ['data-src', 'data-poster', 'src', 'srcset']) {
    const src = attrs[name]?.split(/\s*,\s*/)[0]?.split(/\s+\d+[wx]$/)[0];
    if (!src || /empty-poster|^data:|\.svg(?:\?|$)/i.test(src)) continue;
    try {
      const url = new URL(src, 'https://letterboxd.com');
      if (url.protocol === 'https:' && (url.hostname === 'letterboxd.com' || url.hostname.endsWith('.ltrbxd.com'))) {
        return url.href;
      }
    } catch { /* ignore malformed image attribute */ }
  }
  return undefined;
}

/** All posters on a Letterboxd watchlist page, in its displayed order. */
export function parseWatchlistPage(html) {
  const films = [];
  const seen = new Set();
  const tags = [...String(html).matchAll(/<div\b[^>]*>/gi)];
  for (let index = 0; index < tags.length; index++) {
    const [tag] = tags[index];
    if (!/\bdata-(?:component-class|item-slug|film-slug)\s*=/i.test(tag)) continue;
    const a = attributes(tag);
    if (a['data-component-class'] !== 'LazyPoster' && !a['data-item-slug']) continue;
    const slug = a['data-item-slug'] || a['data-film-slug'];
    if (!slug || !/^[\p{L}\p{N}_-]{1,180}$/u.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    const rawName = a['data-item-name'] || a['data-film-name'] || slug.replace(/-/g, ' ');
    const fullName = a['data-item-full-display-name'] || a['data-item-full-name'] || rawName;
    const yearMatch = fullName.match(/\((\d{4})\)\s*$/);
    const name = rawName.replace(/\s*\(\d{4}\)\s*$/, '').trim();
    // Some poster images are nested within the LazyPoster element. Do not
    // accidentally grab an image belonging to the NEXT film.
    const nextPoster = tags.slice(index + 1).find(m => /\bdata-item-slug\s*=/i.test(m[0]));
    const nextIndex = nextPoster?.index ?? html.length;
    const local = html.slice(tags[index].index + tag.length, Math.min(nextIndex, tags[index].index + 1600));
    const img = local.match(/<img\b[^>]*>/i);
    const poster = publicPoster(a) || (img ? publicPoster(attributes(img[0])) : undefined);
    films.push({ slug, name, ...(yearMatch ? { year: Number(yearMatch[1]) } : {}), ...(poster ? { poster } : {}) });
  }
  return films;
}

/** Film details contain outbound IMDb/TMDB references. */
export function parseFilmDetails(html) {
  const imdbId = html.match(/(?:imdb\.com\/title\/|data-imdb-id\s*=\s*["'])(tt\d{5,15})/i)?.[1];
  const tmdbId = html.match(/data-tmdb-id\s*=\s*["'](\d+)["']/i)?.[1]
    || html.match(/themoviedb\.org\/(?:movie|tv)\/(\d+)/i)?.[1];
  const ogImageTag = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map(m => attributes(m[0]))
    .find(a => a.property === 'og:image' || a.name === 'twitter:image');
  const poster = ogImageTag ? publicPoster({ src: ogImageTag.content }) : undefined;
  return { ...(imdbId ? { imdbId } : {}), ...(tmdbId ? { tmdbId } : {}), ...(poster ? { poster } : {}) };
}
