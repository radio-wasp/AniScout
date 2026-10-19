const fs = require('fs');
const os = require('os');
const path = require('path');

function resolveWritableDataDir() {
  const candidates = [
    process.env.DATA_DIR,
    path.join(__dirname, '..', 'data'),
    path.join(os.tmpdir(), 'aniscout-data')
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o777 });
      }
      fs.accessSync(dir, fs.constants.W_OK);
      const testFile = path.join(dir, '.write-test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      return dir;
    } catch (err) {
      console.warn(`Directory "${dir}" is not writable (${err.code || err.message}), trying fallback...`);
    }
  }
  return path.join(os.tmpdir(), 'aniscout-data');
}

const DATA_DIR = resolveWritableDataDir();
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
  defaultMode: process.env.DEFAULT_MODE || 'both', // 'seerr', 'arr', 'both'
  seerr: {
    url: (process.env.SEERR_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.SEERR_API_KEY || ''
  },
  sonarr: {
    url: (process.env.SONARR_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.SONARR_API_KEY || '',
    qualityProfileId: process.env.SONARR_QUALITY_PROFILE_ID ? Number(process.env.SONARR_QUALITY_PROFILE_ID) : null,
    rootFolderPath: process.env.SONARR_ROOT_FOLDER || '',
    languageProfileId: process.env.SONARR_LANGUAGE_PROFILE_ID ? Number(process.env.SONARR_LANGUAGE_PROFILE_ID) : 1,
    seriesType: process.env.SONARR_ANIME_SERIES_TYPE || 'anime',
    searchOnAdd: process.env.SONARR_SEARCH_ON_ADD !== 'false',
    seasonFolder: true,
    tags: []
  },
  radarr: {
    url: (process.env.RADARR_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.RADARR_API_KEY || '',
    qualityProfileId: process.env.RADARR_QUALITY_PROFILE_ID ? Number(process.env.RADARR_QUALITY_PROFILE_ID) : null,
    rootFolderPath: process.env.RADARR_ROOT_FOLDER || '',
    minimumAvailability: 'released',
    searchOnAdd: process.env.RADARR_SEARCH_ON_ADD !== 'false',
    tags: []
  }
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o777 });
  }
}

function getConfig() {
  ensureDataDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    return structuredClone(DEFAULT_CONFIG);
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const saved = JSON.parse(raw);
    return {
      defaultMode: saved.defaultMode || DEFAULT_CONFIG.defaultMode,
      seerr: {
        url: (saved.seerr?.url ?? DEFAULT_CONFIG.seerr.url).replace(/\/+$/, ''),
        apiKey: saved.seerr?.apiKey ?? DEFAULT_CONFIG.seerr.apiKey
      },
      sonarr: {
        ...DEFAULT_CONFIG.sonarr,
        ...(saved.sonarr || {}),
        url: (saved.sonarr?.url ?? DEFAULT_CONFIG.sonarr.url).replace(/\/+$/, '')
      },
      radarr: {
        ...DEFAULT_CONFIG.radarr,
        ...(saved.radarr || {}),
        url: (saved.radarr?.url ?? DEFAULT_CONFIG.radarr.url).replace(/\/+$/, '')
      }
    };
  } catch (err) {
    console.error('Failed to read config.json, using defaults:', err.message);
    return structuredClone(DEFAULT_CONFIG);
  }
}

function saveConfig(newConfig) {
  ensureDataDir();
  const current = getConfig();
  const merged = {
    defaultMode: newConfig.defaultMode || current.defaultMode,
    seerr: {
      url: ((newConfig.seerr?.url ?? current.seerr.url) || '').trim().replace(/\/+$/, ''),
      apiKey: (newConfig.seerr?.apiKey ?? current.seerr.apiKey ?? '').trim()
    },
    sonarr: {
      ...current.sonarr,
      ...(newConfig.sonarr || {}),
      url: ((newConfig.sonarr?.url ?? current.sonarr.url) || '').trim().replace(/\/+$/, ''),
      apiKey: (newConfig.sonarr?.apiKey ?? current.sonarr.apiKey ?? '').trim()
    },
    radarr: {
      ...current.radarr,
      ...(newConfig.radarr || {}),
      url: ((newConfig.radarr?.url ?? current.radarr.url) || '').trim().replace(/\/+$/, ''),
      apiKey: (newConfig.radarr?.apiKey ?? current.radarr.apiKey ?? '').trim()
    }
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

module.exports = {
  DATA_DIR,
  getConfig,
  saveConfig
};
