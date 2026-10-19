<p align="center">
  <img src="public/logo.jpg" alt="AniScout Logo" width="140" style="border-radius: 24px;" />
</p>

<h1 align="center">AniScout</h1>

<p align="center">
  <strong>Scan &amp; browse AniList, MyAnimeList, Crunchyroll, and HIDIVE with one-click requests to Seerr, Sonarr, and Radarr.</strong>
</p>

---

## ✨ Features

- **4 Anime Catalogs in One UI**:
  - **🔵 AniList**: Real-time GraphQL browsing and search.
  - **🔷 MyAnimeList**: Powered by Jikan v4 with automatic rate-limit caching and seamless MAL-ID fallback so browsing never stalls.
  - **🟠 Crunchyroll**: Browse and filter anime licensed/streaming on Crunchyroll with direct `CR ↗` watch links.
  - **🩵 HIDIVE**: Browse and filter anime licensed/streaming on HIDIVE with direct `HIDIVE ↗` watch links.
- **Rich Skimming & Filtering**:
  - Browse **🔥 Trending**, **🌸 Seasonal**, **⭐ Most Popular**, **🏆 Top Rated**, and **🚀 Upcoming** feeds.
  - Filter by **Season** (`Winter`, `Spring`, `Summer`, `Fall`), **Year** (`1980`–Present), **Format** (`TV`, `Movie`, `OVA`, `ONA`, `Special`), and **Genre**.
  - **Hide In Library** toggle to filter out anime already monitored or downloaded in your Sonarr/Radarr libraries.
- **📋 Personal Watchlist Scanner**:
  - Enter any public AniList username to scan their `Plan to Watch`, `Currently Watching`, `Completed`, or `On Hold` lists and request missing anime in one click.
- **Flexible Request Routing (Seerr + Sonarr + Radarr)**:
  - **Seerr Mode (`seerr`)**: Sends TV & Movie requests through **Seerr / Overseerr / Jellyseerr** (`/api/v1/request`).
  - **Direct \*arr Mode (`arr`)**: Adds anime TV/OVA/ONA series directly to **Sonarr** (`/api/v3/series` with `anime` series type, quality profile, root folder, and automatic episode search) and anime movies directly to **Radarr** (`/api/v3/movie`).
  - **Both Mode (`both`)**: Displays both `📥 Seerr` and `➕ Sonarr / Radarr` buttons side-by-side on every card.
- **Live Library Badges**:
  - Automatically cross-references your Sonarr and Radarr libraries to display `✓ In Sonarr (X/Y eps)`, `✓ Monitored (Sonarr)`, or `✓ Downloaded (Radarr)` badges on posters.
- **Automatic Cross-Platform ID Mapping**:
  - Bridges `AniList ID` & `MAL ID` &rarr; `TVDB ID` & `TMDB ID` in the background using the Fribb `anime-lists` database with `api.ani.zip` fallback.

---

## 🚀 Quick Start (Docker Compose)

1. **(Optional)** Copy `.env.example` to `.env` if you want to pre-seed settings via environment variables (you can also configure everything in the Web UI):
   ```bash
   cp .env.example .env
   ```

2. Build and start the container:
   ```bash
   docker compose up -d --build
   ```

3. Open **http://localhost:3456** in your browser.

4. Click **⚙️ Settings** in the top-right corner to:
   - Choose your preferred request button mode (**Both**, **Seerr Only**, or **Direct Sonarr & Radarr Only**).
   - Enter your **Seerr**, **Sonarr**, and/or **Radarr** URLs and API Keys.
   - Click **Test & Load Profiles** to verify connectivity and automatically populate your Quality Profiles and Root Folders.

---

## ⚙️ Environment Variables

All settings can be configured either via the Web UI (**⚙️ Settings**, persisted to `/data/config.json`) or via environment variables in `docker-compose.yml` / `.env`:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3456` | Host port mapped to container port `3000` |
| `DATA_DIR` | `/data` | Directory inside the container for `config.json` and ID mapping cache |
| `DEFAULT_MODE` | `both` | Button mode: `both`, `seerr`, or `arr` |
| `SEERR_URL` | *(empty)* | Base URL for Overseerr / Jellyseerr / Seerr (e.g. `http://overseerr:5055`) |
| `SEERR_API_KEY` | *(empty)* | Seerr API Key |
| `SONARR_URL` | *(empty)* | Base URL for Sonarr (e.g. `http://sonarr:8989`) |
| `SONARR_API_KEY` | *(empty)* | Sonarr API Key |
| `SONARR_QUALITY_PROFILE_ID` | *(auto)* | Quality Profile ID for anime series in Sonarr |
| `SONARR_ROOT_FOLDER` | *(auto)* | Root folder path in Sonarr (e.g. `/data/media/anime`) |
| `SONARR_ANIME_SERIES_TYPE` | `anime` | Sonarr series type (`anime` or `standard`) |
| `SONARR_SEARCH_ON_ADD` | `true` | Trigger missing episode search immediately when adding to Sonarr |
| `RADARR_URL` | *(empty)* | Base URL for Radarr (e.g. `http://radarr:7878`) |
| `RADARR_API_KEY` | *(empty)* | Radarr API Key |
| `RADARR_QUALITY_PROFILE_ID` | *(auto)* | Quality Profile ID for anime movies in Radarr |
| `RADARR_ROOT_FOLDER` | *(auto)* | Root folder path in Radarr (e.g. `/data/media/anime-movies`) |
| `RADARR_SEARCH_ON_ADD` | `true` | Trigger movie search immediately when adding to Radarr |

---

## 🛠️ Local Development & Testing

Requires **Node.js 20+** (zero external npm runtime dependencies):

```bash
# Run automated test suite
npm test

# Start local development server with auto-reload
npm run dev
```
