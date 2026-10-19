const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { getConfig, saveConfig } = require('./src/config');
const {
  queryAnilist,
  queryMal,
  queryCrunchyroll,
  queryHidive,
  scanUserWatchlist
} = require('./src/animeProviders');
const {
  attachLibraryStatuses,
  requestViaSeerr,
  requestViaSonarr,
  requestViaRadarr,
  probeService
} = require('./src/integrations');
const { ensureMappingLoaded, resolveExternalIds } = require('./src/mapper');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;

  if ( req.method === 'GET' && pathname === '/api/health' ) {
    return sendJson(res, 200, { status: 'ok', service: 'aniscout', timestamp: new Date().toISOString() });
  }

  if ( req.method === 'GET' && pathname === '/api/config' ) {
    const cfg = getConfig();
    return sendJson(res, 200, {
      ...cfg,
      status: {
        seerrConfigured: Boolean(cfg.seerr.url && cfg.seerr.apiKey),
        sonarrConfigured: Boolean(cfg.sonarr.url && cfg.sonarr.apiKey),
        radarrConfigured: Boolean(cfg.radarr.url && cfg.radarr.apiKey)
      }
    });
  }

  if ( req.method === 'POST' && pathname === '/api/config' ) {
    const body = await readJsonBody(req);
    const updated = saveConfig(body);
    return sendJson(res, 200, {
      ...updated,
      status: {
        seerrConfigured: Boolean(updated.seerr.url && updated.seerr.apiKey),
        sonarrConfigured: Boolean(updated.sonarr.url && updated.sonarr.apiKey),
        radarrConfigured: Boolean(updated.radarr.url && updated.radarr.apiKey)
      }
    });
  }

  if ( req.method === 'POST' && pathname === '/api/integrations/test' ) {
    const body = await readJsonBody(req);
    const { service, config } = body;
    const result = await probeService(service, config || {});
    return sendJson(res, 200, result);
  }

  if ( req.method === 'GET' && pathname === '/api/discover' ) {
    const source = (parsedUrl.searchParams.get('source') || 'anilist').toLowerCase();
    const feed = (parsedUrl.searchParams.get('feed') || 'trending').toLowerCase();
    const search = parsedUrl.searchParams.get('search') || '';
    const season = parsedUrl.searchParams.get('season') || '';
    const year = parsedUrl.searchParams.get('year') || '';
    const format = parsedUrl.searchParams.get('format') || '';
    const genre = parsedUrl.searchParams.get('genre') || '';
    const page = Number(parsedUrl.searchParams.get('page') || 1);

    let data;
    if (source === 'mal') {
      data = await queryMal({ feed, search, season, year, format, genre, page });
    } else if (source === 'crunchyroll') {
      data = await queryCrunchyroll({ feed, search, season, year, format, genre, page });
    } else if (source === 'hidive') {
      data = await queryHidive({ feed, search, season, year, format, genre, page });
    } else {
      data = await queryAnilist({ feed, search, season, year, format, genre, page });
    }

    const enrichedItems = await attachLibraryStatuses(data.items);
    return sendJson(res, 200, {
      ...data,
      items: enrichedItems
    });
  }

  if ( req.method === 'GET' && pathname === '/api/watchlist' ) {
    const source = (parsedUrl.searchParams.get('source') || 'anilist').toLowerCase();
    const username = parsedUrl.searchParams.get('username') || '';
    const listStatus = parsedUrl.searchParams.get('status') || 'PLANNING';

    const data = await scanUserWatchlist({ source, username, listStatus });
    const enrichedItems = await attachLibraryStatuses(data.items);
    return sendJson(res, 200, {
      ...data,
      items: enrichedItems
    });
  }

  if ( req.method === 'POST' && pathname === '/api/request' ) {
    const body = await readJsonBody(req);
    const { target, anime } = body;
    if (!anime || !anime.title) {
      return sendJson(res, 400, { error: 'Missing anime details in request body' });
    }

    const cfg = getConfig();
    const chosenTarget = target || (cfg.defaultMode === 'seerr' ? 'seerr' : 'arr');

    let result;
    if (chosenTarget === 'seerr') {
      result = await requestViaSeerr(anime);
    } else if (chosenTarget === 'sonarr') {
      result = await requestViaSonarr(anime);
    } else if (chosenTarget === 'radarr') {
      result = await requestViaRadarr(anime);
    } else {
      // Auto route 'arr' based on movie vs tv format
      if (anime.mediaType === 'movie' || anime.format === 'MOVIE') {
        result = await requestViaRadarr(anime);
      } else {
        result = await requestViaSonarr(anime);
      }
    }

    return sendJson(res, 200, result);
  }

  if ( req.method === 'GET' && pathname === '/api/resolve-ids' ) {
    const anilistId = parsedUrl.searchParams.get('anilistId');
    const malId = parsedUrl.searchParams.get('malId');
    const ids = await resolveExternalIds({ anilistId, malId });
    return sendJson(res, 200, ids);
  }

  return sendJson(res, 404, { error: `Unknown API endpoint: ${pathname}` });
}

function createAppServer() {
  return http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (parsedUrl.pathname.startsWith('/api/')) {
        try {
          await handleApi(req, res, parsedUrl);
        } catch (apiErr) {
          console.error(`API Error [${req.method} ${parsedUrl.pathname}]:`, apiErr.message);
          sendJson(res, 500, { error: apiErr.message || 'Internal Server Error' });
        }
        return;
      }

      // Serve static files from /public
      let relPath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
      const safePath = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(PUBLIC_DIR, safePath);

      if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        const indexHtml = path.join(PUBLIC_DIR, 'index.html');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(indexHtml));
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(fs.readFileSync(filePath));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unexpected server error' }));
    }
  });
}

if (require.main === module) {
  ensureMappingLoaded().catch(() => {});
  const server = createAppServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`⚡ AniScout running on http://0.0.0.0:${PORT}`);
  });
}

module.exports = { createAppServer };
