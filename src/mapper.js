const fs = require('fs');
const path = require('path');
const https = require('https');
const dns = require('dns');
const { DATA_DIR } = require('./config');

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const MAPPING_Url = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json';
const CACHE_FILE = path.join(DATA_DIR, 'anime-list-mini.json');
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 3; // 3 days

let byAnilist = new Map();
let byMal = new Map();
let loadPromise = null;

function httpsGetJson(urlStr, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'GET',
        family: 4,
        headers: {
          'User-Agent': 'AniScout/1.0',
          'Accept': 'application/json'
        },
        timeout: timeoutMs
      },
      res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return httpsGetJson(res.headers.location, timeoutMs).then(resolve, reject);
        }
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', chunk => (raw += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(raw));
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    req.end();
  });
}

function indexList(list) {
  const nextAnilist = new Map();
  const nextMal = new Map();
  if (Array.isArray(list)) {
    for (const item of list) {
      if (item.anilist_id) nextAnilist.set(Number(item.anilist_id), item);
      if (item.mal_id) nextMal.set(Number(item.mal_id), item);
    }
  }
  byAnilist = nextAnilist;
  byMal = nextMal;
}

function ensureMappingLoaded() {
  if (byAnilist.size > 0 || byMal.size > 0) return Promise.resolve();
  if (loadPromise) return Promise.resolve();

  loadPromise = (async () => {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const stat = fs.statSync(CACHE_FILE);
        const raw = fs.readFileSync(CACHE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        indexList(parsed);
        if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
          return;
        }
      }
    } catch (e) {
      console.warn('Could not read cached ID mapping:', e.message);
    }

    try {
      const list = await httpsGetJson(MAPPING_Url, 20000);
      if (Array.isArray(list)) {
        indexList(list);
        try {
          if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(CACHE_FILE, JSON.stringify(list), 'utf8');
        } catch (writeErr) {
          console.warn('Could not cache anime-list-mini.json:', writeErr.message);
        }
      }
    } catch (err) {
      console.warn('Offline or failed to fetch Fribb anime-lists:', err.message);
    } finally {
      loadPromise = null;
    }
  })();

  // Return immediately so /api/discover never blocks waiting for the 35MB GitHub file
  return Promise.resolve();
}

/**
 * Resolves cross-platform IDs (tvdb_id, tmdb_id, imdb_id, anilist_id, mal_id)
 * from an anime entry containing anilistId, malId, title, year, and format.
 */
async function resolveExternalIds({ anilistId, malId }) {
  await ensureMappingLoaded();
  let match = null;
  if (anilistId && byAnilist.has(Number(anilistId))) {
    match = byAnilist.get(Number(anilistId));
  } else if (malId && byMal.has(Number(malId))) {
    match = byMal.get(Number(malId));
  }

  // Fallback to api.ani.zip if not in mini list
  if (!match && (anilistId || malId)) {
    try {
      const queryParam = anilistId ? `anilist_id=${anilistId}` : `mal_id=${malId}`;
      const data = await httpsGetJson(`https://api.ani.zip/mappings?${queryParam}`, 6000);
      if (data?.mappings) {
        match = {
          anilist_id: data.mappings.anilist_id || anilistId,
          mal_id: data.mappings.mal_id || malId,
          thetvdb_id: data.mappings.thetvdb_id,
          themoviedb_id: data.mappings.themoviedb_id,
          imdb_id: data.mappings.imdb_id
        };
      }
    } catch (_) {
      // Ignore fallback error
    }
  }

  return {
    anilistId: match?.anilist_id || (anilistId ? Number(anilistId) : null),
    malId: match?.mal_id || (malId ? Number(malId) : null),
    tvdbId: match?.thetvdb_id ? Number(match.thetvdb_id) : null,
    tmdbId: match?.themoviedb_id ? Number(match.themoviedb_id) : null,
    imdbId: match?.imdb_id || null
  };
}

function getCachedMappingSync({ anilistId, malId }) {
  let match = null;
  if (anilistId && byAnilist.has(Number(anilistId))) {
    match = byAnilist.get(Number(anilistId));
  } else if (malId && byMal.has(Number(malId))) {
    match = byMal.get(Number(malId));
  }
  return {
    anilistId: match?.anilist_id || (anilistId ? Number(anilistId) : null),
    malId: match?.mal_id || (malId ? Number(malId) : null),
    tvdbId: match?.thetvdb_id ? Number(match.thetvdb_id) : null,
    tmdbId: match?.themoviedb_id ? Number(match.themoviedb_id) : null,
    imdbId: match?.imdb_id || null
  };
}

module.exports = {
  ensureMappingLoaded,
  resolveExternalIds,
  getCachedMappingSync,
  indexList
};
