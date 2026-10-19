const { getConfig } = require('./config');
const { resolveExternalIds } = require('./mapper');

// Cache library state briefly so cards render live status badges fast
let libraryCache = {
  timestamp: 0,
  sonarrByTvdb: new Map(),
  sonarrByTitle: new Map(),
  radarrByTmdb: new Map(),
  radarrByTitle: new Map()
};

const LIBRARY_CACHE_TTL_MS = 25000;

function normalizeTitleKey(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(12000)
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.error || (Array.isArray(data) && data[0]?.errorMessage))) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/**
 * Refresh in-memory cache of Sonarr series and Radarr movies
 */
async function refreshArrLibraryCache(force = false) {
  const config = getConfig();
  if (!force && Date.now() - libraryCache.timestamp < LIBRARY_CACHE_TTL_MS) {
    return libraryCache;
  }

  const nextSonarrByTvdb = new Map();
  const nextSonarrByTitle = new Map();
  const nextRadarrByTmdb = new Map();
  const nextRadarrByTitle = new Map();

  const tasks = [];

  if (config.sonarr.url && config.sonarr.apiKey) {
    tasks.push(
      fetchJson(`${config.sonarr.url}/api/v3/series`, {
        headers: { 'X-Api-Key': config.sonarr.apiKey },
        signal: AbortSignal.timeout(2500)
      })
        .then(seriesList => {
          if (Array.isArray(seriesList)) {
            for (const s of seriesList) {
              const info = {
                id: s.id,
                tvdbId: s.tvdbId,
                monitored: s.monitored,
                episodeFileCount: s.statistics?.episodeFileCount || 0,
                episodeCount: s.statistics?.episodeCount || 0,
                percentOfEpisodes: s.statistics?.percentOfEpisodes || 0,
                status: (s.statistics?.episodeFileCount || 0) > 0 ? 'available' : 'monitored'
              };
              if (s.tvdbId) nextSonarrByTvdb.set(Number(s.tvdbId), info);
              if (s.title) nextSonarrByTitle.set(normalizeTitleKey(s.title), info);
            }
          }
        })
        .catch(() => {})
    );
  }

  if (config.radarr.url && config.radarr.apiKey) {
    tasks.push(
      fetchJson(`${config.radarr.url}/api/v3/movie`, {
        headers: { 'X-Api-Key': config.radarr.apiKey },
        signal: AbortSignal.timeout(2500)
      })
        .then(movieList => {
          if (Array.isArray(movieList)) {
            for (const m of movieList) {
              const info = {
                id: m.id,
                tmdbId: m.tmdbId,
                monitored: m.monitored,
                hasFile: Boolean(m.hasFile),
                status: m.hasFile ? 'available' : 'monitored'
              };
              if (m.tmdbId) nextRadarrByTmdb.set(Number(m.tmdbId), info);
              if (m.title) nextRadarrByTitle.set(normalizeTitleKey(m.title), info);
            }
          }
        })
        .catch(() => {})
    );
  }

  await Promise.all(tasks);

  libraryCache = {
    timestamp: Date.now(),
    sonarrByTvdb: nextSonarrByTvdb,
    sonarrByTitle: nextSonarrByTitle,
    radarrByTmdb: nextRadarrByTmdb,
    radarrByTitle: nextRadarrByTitle
  };

  return libraryCache;
}

/**
 * Decorate a list of anime items with live library status badges from Sonarr / Radarr
 */
async function attachLibraryStatuses(items) {
  const cache = await refreshArrLibraryCache(false);
  return items.map(item => {
    let libraryStatus = null;
    if (item.mediaType === 'movie') {
      const byId = item.tmdbId ? cache.radarrByTmdb.get(Number(item.tmdbId)) : null;
      const byTitle = cache.radarrByTitle.get(normalizeTitleKey(item.title))
        || cache.radarrByTitle.get(normalizeTitleKey(item.titleRomaji));
      const match = byId || byTitle;
      if (match) {
        libraryStatus = {
          service: 'radarr',
          state: match.status, // 'available' or 'monitored'
          label: match.hasFile ? 'Downloaded (Radarr)' : 'Monitored (Radarr)'
        };
      }
    } else {
      const byId = item.tvdbId ? cache.sonarrByTvdb.get(Number(item.tvdbId)) : null;
      const byTitle = cache.sonarrByTitle.get(normalizeTitleKey(item.title))
        || cache.sonarrByTitle.get(normalizeTitleKey(item.titleRomaji));
      const match = byId || byTitle;
      if (match) {
        libraryStatus = {
          service: 'sonarr',
          state: match.status,
          episodeFileCount: match.episodeFileCount,
          episodeCount: match.episodeCount,
          label:
            match.episodeFileCount > 0
              ? `In Sonarr (${match.episodeFileCount}/${match.episodeCount || '?'} eps)`
              : 'Monitored (Sonarr)'
        };
      }
    }
    return {
      ...item,
      libraryStatus
    };
  });
}

/**
 * Resolve TMDB ID and mediaType via Seerr search if not already known
 */
async function resolveSeerrTarget(seerrConfig, anime) {
  const headers = {
    'X-Api-Key': seerrConfig.apiKey,
    'Accept': 'application/json'
  };

  const desiredType = anime.mediaType === 'movie' ? 'movie' : 'tv';

  // If we already have tmdbId for a movie, or if we want to verify via Seerr search
  const queries = [anime.titleEnglish, anime.titleRomaji, anime.title].filter(Boolean);
  const uniqueQueries = [...new Set(queries)];

  for (const q of uniqueQueries) {
    const searchUrl = `${seerrConfig.url}/api/v1/search?query=${encodeURIComponent(q)}&page=1`;
    const data = await fetchJson(searchUrl, { headers });
    const results = data?.results || [];

    // Try exact mediaType + year match first
    const matchByYear = results.find(r => {
      if (r.mediaType !== desiredType) return false;
      const releaseDate = r.firstAirDate || r.releaseDate || '';
      const releaseYear = releaseDate ? Number(releaseDate.slice(0, 4)) : null;
      return !anime.year || !releaseYear || Math.abs(releaseYear - anime.year) <= 1;
    });

    if (matchByYear) {
      return {
        mediaId: matchByYear.id,
        mediaType: matchByYear.mediaType,
        tvdbId: matchByYear.tvdbId || anime.tvdbId || null,
        title: matchByYear.name || matchByYear.title || anime.title
      };
    }

    const fallbackMatch = results.find(r => r.mediaType === desiredType) || results[0];
    if (fallbackMatch) {
      return {
        mediaId: fallbackMatch.id,
        mediaType: fallbackMatch.mediaType,
        tvdbId: fallbackMatch.tvdbId || anime.tvdbId || null,
        title: fallbackMatch.name || fallbackMatch.title || anime.title
      };
    }
  }

  if (anime.tmdbId) {
    return {
      mediaId: Number(anime.tmdbId),
      mediaType: desiredType,
      tvdbId: anime.tvdbId ? Number(anime.tvdbId) : undefined,
      title: anime.title
    };
  }

  throw new Error(`Could not find "${anime.title}" on Seerr search`);
}

/**
 * Request an anime through Seerr (Overseerr / Jellyseerr)
 */
async function requestViaSeerr(anime) {
  const config = getConfig();
  if (!config.seerr.url || !config.seerr.apiKey) {
    throw new Error('Seerr URL and API Key are not configured. Open Settings to configure Seerr.');
  }

  const ids = await resolveExternalIds({ anilistId: anime.anilistId, malId: anime.malId });
  const enriched = {
    ...anime,
    tvdbId: anime.tvdbId || ids.tvdbId,
    tmdbId: anime.tmdbId || ids.tmdbId
  };

  const target = await resolveSeerrTarget(config.seerr, enriched);

  const payload = {
    mediaType: target.mediaType,
    mediaId: Number(target.mediaId)
  };

  if (target.mediaType === 'tv') {
    payload.seasons = 'all';
    if (target.tvdbId) {
      payload.tvdbId = Number(target.tvdbId);
    }
  }

  try {
    const result = await fetchJson(`${config.seerr.url}/api/v1/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.seerr.apiKey
      },
      body: JSON.stringify(payload)
    });

    return {
      service: 'seerr',
      status: 'requested',
      message: `Requested "${target.title}" via Seerr (${target.mediaType.toUpperCase()} #${target.mediaId})`,
      data: result
    };
  } catch (err) {
    // Handle case where Seerr requires explicit season numbers array instead of "all"
    if (target.mediaType === 'tv' && /season/i.test(err.message)) {
      const tvDetails = await fetchJson(`${config.seerr.url}/api/v1/tv/${target.mediaId}`, {
        headers: { 'X-Api-Key': config.seerr.apiKey }
      });
      const seasonNumbers = (tvDetails?.seasons || [])
        .map(s => s.seasonNumber)
        .filter(n => n > 0);
      payload.seasons = seasonNumbers.length > 0 ? seasonNumbers : [1];

      const retryResult = await fetchJson(`${config.seerr.url}/api/v1/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': config.seerr.apiKey
        },
        body: JSON.stringify(payload)
      });

      return {
        service: 'seerr',
        status: 'requested',
        message: `Requested "${target.title}" (Seasons: ${payload.seasons.join(', ')}) via Seerr`,
        data: retryResult
      };
    }
    throw err;
  }
}

/**
 * Add an anime TV series directly to Sonarr v3/v4
 */
async function requestViaSonarr(anime) {
  const config = getConfig();
  if (!config.sonarr.url || !config.sonarr.apiKey) {
    throw new Error('Sonarr URL and API Key are not configured. Open Settings to configure Sonarr.');
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-Api-Key': config.sonarr.apiKey
  };

  const ids = await resolveExternalIds({ anilistId: anime.anilistId, malId: anime.malId });
  const tvdbId = anime.tvdbId || ids.tvdbId;

  // Lookup series in Sonarr by tvdbId first, then by title
  let lookupResults = [];
  if (tvdbId) {
    lookupResults = await fetchJson(
      `${config.sonarr.url}/api/v3/series/lookup?term=${encodeURIComponent(`tvdb:${tvdbId}`)}`,
      { headers }
    ).catch(() => []);
  }

  if (!Array.isArray(lookupResults) || lookupResults.length === 0) {
    const searchTerm = anime.titleEnglish || anime.titleRomaji || anime.title;
    lookupResults = await fetchJson(
      `${config.sonarr.url}/api/v3/series/lookup?term=${encodeURIComponent(searchTerm)}`,
      { headers }
    );
  }

  if (!Array.isArray(lookupResults) || lookupResults.length === 0) {
    throw new Error(`Could not find "${anime.title}" in Sonarr series lookup.`);
  }

  const seriesToAdd = lookupResults[0];

  // If already in Sonarr library (has an id), trigger a search or report status
  if (seriesToAdd.id) {
    await refreshArrLibraryCache(true);
    return {
      service: 'sonarr',
      status: 'already_exists',
      message: `"${seriesToAdd.title}" is already in your Sonarr library.`
    };
  }

  // Resolve Root Folder & Quality Profile if not explicitly set
  let qualityProfileId = Number(config.sonarr.qualityProfileId);
  if (!qualityProfileId) {
    const profiles = await fetchJson(`${config.sonarr.url}/api/v3/qualityprofile`, { headers });
    qualityProfileId = profiles?.[0]?.id;
  }

  let rootFolderPath = config.sonarr.rootFolderPath;
  if (!rootFolderPath) {
    const roots = await fetchJson(`${config.sonarr.url}/api/v3/rootfolder`, { headers });
    rootFolderPath = roots?.[0]?.path;
  }

  if (!qualityProfileId || !rootFolderPath) {
    throw new Error('Sonarr requires a valid Quality Profile and Root Folder. Please configure them in Settings.');
  }

  const payload = {
    ...seriesToAdd,
    qualityProfileId: Number(qualityProfileId),
    languageProfileId: Number(config.sonarr.languageProfileId || 1),
    rootFolderPath,
    seriesType: config.sonarr.seriesType || 'anime',
    seasonFolder: config.sonarr.seasonFolder !== false,
    monitored: true,
    addOptions: {
      monitor: 'all',
      searchForMissingEpisodes: config.sonarr.searchOnAdd !== false,
      searchForCutoffUnmetEpisodes: false
    }
  };

  const added = await fetchJson(`${config.sonarr.url}/api/v3/series`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  await refreshArrLibraryCache(true);

  return {
    service: 'sonarr',
    status: 'added',
    message: `Added "${added.title}" to Sonarr (${payload.seriesType} mode)${payload.addOptions.searchForMissingEpisodes ? ' and started episode search' : ''}.`,
    data: { id: added.id, title: added.title, tvdbId: added.tvdbId }
  };
}

/**
 * Add an anime Movie directly to Radarr v3
 */
async function requestViaRadarr(anime) {
  const config = getConfig();
  if (!config.radarr.url || !config.radarr.apiKey) {
    throw new Error('Radarr URL and API Key are not configured. Open Settings to configure Radarr for anime movies.');
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-Api-Key': config.radarr.apiKey
  };

  const ids = await resolveExternalIds({ anilistId: anime.anilistId, malId: anime.malId });
  const tmdbId = anime.tmdbId || ids.tmdbId;

  let lookupResults = [];
  if (tmdbId) {
    const byTmdb = await fetchJson(
      `${config.radarr.url}/api/v3/movie/lookup/tmdb?tmdbId=${encodeURIComponent(tmdbId)}`,
      { headers }
    ).catch(() => null);
    if (byTmdb) lookupResults = Array.isArray(byTmdb) ? byTmdb : [byTmdb];
  }

  if (!Array.isArray(lookupResults) || lookupResults.length === 0) {
    const searchTerm = anime.titleEnglish || anime.titleRomaji || anime.title;
    lookupResults = await fetchJson(
      `${config.radarr.url}/api/v3/movie/lookup?term=${encodeURIComponent(searchTerm)}`,
      { headers }
    );
  }

  if (!Array.isArray(lookupResults) || lookupResults.length === 0) {
    throw new Error(`Could not find movie "${anime.title}" in Radarr lookup.`);
  }

  const movieToAdd = lookupResults[0];
  if (movieToAdd.id) {
    await refreshArrLibraryCache(true);
    return {
      service: 'radarr',
      status: 'already_exists',
      message: `"${movieToAdd.title}" is already in your Radarr library.`
    };
  }

  let qualityProfileId = Number(config.radarr.qualityProfileId);
  if (!qualityProfileId) {
    const profiles = await fetchJson(`${config.radarr.url}/api/v3/qualityprofile`, { headers });
    qualityProfileId = profiles?.[0]?.id;
  }

  let rootFolderPath = config.radarr.rootFolderPath;
  if (!rootFolderPath) {
    const roots = await fetchJson(`${config.radarr.url}/api/v3/rootfolder`, { headers });
    rootFolderPath = roots?.[0]?.path;
  }

  if (!qualityProfileId || !rootFolderPath) {
    throw new Error('Radarr requires a valid Quality Profile and Root Folder. Please configure them in Settings.');
  }

  const payload = {
    ...movieToAdd,
    qualityProfileId: Number(qualityProfileId),
    rootFolderPath,
    minimumAvailability: config.radarr.minimumAvailability || 'released',
    monitored: true,
    addOptions: {
      searchForMovie: config.radarr.searchOnAdd !== false
    }
  };

  const added = await fetchJson(`${config.radarr.url}/api/v3/movie`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  await refreshArrLibraryCache(true);

  return {
    service: 'radarr',
    status: 'added',
    message: `Added movie "${added.title}" to Radarr${payload.addOptions.searchForMovie ? ' and triggered download search' : ''}.`,
    data: { id: added.id, title: added.title, tmdbId: added.tmdbId }
  };
}

/**
 * Test connection and fetch available quality profiles & root folders for Sonarr / Radarr / Seerr
 */
async function probeService(service, customConfig = {}) {
  const saved = getConfig();
  const cfg = {
    ...(saved[service] || {}),
    ...customConfig,
    url: ((customConfig.url ?? saved[service]?.url) || '').trim().replace(/\/+$/, ''),
    apiKey: ((customConfig.apiKey ?? saved[service]?.apiKey) || '').trim()
  };

  if (!cfg.url || !cfg.apiKey) {
    throw new Error(`Missing URL or API key for ${service}`);
  }

  if (service === 'seerr') {
    const status = await fetchJson(`${cfg.url}/api/v1/status`, {
      headers: { 'X-Api-Key': cfg.apiKey }
    });
    // Also verify auth by hitting /api/v1/auth/me or /api/v1/settings/main
    await fetchJson(`${cfg.url}/api/v1/user?take=1`, {
      headers: { 'X-Api-Key': cfg.apiKey }
    });
    return {
      ok: true,
      version: status?.version || 'Connected'
    };
  }

  if (service === 'sonarr' || service === 'radarr') {
    const headers = { 'X-Api-Key': cfg.apiKey };
    const [system, profiles, rootFolders] = await Promise.all([
      fetchJson(`${cfg.url}/api/v3/system/status`, { headers }),
      fetchJson(`${cfg.url}/api/v3/qualityprofile`, { headers }),
      fetchJson(`${cfg.url}/api/v3/rootfolder`, { headers })
    ]);

    return {
      ok: true,
      version: system?.version || 'Connected',
      qualityProfiles: (profiles || []).map(p => ({ id: p.id, name: p.name })),
      rootFolders: (rootFolders || []).map(r => ({ id: r.id, path: r.path, freeSpace: r.freeSpace }))
    };
  }

  throw new Error(`Unknown service: ${service}`);
}

module.exports = {
  attachLibraryStatuses,
  refreshArrLibraryCache,
  requestViaSeerr,
  requestViaSonarr,
  requestViaRadarr,
  probeService
};
