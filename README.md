# Letterboxd Watchlist → Nuvio

**A free, open-source, multi-user movie catalogue add-on.** Turn **any public Letterboxd watchlist** into a catalogue in Nuvio or another Stremio-compatible client. No account credentials, paid film API, application secrets or external Node dependencies.

Anyone can run their **own copy with `npm start`** or choose to deploy it on their own host (for example, Render). The maintainer of this GitHub repository **does not provide a hosted add-on or manage other people's accounts**. A public deployment, if someone chooses to create one, can serve multiple people with individual add-on URLs. The repository contains **no usernames, profile details, accounts, private keys or film lists**.

> **This is a catalog, not a playback or streaming service.** Films with an IMDb ID may be playable through other independently installed playback add-ons. Unmatched films remain in the catalog with a fallback ID but are not guaranteed to play.

## Features

- Easy setup webpage: enter a public Letterboxd username or paste a public watchlist URL, and copy the personal manifest URL.
- Separate catalogues for multiple usernames, so one deployment works for everyone.
- Loads all public watchlist pages as you browse; no fixed maximum number of movies.
- Stremio-compatible `manifest.json`, `catalog` and fallback `meta` endpoints.
- Pagination (100 films per catalogue page) and cached IMDb/TMDB resolution.
- New watchlist edits are reflected after caching expires (usually about 15 minutes, plus client caching).
- No database, registration, cookies, analytics, API keys, telemetry or paywall.
- MIT license, automated tests, Dockerfile and optional Render deployment blueprint. No maintainer-provided hosting.

## Run it yourself for free (`npm start`) — recommended

You do **not** need Render, a paid host, an API key or a database to run the add-on. You need a computer with [Node.js](https://nodejs.org/) **20 or newer**. No third-party npm packages are required.

1. On GitHub, choose **Code → Download ZIP**, then unzip the repository. Alternatively, clone your fork with Git.
2. Open a terminal inside the extracted folder, the one containing `package.json`.
3. Start the server:

   ```sh
   npm start
   ```

4. Open **http://localhost:3000** in a browser on **that computer**.
5. Enter your public Letterboxd username or watchlist URL and select **Get add-on link**.
6. Copy the generated `manifest.json` URL into **Nuvio → Addons → Add from URL** if your Nuvio installation can reach that server and accepts local HTTP URLs.
7. Keep the terminal open and the computer running while using the add-on. Press **Ctrl+C** to stop it.

**Important:** `npm start` runs the server **locally**; it does not automatically put the add-on online. `localhost` only refers to the device running the server. A phone, TV or computer elsewhere **cannot reach your PC's `localhost` address**. Some Nuvio/Stremio-compatible clients also require a publicly reachable **HTTPS URL**. If your client cannot use the local URL, deploy your own HTTPS instance (instructions below) or use your own HTTPS reverse proxy/tunnel. A free tunnel's availability and limitations depend on the provider.

Optional local checks:

```sh
npm test
npm run check
```

## Alternatively: deploy your own hosted instance (optional Render)

**The project maintainer is not hosting this for you.** People who want a public HTTPS address can deploy **their own** copy. Render is one optional hosting platform; it is **not required** and is not part of the add-on.

1. Fork the GitHub repository to your own account (or create your own repository and upload the source files).
2. Go to [Render](https://dashboard.render.com/), sign into **your own Render account**, and create **New → Web Service** connected to your copy.
3. Select the **Free** plan if it is offered. Use Node.js with `npm install` as the build command and `npm start` as the start command. The included `render.yaml` contains equivalent optional settings.
4. Once your service is running, open its assigned public HTTPS URL and enter **your own** Letterboxd username on the setup page.
5. Copy your personal manifest link into Nuvio. You can share your hosted setup page with others if you choose.

**Costs:** This software is free and open source. Third-party hosting may have quotas, sleeping instances, usage restrictions or charges depending on the provider, account and plan. Check any provider's current terms and **do not select a paid plan unless you intend to pay**. A public deployment is your responsibility, not the repository owner's.

### Free-host limitations

- Some free hosts suspend idle applications, so the first request may be slow or fail when the service wakes up.
- The first catalogue request for an uncached account can require many film-page lookups. Cached requests are faster; restarting the server clears its in-memory cache.
- Letterboxd may return HTTP 403/429 or automated-access challenges; live availability cannot be guaranteed on every host.
- Free quotas are not unlimited, and high traffic can exhaust them. For Render, see [Render's free plan documentation](https://render.com/docs/free).
- No one has to pay **the add-on project** to use it, but providers may charge for optional infrastructure.

## Install in Nuvio (once you have a running server)

1. Open the add-on's setup page: **http://localhost:3000** if you run it locally, or the **HTTPS URL of your own deployed instance**.
2. Enter **your own public** Letterboxd username or paste its public watchlist URL.
3. Select **Get add-on link** and copy the personal manifest URL.
4. In Nuvio, open **Addons**, choose the option to add/install an add-on from a URL, and paste the manifest URL. Nuvio must be able to reach the server.
5. Find **Letterboxd Watchlist** in your catalogues. Other Stremio-compatible clients may use the same URL if they accept custom add-ons.

A public manifest URL looks like:

```text
https://your-own-server.example/u/filmfan/manifest.json
```

The hostname and `filmfan` are **examples**, not a default user or existing server. To use your own username, generate the link through the setup page. The generic `/manifest.json` without `/u/<username>/` is deliberately not installable.

### Docker

```sh
docker build -t letterboxd-watchlist-addon .
docker run --rm -p 3000:3000 letterboxd-watchlist-addon
```

## Endpoints

| URL | Purpose |
| --- | --- |
| `/` or `/configure` | Mobile-friendly, no-login configuration UI |
| `/health` | Health check (reveals no account information) |
| `/u/filmfan/manifest.json` | Example user-specific add-on manifest |
| `/u/filmfan/catalog/movie/letterboxd-watchlist.json` | First 100 movie previews |
| `/u/filmfan/catalog/movie/letterboxd-watchlist/skip=100.json` | The next 100 movie previews |
| `/u/filmfan/meta/movie/letterboxd:some-film.json` | Cached metadata for fallback IDs |

## Privacy and safety

- The repository deliberately contains **no user profile or identifying default account**. Users supply public usernames on the configuration page.
- The app only fetches **public watchlist pages and public movie pages** on `letterboxd.com` to obtain film titles, images and external film IDs. It does **not** read profile bios, followers, diary entries or private account data.
- No login, password, OAuth, API token or credit card is requested by the app.
- No cookies, external scripts or analytics. Temporary caches exist in server memory, not in a permanent database.
- A username is necessarily part of the installed manifest URL. Host infrastructure may log request URLs, and clients have access to installed URLs. Do not use this with a username you wish to conceal.
- Input validation and a fixed Letterboxd host prevent user-controlled external HTTP destinations.
- Hosting provider accounts (for example GitHub and optionally Render) have their own privacy policies and terms. Running locally does not require registering with a web-hosting provider.

## Development / limits

`src/parser.mjs` parses Letterboxd's public HTML, which can change without notice. No official Letterboxd API access is assumed. Respect website policies and rate limits. IDs are resolved from film pages, not by potentially incorrect fuzzy title searches. A fallback `tmdb:` or `letterboxd:` ID is used when IMDb is unavailable; compatibility with other add-ons varies. A successful offline test suite is **not** proof of live Letterboxd availability.

Test with `npm test`. See `CONTRIBUTING.md` to submit improvements. Bug reports are welcome, but **do not post personal data, login credentials or private watchlists** in issues.

## Disclaimer and license

Independent community project, not affiliated with Letterboxd, Nuvio, Stremio, IMDb or TMDB. It does not provide streams, copyrighted movie downloads or access to private watchlists.

Licensed under the [MIT License](LICENSE).
