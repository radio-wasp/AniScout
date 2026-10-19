# ⚡ AniScout

A lightweight Docker web application to browse, skim, and scan **AniList** and **MyAnimeList (Jikan)** with one-click download requests routed to **Seerr (Overseerr / Jellyseerr)**, **Sonarr**, and **Radarr**.

## ✨ Features

- **Dual Anime Providers**: Switch seamlessly between **AniList** (GraphQL) and **MyAnimeList** (Jikan v4) for Trending, Seasonal, Most Popular, Top Rated, Upcoming, and Search.
- **Rich Filtering**: Filter by Season (`Winter`, `Spring`, `Summer`, `Fall`), Year, Format (`TV`, `Movie`, `OVA`, `ONA`, `Special`), Genre, or hide titles already in your library.
- **Personal Watchlist Scanner**: Scan any public AniList user's `Planning` or `Watching` list to find and request missing anime in one click.
- **Automatic Cross-Platform ID Mapping**: Automatically bridges `AniList ID` / `MAL ID` &rarr; `TVDB ID` & `TMDB ID` using the Fribb `anime-lists` database + `ani.zip` fallback.
- **Flexible Request Routing**:
  - **Seerr Mode**: Sends TV & Movie requests through Seerr / Overseerr / Jellyseerr (`/api/v1/request`).
  - **Direct \*arr Mode**: Adds TV/OVA/ONA series directly to **Sonarr** (`/api/v3/series` with `anime` series type, quality profile, root folder, and automatic episode search) and Anime Movies directly to **Radarr** (`/api/v3/movie`).
  - **Both Mode**: Displays both `📥 Seerr` and `➕ Sonarr / Radarr` buttons on every anime card.
- **Live Library Badges**: Queries Sonarr and Radarr to display `✓ In Sonarr (eps)` / `✓ Monitored` / `✓ Downloaded (Radarr)` badges directly on posters.

## 🚀 Quick Start (Docker Compose)

1. Copy `.env.example` to `.env` (or configure everything directly in the Web UI **⚙️ Settings** modal):
   ```bash
   cp .env.example .env
   ```
2. Build and start the container:
   ```bash
   docker compose up -d --build
   ```
3. Open **http://localhost:3456** in your browser.
4. Click **⚙️ Settings** in the top-right to test your Seerr, Sonarr, and Radarr connections and auto-load your Quality Profiles and Root Folders.
