const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Use isolated temp data dir for tests
const TEST_DATA_DIR = path.join(__dirname, '..', 'data_test');
process.env.DATA_DIR = TEST_DATA_DIR;

const { indexList, getCachedMappingSync } = require('../src/mapper');
const { normalizeAnilistMedia, normalizeMalMedia } = require('../src/animeProviders');
const { saveConfig } = require('../src/config');
const { requestViaSeerr, requestViaSonarr, requestViaRadarr, attachLibraryStatuses, refreshArrLibraryCache } = require('../src/integrations');

test('ID Mapper maps AniList and MAL IDs to TVDB and TMDB IDs', () => {
  indexList([
    {
      anilist_id: 154587,
      mal_id: 52991,
      thetvdb_id: 424536,
      themoviedb_id: 209867
    },
    {
      anilist_id: 21519,
      mal_id: 32281,
      themoviedb_id: 372058
    }
  ]);

  const byAni = getCachedMappingSync({ anilistId: 154587 });
  assert.equal(byAni.malId, 52991);
  assert.equal(byAni.tvdbId, 424536);
  assert.equal(byAni.tmdbId, 209867);

  const byMal = getCachedMappingSync({ malId: 52991 });
  assert.equal(byMal.anilistId, 154587);
  assert.equal(byMal.tvdbId, 424536);
});

test('Normalizers produce unified schema for TV series and Movies', () => {
  const aniItem = normalizeAnilistMedia({
    id: 154587,
    idMal: 52991,
    title: { english: 'Frieren: Beyond Journey’s End', romaji: 'Sousou no Frieren' },
    description: 'An elf mage journeys after the defeat of the Demon King.<br><br><i>Source: Manga</i>',
    format: 'TV',
    status: 'FINISHED',
    episodes: 28,
    season: 'FALL',
    seasonYear: 2023,
    averageScore: 91,
    genres: ['Adventure', 'Drama', 'Fantasy'],
    coverImage: { extraLarge: 'https://example.com/frieren.jpg' }
  });

  assert.equal(aniItem.mediaType, 'tv');
  assert.equal(aniItem.tvdbId, 424536);
  assert.equal(aniItem.score, 9.1);
  assert.ok(!aniItem.synopsis.includes('<br>'));

  const malMovie = normalizeMalMedia({
    mal_id: 32281,
    title: 'Kimi no Na wa.',
    title_english: 'Your Name.',
    type: 'Movie',
    episodes: 1,
    score: 8.85,
    year: 2016,
    genres: [{ name: 'Drama' }, { name: 'Supernatural' }]
  });

  assert.equal(malMovie.mediaType, 'movie');
  assert.equal(malMovie.format, 'MOVIE');
  assert.equal(malMovie.title, 'Your Name.');
});

test('Request routing to Seerr, Sonarr, and Radarr + Live Library Status Badges', async (t) => {
  const receivedRequests = {
    seerr: null,
    sonarr: null,
    radarr: null
  };

  const originalFetch = global.fetch;
  global.fetch = async (urlStr, options = {}) => {
    const url = new URL(urlStr);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;

    const jsonResponse = (obj, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(obj),
      json: async () => obj
    });

    // Seerr endpoints
    if (url.pathname === '/api/v1/search') {
      return jsonResponse({
        results: [{ id: 209867, mediaType: 'tv', tvdbId: 424536, name: 'Frieren' }]
      });
    }
    if (url.pathname === '/api/v1/request' && method === 'POST') {
      receivedRequests.seerr = body;
      return jsonResponse({ id: 1, status: 2 });
    }

    // Sonarr endpoints
    if (url.pathname === '/api/v3/series/lookup') {
      return jsonResponse([
        { title: 'Frieren', tvdbId: 424536, seasons: [{ seasonNumber: 1, monitored: true }] }
      ]);
    }
    if (url.pathname === '/api/v3/series' && method === 'GET') {
      return jsonResponse([
        {
          id: 99,
          title: 'Frieren',
          tvdbId: 424536,
          monitored: true,
          statistics: { episodeFileCount: 28, episodeCount: 28 }
        }
      ]);
    }
    if (url.pathname === '/api/v3/series' && method === 'POST') {
      receivedRequests.sonarr = body;
      return jsonResponse({ id: 10, title: 'Frieren', tvdbId: 424536 });
    }

    // Radarr endpoints
    if (url.pathname.startsWith('/api/v3/movie/lookup')) {
      return jsonResponse([
        { title: 'Your Name.', tmdbId: 372058, year: 2016 }
      ]);
    }
    if (url.pathname === '/api/v3/movie' && method === 'GET') {
      return jsonResponse([]);
    }
    if (url.pathname === '/api/v3/movie' && method === 'POST') {
      receivedRequests.radarr = body;
      return jsonResponse({ id: 20, title: 'Your Name.', tmdbId: 372058 });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  };

  t.after(() => {
    global.fetch = originalFetch;
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  saveConfig({
    defaultMode: 'both',
    seerr: { url: 'http://seerr.local:5055', apiKey: 'test-seerr-key' },
    sonarr: {
      url: 'http://sonarr.local:8989',
      apiKey: 'test-sonarr-key',
      qualityProfileId: 4,
      rootFolderPath: '/anime',
      seriesType: 'anime',
      searchOnAdd: true
    },
    radarr: {
      url: 'http://radarr.local:7878',
      apiKey: 'test-radarr-key',
      qualityProfileId: 2,
      rootFolderPath: '/anime-movies',
      searchOnAdd: true
    }
  });

  // 1. Test Seerr request
  const seerrResult = await requestViaSeerr({
    anilistId: 154587,
    malId: 52991,
    title: 'Frieren',
    mediaType: 'tv'
  });
  assert.equal(seerrResult.service, 'seerr');
  assert.equal(receivedRequests.seerr.mediaType, 'tv');
  assert.equal(receivedRequests.seerr.mediaId, 209867);
  assert.equal(receivedRequests.seerr.tvdbId, 424536);

  // 2. Test Sonarr direct request
  const sonarrResult = await requestViaSonarr({
    anilistId: 154587,
    malId: 52991,
    title: 'Frieren',
    mediaType: 'tv'
  });
  assert.equal(sonarrResult.service, 'sonarr');
  assert.equal(receivedRequests.sonarr.tvdbId, 424536);
  assert.equal(receivedRequests.sonarr.seriesType, 'anime');
  assert.equal(receivedRequests.sonarr.rootFolderPath, '/anime');
  assert.equal(receivedRequests.sonarr.addOptions.searchForMissingEpisodes, true);

  // 3. Test Radarr direct request for an anime movie
  const radarrResult = await requestViaRadarr({
    malId: 32281,
    title: 'Your Name.',
    mediaType: 'movie',
    format: 'MOVIE'
  });
  assert.equal(radarrResult.service, 'radarr');
  assert.equal(receivedRequests.radarr.tmdbId, 372058);
  assert.equal(receivedRequests.radarr.rootFolderPath, '/anime-movies');
  assert.equal(receivedRequests.radarr.addOptions.searchForMovie, true);

  // 4. Test Live Library Status Badges
  await refreshArrLibraryCache(true);
  const decorated = await attachLibraryStatuses([
    { title: 'Frieren', mediaType: 'tv', tvdbId: 424536 }
  ]);
  assert.equal(decorated[0].libraryStatus.service, 'sonarr');
  assert.equal(decorated[0].libraryStatus.state, 'available');
  assert.match(decorated[0].libraryStatus.label, /28\/28 eps/);
});
