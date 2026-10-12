import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { WatchlistService, normaliseUsername, manifestFor, CATALOG_ID } from '../src/catalog.mjs';
import { createAddonServer } from '../src/server.mjs';
import { decodeHtml, parseFilmDetails, parseWatchlistPage } from '../src/parser.mjs';

const CARD = i => `<li><div data-item-full-display-name="Movie ${i} (${2000 + i % 23})" data-component-class="LazyPoster" data-item-slug="movie-${i}" data-item-name="Movie ${i}"><img src="https://a.ltrbxd.com/posters/${i}.jpg"></div></li>`;
const htmlFor = (page, size) => `<html><body><ul>${Array.from({ length: Math.min(28, Math.max(0, size - (page - 1) * 28)) }, (_, n) => CARD((page - 1) * 28 + n + 1)).join('')}</ul></body></html>`;

function mockLetterboxd(accounts = { filmfan: 257, cinephile_2: 41 }, failures = {}) {
  const requests = [];
  return {
    requests,
    fetch: async url => {
      const { hostname, pathname } = new URL(url);
      assert.equal(hostname, 'letterboxd.com'); // Never make an external, user-defined request.
      requests.push(pathname);
      const match = pathname.match(/^\/([a-z0-9_-]+)\/watchlist\/(?:page\/(\d+)\/)?$/);
      if (match) {
        const size = accounts[match[1]];
        const page = Number(match[2] || 1);
        if (size === undefined || (page - 1) * 28 >= size) return { ok: false, status: 404 };
        return { ok: true, text: async () => htmlFor(page, size) };
      }
      const film = pathname.match(/^\/film\/movie-(\d+)\/$/);
      if (film) {
        const num = Number(film[1]);
        if (failures[num]) return { ok: false, status: failures[num] };
        return { ok: true, text: async () => num === 6
          ? '<a href="https://www.themoviedb.org/movie/46">TMDB</a>'
          : num === 7 ? '<html><body>No external ID</body></html>'
          : `<a href="https://www.imdb.com/title/tt${String(num).padStart(7, '0')}/">IMDb</a>` };
      }
      return { ok: false, status: 404 };
    },
  };
}

test('parses public film cards and IDs without private account data', () => {
  assert.equal(decodeHtml('E &amp; J &ldquo;Go&rdquo;'), 'E & J “Go”');
  assert.deepEqual(parseWatchlistPage('<div data-item-slug="demo" data-item-name="A &amp; B" data-item-full-display-name="A &amp; B (2021)" data-component-class="LazyPoster"><img src="https://s.ltrbxd.com/a.jpg"></div>'),
    [{ slug: 'demo', name: 'A & B', year: 2021, poster: 'https://s.ltrbxd.com/a.jpg' }]);
  assert.equal(parseFilmDetails('<a href="https://imdb.com/title/tt7654321/">').imdbId, 'tt7654321');
});

test('usernames are validated and different accounts get different manifests', () => {
  assert.equal(normaliseUsername('  FilmFan '), 'filmfan');
  assert.throws(() => normaliseUsername('../admin'), /username/);
  assert.throws(() => normaliseUsername('https://private.local'), /username/);
  assert.throws(() => normaliseUsername('x'.repeat(80)), /username/);
  assert.notEqual(manifestFor('filmfan').id, manifestFor('cinephile_2').id);
  assert.equal(manifestFor('filmfan').catalogs[0].id, CATALOG_ID);
  assert.ok(manifestFor('filmfan').catalogs[0].extra.some(v => v.name === 'skip'));
});

test('a large public watchlist is complete with 100-item pagination', async () => {
  const remote = mockLetterboxd();
  const service = new WatchlistService({ fetchImpl: remote.fetch, throttleMs: 0 });
  const all = [];
  for (let skip = 0; skip < 257; skip += 100) {
    const result = await service.getCatalog('filmfan', skip);
    assert.ok(result.metas.length <= 100);
    all.push(...result.metas);
  }
  assert.equal(all.length, 257);
  assert.equal(new Set(all.map(item => item.id)).size, 257);
  assert.equal(all[5].id, 'tmdb:46');
  assert.equal(all[6].id, 'letterboxd:movie-7');
  assert.equal(all.at(-1).name, 'Movie 257');
  assert.equal(remote.requests.filter(path => path === '/film/movie-1/').length, 1);
  assert.equal((await service.getCatalog('filmfan', 300)).metas.length, 0);
  assert.equal(service.getMeta('tmdb:46').name, 'Movie 6');
});

test('two users get independent watchlists and share reusable movie mapping', async () => {
  const remote = mockLetterboxd();
  const service = new WatchlistService({ fetchImpl: remote.fetch, throttleMs: 0 });
  assert.equal((await service.getCatalog('cinephile_2')).metas.length, 41);
  assert.equal((await service.getCatalog('filmfan')).metas.length, 100);
  assert.equal(remote.requests.filter(p => p === '/film/movie-1/').length, 1);
  assert.ok(remote.requests.includes('/cinephile_2/watchlist/'));
  assert.ok(remote.requests.includes('/filmfan/watchlist/'));
});

test('film fetch failures preserve catalog entries with a fallback ID', async () => {
  const remote = mockLetterboxd({ filmfan: 29 }, { 3: 429 });
  const service = new WatchlistService({ fetchImpl: remote.fetch, throttleMs: 0 });
  const result = await service.getCatalog('filmfan');
  assert.equal(result.metas.length, 29);
  assert.equal(result.metas[2].id, 'letterboxd:movie-3');
});

test('web server serves setup page, separate account manifests, catalog, and private-safe health', async t => {
  const remote = mockLetterboxd({ filmfan: 29 });
  const server = createAddonServer(new WatchlistService({ fetchImpl: remote.fetch, throttleMs: 0 }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const index = await fetch(base).then(r => r.text());
  assert.match(index, /Letterboxd username/);
  assert.match(index, /Get add-on link/);
  const css = await fetch(`${base}/app.css`);
  assert.equal(css.status, 200);
  const js = await fetch(`${base}/app.js`);
  assert.equal(js.status, 200);
  const m = await fetch(`${base}/u/filmfan/manifest.json`).then(r => r.json());
  const m2 = await fetch(`${base}/u/cinephile_2/manifest.json`).then(r => r.json());
  assert.notEqual(m.id, m2.id);
  assert.match(m.name, /filmfan/);
  const first = await fetch(`${base}/u/filmfan/catalog/movie/${CATALOG_ID}.json`);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).metas.length, 29);
  const second = await fetch(`${base}/u/filmfan/catalog/movie/${CATALOG_ID}/skip=100.json`).then(r => r.json());
  assert.equal(second.metas.length, 0);
  const meta = await fetch(`${base}/u/filmfan/meta/movie/tmdb:46.json`).then(r => r.json());
  assert.equal(meta.meta.name, 'Movie 6');
  const health = await fetch(`${base}/health`).then(r => r.json());
  assert.deepEqual(health, { ok: true });
  assert.equal((await fetch(`${base}/manifest.json`)).status, 400);
  assert.equal((await fetch(`${base}/u/filmfan/catalog/movie/${CATALOG_ID}/skip=nope.json`)).status, 400);
  assert.equal((await fetch(`${base}/u/../health`)).status, 200); // URL canonicalisation is safe.
});

test('repository contains no user-specific handles, profiles or film count from an earlier personalised build', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  async function walk(folder) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      if (item.name === 'node_modules' || item.name === '.git') continue;
      const file = join(folder, item.name);
      if (item.isDirectory()) await walk(file);
      else {
        const content = await readFile(file, 'utf8');
        // Split the banned marker to avoid putting it in the test file itself.
        assert.ok(!content.toLowerCase().includes('volt' + 'bolt'), `Personal identifier found in ${file}`);
        assert.ok(!content.includes('1,' + '143'), `Personal watchlist count found in ${file}`);
      }
    }
  }
  await walk(root);
});


test('setup UI creates user-specific links without contacting a backend or saving identity', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const script = await readFile(join(root, 'public/app.js'), 'utf8');
  const controls = new Map();
  const makeControl = () => ({
    value: '', hidden: false, textContent: '', href: '',
    addEventListener(event, callback) { this[event] = callback; },
    select() { this.selected = true; },
  });
  for (const selector of ['#generator','#account','#error','#result','#manifest-url','#copy','#view-manifest','#view-watchlist']) {
    controls.set(selector, makeControl());
  }
  const document = { querySelector(selector) { return controls.get(selector); } };
  runInNewContext(script, { document, location: { origin: 'https://addon.example' }, URL,
    navigator: { clipboard: { async writeText() {} } } });
  const form = controls.get('#generator');
  const input = controls.get('#account');
  input.value = 'https://letterboxd.com/filmfan/watchlist/';
  form.submit({ preventDefault() {} });
  assert.equal(controls.get('#manifest-url').value, 'https://addon.example/u/filmfan/manifest.json');
  assert.equal(controls.get('#view-watchlist').href, 'https://letterboxd.com/filmfan/watchlist/');
  assert.equal(controls.get('#result').hidden, false);
  input.value = 'https://evil.example/filmfan/watchlist/';
  form.submit({ preventDefault() {} });
  assert.equal(controls.get('#error').hidden, false);
  assert.match(controls.get('#error').textContent, /letterboxd.com/);
});
