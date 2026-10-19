const dns = require('dns');
const https = require('https');
const { ensureMappingLoaded, getCachedMappingSync } = require('./mapper');

// Prefer IPv4 first, but allow automatic fallback if IPv4 or custom DNS fails
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const JIKAN_ENDPOINT = 'https://api.jikan.moe/v4';

// Short-lived cache for responses to prevent rate-limiting and make tab switching instant
const responseCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

/**
 * Resilient HTTPS JSON requester with automatic fallback between native fetch and https.request
 */
function httpsRequestJson(urlStr, { method = 'GET', headers = {}, body = null, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const reqOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; AniScout/1.1)',
        ...headers
      },
      timeout: timeoutMs
    };

    if (body) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(reqOptions, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (raw += chunk));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch (_) {
          parsed = null;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          const msg = parsed?.message || parsed?.error || raw?.slice(0, 200) || `HTTP ${res.statusCode}`;
          const err = new Error(`HTTP ${res.statusCode}: ${msg}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Request to ${url.hostname} timed out after ${timeoutMs}ms`));
    });
    req.on('error', err => reject(err));

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function fetchWithRetry(urlStr, options = {}, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await httpsRequestJson(urlStr, options);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delay = err.statusCode === 429 ? 1100 * (attempt + 1) : 400 * (attempt + 1);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

const ANILIST_MEDIA_FRAGMENT = `
  id
  idMal
  title {
    romaji
    english
    native
  }
  description(asHtml: false)
  format
  status
  episodes
  duration
  season
  seasonYear
  averageScore
  popularity
  genres
  studios(isMain: true) {
    nodes {
      name
    }
  }
  coverImage {
    extraLarge
    large
    color
  }
  bannerImage
  nextAiringEpisode {
    episode
    timeUntilAiring
  }
  externalLinks {
    site
    url
    type
  }
  siteUrl
`;

function stripHtml(text) {
  if (!text) return '';
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function extractStreamingLinks(externalLinks = []) {
  let crunchyrollUrl = null;
  let hidiveUrl = null;
  const streamers = [];

  for (const link of externalLinks || []) {
    const site = (link.site || '').toLowerCase();
    if (site.includes('crunchyroll')) {
      crunchyrollUrl = link.url;
      if (!streamers.includes('Crunchyroll')) streamers.push('Crunchyroll');
    } else if (site.includes('hidive')) {
      hidiveUrl = link.url;
      if (!streamers.includes('HIDIVE')) streamers.push('HIDIVE');
    }
  }

  return { crunchyrollUrl, hidiveUrl, streamers };
}

function normalizeAnilistMedia(item, sourceOverride = 'anilist') {
  const ids = getCachedMappingSync({ anilistId: item.id, malId: item.idMal });
  const format = item.format || 'TV';
  const isMovie = format === 'MOVIE';
  const { crunchyrollUrl, hidiveUrl, streamers } = extractStreamingLinks(item.externalLinks);

  return {
    uid: `${sourceOverride}-${item.id}`,
    source: sourceOverride,
    anilistId: item.id,
    malId: item.idMal || ids.malId || null,
    tvdbId: ids.tvdbId,
    tmdbId: ids.tmdbId,
    imdbId: ids.imdbId,
    title: item.title?.english || item.title?.romaji || item.title?.native || 'Unknown Title',
    titleRomaji: item.title?.romaji || null,
    titleEnglish: item.title?.english || null,
    titleNative: item.title?.native || null,
    synopsis: stripHtml(item.description),
    format,
    mediaType: isMovie ? 'movie' : 'tv',
    status: item.status || 'UNKNOWN',
    episodes: item.episodes || null,
    duration: item.duration || null,
    season: item.season || null,
    year: item.seasonYear || null,
    score: item.averageScore ? Number((item.averageScore / 10).toFixed(1)) : null,
    popularity: item.popularity || 0,
    genres: item.genres || [],
    studio: item.studios?.nodes?.[0]?.name || null,
    coverImage: item.coverImage?.extraLarge || item.coverImage?.large || null,
    bannerImage: item.bannerImage || null,
    accentColor: item.coverImage?.color || '#7c5cff',
    nextAiringEpisode: item.nextAiringEpisode || null,
    crunchyrollUrl,
    hidiveUrl,
    streamers,
    anilistUrl: item.siteUrl || `https://anilist.co/anime/${item.id}`,
    malUrl: (item.idMal || ids.malId) ? `https://myanimelist.net/anime/${item.idMal || ids.malId}` : null
  };
}

function normalizeMalMedia(item) {
  const ids = getCachedMappingSync({ malId: item.mal_id });
  const rawType = (item.type || 'TV').toUpperCase();
  const isMovie = rawType === 'MOVIE';

  let crunchyrollUrl = null;
  let hidiveUrl = null;
  const streamers = [];
  for (const st of item.streaming || []) {
    const name = (st.name || '').toLowerCase();
    if (name.includes('crunchyroll')) {
      crunchyrollUrl = st.url;
      if (!streamers.includes('Crunchyroll')) streamers.push('Crunchyroll');
    } else if (name.includes('hidive')) {
      hidiveUrl = st.url;
      if (!streamers.includes('HIDIVE')) streamers.push('HIDIVE');
    }
  }

  return {
    uid: `mal-${item.mal_id}`,
    source: 'mal',
    anilistId: ids.anilistId || null,
    malId: item.mal_id,
    tvdbId: ids.tvdbId,
    tmdbId: ids.tmdbId,
    imdbId: ids.imdbId,
    title: item.title_english || item.title || 'Unknown Title',
    titleRomaji: item.title || null,
    titleEnglish: item.title_english || null,
    titleNative: item.title_japanese || null,
    synopsis: item.synopsis || '',
    format: rawType,
    mediaType: isMovie ? 'movie' : 'tv',
    status: (item.status || '').toUpperCase().includes('AIRING')
      ? 'RELEASING'
      : (item.status || '').toUpperCase().includes('NOT YET')
        ? 'NOT_YET_RELEASED'
        : 'FINISHED',
    episodes: item.episodes || null,
    duration: item.duration ? parseInt(item.duration, 10) || null : null,
    season: item.season ? item.season.toUpperCase() : null,
    year: item.year || item.aired?.prop?.from?.year || null,
    score: item.score ? Number(Number(item.score).toFixed(1)) : null,
    popularity: item.members || 0,
    genres: (item.genres || []).map(g => g.name),
    studio: item.studios?.[0]?.name || null,
    coverImage: item.images?.webp?.large_image_url || item.images?.jpg?.large_image_url || null,
    bannerImage: item.trailer?.images?.maximum_image_url || null,
    accentColor: '#3b82f6',
    nextAiringEpisode: null,
    crunchyrollUrl,
    hidiveUrl,
    streamers,
    anilistUrl: ids.anilistId ? `https://anilist.co/anime/${ids.anilistId}` : null,
    malUrl: item.url || `https://myanimelist.net/anime/${item.mal_id}`
  };
}

/**
 * Query AniList GraphQL (also supports filtering specifically by licensed streaming platform: Crunchyroll or HIDIVE)
 */
async function queryAnilist({
  feed = 'trending',
  search = '',
  season,
  year,
  format,
  genre,
  licensedBy,
  sourceLabel = 'anilist',
  page = 1,
  perPage = 24
}) {
  ensureMappingLoaded();

  let sort = ['TRENDING_DESC', 'POPULARITY_DESC'];
  if (feed === 'popular') sort = ['POPULARITY_DESC'];
  else if (feed === 'top') sort = ['SCORE_DESC', 'POPULARITY_DESC'];
  else if (feed === 'seasonal') sort = ['POPULARITY_DESC'];
  else if (feed === 'upcoming') sort = ['POPULARITY_DESC'];

  const variables = {
    page: Number(page) || 1,
    perPage: Number(perPage) || 24,
    sort
  };

  if (search && search.trim()) {
    variables.search = search.trim();
  }
  if (season) {
    variables.season = season.toUpperCase();
  }
  if (year) {
    variables.seasonYear = Number(year);
  }
  if (feed === 'upcoming' && !season && !year) {
    variables.status = 'NOT_YET_RELEASED';
  }
  if (format) {
    variables.format = format.toUpperCase();
  }
  if (genre) {
    variables.genre = genre;
  }
  if (licensedBy) {
    variables.licensedBy = [licensedBy];
  }

  const query = `
    query (
      $page: Int,
      $perPage: Int,
      $search: String,
      $season: MediaSeason,
      $seasonYear: Int,
      $status: MediaStatus,
      $format: MediaFormat,
      $genre: String,
      $licensedBy: [String],
      $sort: [MediaSort]
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          total
          currentPage
          lastPage
          hasNextPage
        }
        media(
          type: ANIME,
          isAdult: false,
          search: $search,
          season: $season,
          seasonYear: $seasonYear,
          status: $status,
          format: $format,
          genre: $genre,
          licensedBy_in: $licensedBy,
          sort: $sort
        ) {
          ${ANILIST_MEDIA_FRAGMENT}
        }
      }
    }
  `;

  const cacheKey = `anilist:${sourceLabel}:${JSON.stringify(variables)}`;
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const json = await fetchWithRetry(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });

  const pageData = json?.data?.Page;
  const items = (pageData?.media || []).map(item => normalizeAnilistMedia(item, sourceLabel));

  const result = {
    source: sourceLabel,
    pageInfo: pageData?.pageInfo || { currentPage: page, hasNextPage: false },
    items
  };
  responseCache.set(cacheKey, { timestamp: Date.now(), data: result });
  return result;
}

/**
 * Query Crunchyroll catalog (via AniList's official Crunchyroll external link / license index)
 */
async function queryCrunchyroll(params) {
  return queryAnilist({
    ...params,
    licensedBy: 'Crunchyroll',
    sourceLabel: 'crunchyroll'
  });
}

/**
 * Query HIDIVE catalog (via AniList's official HIDIVE external link / license index)
 */
async function queryHidive(params) {
  return queryAnilist({
    ...params,
    licensedBy: 'HIDIVE',
    sourceLabel: 'hidive'
  });
}

async function queryMal({ feed = 'trending', search = '', season, year, format, genre, page = 1, perPage = 24 }) {
  ensureMappingLoaded();

  const limit = Math.min(Number(perPage) || 24, 25);
  let url = '';
  const params = new URLSearchParams({
    page: String(page || 1),
    limit: String(limit),
    sfw: 'true'
  });

  const jikanTypeMap = {
    TV: 'tv',
    MOVIE: 'movie',
    OVA: 'ova',
    ONA: 'ona',
    SPECIAL: 'special'
  };
  const mappedFormat = format ? jikanTypeMap[format.toUpperCase()] : null;

  if (search && search.trim()) {
    params.set('q', search.trim());
    params.set('order_by', 'members');
    params.set('sort', 'desc');
    if (mappedFormat) params.set('type', mappedFormat);
    url = `${JIKAN_ENDPOINT}/anime?${params.toString()}`;
  } else if (season && year) {
    if (mappedFormat) params.set('filter', mappedFormat);
    url = `${JIKAN_ENDPOINT}/seasons/${Number(year)}/${season.toLowerCase()}?${params.toString()}`;
  } else if (feed === 'seasonal') {
    if (mappedFormat) params.set('filter', mappedFormat);
    url = `${JIKAN_ENDPOINT}/seasons/now?${params.toString()}`;
  } else if (feed === 'upcoming') {
    if (mappedFormat) params.set('filter', mappedFormat);
    url = `${JIKAN_ENDPOINT}/seasons/upcoming?${params.toString()}`;
  } else if (feed === 'trending') {
    if (mappedFormat) params.set('type', mappedFormat);
    params.set('filter', 'airing');
    url = `${JIKAN_ENDPOINT}/top/anime?${params.toString()}`;
  } else if (feed === 'popular') {
    if (mappedFormat) params.set('type', mappedFormat);
    params.set('filter', 'bypopularity');
    url = `${JIKAN_ENDPOINT}/top/anime?${params.toString()}`;
  } else {
    if (mappedFormat) params.set('type', mappedFormat);
    url = `${JIKAN_ENDPOINT}/top/anime?${params.toString()}`;
  }

  const cacheKey = `mal:${url}`;
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const json = await fetchWithRetry(url, { timeoutMs: 9000 }, 1);
    const seen = new Set();
    const items = [];
    for (const raw of json.data || []) {
      if (!seen.has(raw.mal_id)) {
        seen.add(raw.mal_id);
        items.push(normalizeMalMedia(raw));
      }
    }

    const result = {
      source: 'mal',
      pageInfo: {
        currentPage: json.pagination?.current_page || Number(page),
        lastPage: json.pagination?.last_visible_page || 1,
        hasNextPage: Boolean(json.pagination?.has_next_page)
      },
      items
    };
    responseCache.set(cacheKey, { timestamp: Date.now(), data: result });
    return result;
  } catch (jikanErr) {
    console.warn(`Jikan API timed out or failed (${jikanErr.message}), falling back to MAL-mapped AniList feed...`);
    // Seamless fallback to AniList with idMal mapping so the MyAnimeList tab never hangs if Jikan is down/rate-limiting
    const fallback = await queryAnilist({ feed, search, season, year, format, genre, sourceLabel: 'mal', page, perPage });
    return {
      ...fallback,
      items: fallback.items.filter(i => i.malId)
    };
  }
}

/**
 * Scan a user's personal AniList watchlist (e.g. Planning / Watching)
 */
async function scanUserWatchlist({ source = 'anilist', username, listStatus = 'PLANNING' }) {
  if (!username || !username.trim()) {
    throw new Error('Username is required to scan a watchlist');
  }
  ensureMappingLoaded();
  const cleanUser = username.trim();

  if (source === 'anilist') {
    const query = `
      query ($userName: String, $status: MediaListStatus) {
        MediaListCollection(userName: $userName, type: ANIME, status: $status) {
          lists {
            name
            entries {
              media {
                ${ANILIST_MEDIA_FRAGMENT}
              }
            }
          }
        }
      }
    `;
    const json = await fetchWithRetry(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { userName: cleanUser, status: listStatus.toUpperCase() }
      })
    });
    if (json.errors?.length) {
      throw new Error(json.errors[0].message);
    }
    const lists = json.data?.MediaListCollection?.lists || [];
    const seen = new Set();
    const items = [];
    for (const list of lists) {
      for (const entry of list.entries || []) {
        if (entry.media && !seen.has(entry.media.id)) {
          seen.add(entry.media.id);
          items.push(normalizeAnilistMedia(entry.media));
        }
      }
    }
    return {
      source: 'anilist',
      username: cleanUser,
      items
    };
  } else {
    throw new Error('For personal list scanning without API keys, please use an AniList username.');
  }
}

module.exports = {
  queryAnilist,
  queryMal,
  queryCrunchyroll,
  queryHidive,
  scanUserWatchlist,
  normalizeAnilistMedia,
  normalizeMalMedia
};
