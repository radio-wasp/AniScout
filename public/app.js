const state = {
  source: 'anilist',
  feed: 'trending',
  search: '',
  season: '',
  year: '',
  format: '',
  genre: '',
  page: 1,
  hasNextPage: false,
  hideInLibrary: false,
  items: [],
  config: {
    defaultMode: 'both',
    status: {
      seerrConfigured: false,
      sonarrConfigured: false,
      radarrConfigured: false
    }
  }
};

// Populate year filter dropdown dynamically
function initYearDropdown() {
  const yearSelect = document.getElementById('filter-year');
  const currentYear = new Date().getFullYear() + 1;
  for (let y = currentYear; y >= 1980; y--) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    yearSelect.appendChild(opt);
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : ''}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 4500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    const cfg = await res.json();
    state.config = cfg;
    updateStatusPills();
    populateSettingsForm(cfg);
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

function updateStatusPills() {
  const { seerrConfigured, sonarrConfigured, radarrConfigured } = state.config.status || {};
  const pillSeerr = document.getElementById('pill-seerr');
  const pillSonarr = document.getElementById('pill-sonarr');
  const pillRadarr = document.getElementById('pill-radarr');

  pillSeerr.className = `pill ${seerrConfigured ? 'pill-active' : 'pill-muted'}`;
  pillSeerr.textContent = seerrConfigured ? '✓ Seerr' : 'Seerr';

  pillSonarr.className = `pill ${sonarrConfigured ? 'pill-active' : 'pill-muted'}`;
  pillSonarr.textContent = sonarrConfigured ? '✓ Sonarr' : 'Sonarr';

  pillRadarr.className = `pill ${radarrConfigured ? 'pill-active' : 'pill-muted'}`;
  pillRadarr.textContent = radarrConfigured ? '✓ Radarr' : 'Radarr';
}

const SOURCE_LABELS = {
  anilist: 'AniList',
  mal: 'MyAnimeList',
  crunchyroll: 'Crunchyroll',
  hidive: 'HIDIVE'
};

async function fetchDiscover() {
  const grid = document.getElementById('anime-grid');
  const summary = document.getElementById('results-summary');
  const sourceName = SOURCE_LABELS[state.source] || 'Catalog';
  summary.textContent = `Scanning ${sourceName}...`;
  grid.innerHTML = '';

  const params = new URLSearchParams({
    source: state.source,
    feed: state.feed,
    page: String(state.page)
  });

  if (state.search) params.set('search', state.search);
  if (state.season) params.set('season', state.season);
  if (state.year) params.set('year', state.year);
  if (state.format) params.set('format', state.format);
  if (state.genre) params.set('genre', state.genre);

  try {
    const res = await fetch(`/api/discover?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load anime');

    state.items = data.items || [];
    state.hasNextPage = Boolean(data.pageInfo?.hasNextPage);

    document.getElementById('page-indicator').textContent = `Page ${state.page}`;
    document.getElementById('btn-prev-page').disabled = state.page <= 1;
    document.getElementById('btn-next-page').disabled = !state.hasNextPage;

    renderGrid();
  } catch (err) {
    summary.textContent = `Error: ${err.message}`;
    showToast(err.message, 'error');
  }
}

function buildActionButtonsHtml(item) {
  const mode = state.config.defaultMode || 'both';
  const isMovie = item.mediaType === 'movie';
  const arrTarget = isMovie ? 'radarr' : 'sonarr';
  const arrLabel = isMovie ? 'Radarr' : 'Sonarr';
  const arrBtnClass = isMovie ? 'btn-radarr' : 'btn-sonarr';

  if (mode === 'seerr') {
    return `
      <div class="card-action-row">
        <button class="btn btn-sm btn-seerr" data-action="request" data-target="seerr" data-uid="${escapeHtml(item.uid)}">
          📥 Request (Seerr)
        </button>
      </div>
    `;
  }

  if (mode === 'arr') {
    return `
      <div class="card-action-row">
        <button class="btn btn-sm ${arrBtnClass}" data-action="request" data-target="${arrTarget}" data-uid="${escapeHtml(item.uid)}">
          ➕ Add to ${arrLabel}
        </button>
      </div>
    `;
  }

  // 'both' mode
  return `
    <div class="card-action-row">
      <button class="btn btn-sm btn-seerr" data-action="request" data-target="seerr" data-uid="${escapeHtml(item.uid)}" title="Request via Overseerr / Jellyseerr">
        📥 Seerr
      </button>
      <button class="btn btn-sm ${arrBtnClass}" data-action="request" data-target="${arrTarget}" data-uid="${escapeHtml(item.uid)}" title="Add directly to ${arrLabel}">
        ➕ ${arrLabel}
      </button>
    </div>
  `;
}

function renderGrid() {
  const grid = document.getElementById('anime-grid');
  const summary = document.getElementById('results-summary');

  const visibleItems = state.hideInLibrary
    ? state.items.filter(item => !item.libraryStatus)
    : state.items;

  const sourceName = SOURCE_LABELS[state.source] || 'Catalog';
  summary.textContent = `Showing ${visibleItems.length} anime from ${sourceName}`;

  if (visibleItems.length === 0) {
    grid.innerHTML = `<div class="muted" style="grid-column: 1/-1; padding: 2rem; text-align:center;">No anime matched your current filters.</div>`;
    return;
  }

  grid.innerHTML = visibleItems
    .map(item => {
      const scoreBadge = item.score ? `<span class="badge badge-score">★ ${item.score}</span>` : '<span></span>';
      const formatBadge = `<span class="badge badge-format">${escapeHtml(item.format || 'TV')}${item.episodes ? ` · ${item.episodes} ep` : ''}</span>`;

      let libBadgeHtml = '';
      if (item.libraryStatus) {
        const cls = item.libraryStatus.state === 'available' ? 'lib-available' : 'lib-monitored';
        libBadgeHtml = `<div class="card-library-badge ${cls}">✓ ${escapeHtml(item.libraryStatus.label)}</div>`;
      }

      const streamTags = [];
      if (item.crunchyrollUrl || (item.streamers || []).includes('Crunchyroll')) {
        streamTags.push(`<span class="genre-tag stream-tag-cr">Crunchyroll</span>`);
      }
      if (item.hidiveUrl || (item.streamers || []).includes('HIDIVE')) {
        streamTags.push(`<span class="genre-tag stream-tag-hidive">HIDIVE</span>`);
      }

      const genresHtml = [
        ...streamTags,
        ...(item.genres || []).slice(0, 3).map(g => `<span class="genre-tag">${escapeHtml(g)}</span>`)
      ].join('');

      const metaParts = [];
      if (item.season && item.year) metaParts.push(`${item.season} ${item.year}`);
      else if (item.year) metaParts.push(String(item.year));
      if (item.studio) metaParts.push(item.studio);

      const extLinks = [];
      if (item.anilistUrl) extLinks.push(`<a href="${escapeHtml(item.anilistUrl)}" target="_blank" rel="noopener">AniList ↗</a>`);
      if (item.malUrl) extLinks.push(`<a href="${escapeHtml(item.malUrl)}" target="_blank" rel="noopener">MAL ↗</a>`);
      if (item.crunchyrollUrl) extLinks.push(`<a href="${escapeHtml(item.crunchyrollUrl)}" target="_blank" rel="noopener">CR ↗</a>`);
      if (item.hidiveUrl) extLinks.push(`<a href="${escapeHtml(item.hidiveUrl)}" target="_blank" rel="noopener">HIDIVE ↗</a>`);

      return `
        <article class="anime-card" data-uid="${escapeHtml(item.uid)}">
          <div class="card-poster-wrap" data-action="details" data-uid="${escapeHtml(item.uid)}">
            <img
              class="card-poster"
              src="${escapeHtml(item.coverImage || '')}"
              alt="${escapeHtml(item.title)}"
              loading="lazy"
            />
            <div class="card-badges-top">
              ${scoreBadge}
              ${formatBadge}
            </div>
            ${libBadgeHtml}
          </div>

          <div class="card-body">
            <h3 class="card-title" data-action="details" data-uid="${escapeHtml(item.uid)}" title="${escapeHtml(item.title)}">
              ${escapeHtml(item.title)}
            </h3>
            <div class="card-meta">${escapeHtml(metaParts.join(' • '))}</div>
            <div class="card-genres">${genresHtml}</div>
            <p class="card-synopsis">${escapeHtml(item.synopsis || 'No synopsis available.')}</p>

            <div class="card-actions">
              ${buildActionButtonsHtml(item)}
              <div class="card-links">
                <span>${extLinks.join(' &middot; ')}</span>
                <span>${item.tvdbId ? `TVDB #${item.tvdbId}` : item.tmdbId ? `TMDB #${item.tmdbId}` : ''}</span>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

async function handleRequestClick(btn, item, target) {
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = '⏳ Sending...';

  try {
    const res = await fetch('/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, anime: item })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');

    btn.classList.add('btn-requested');
    btn.textContent = data.status === 'already_exists' ? '✓ In Library' : '✓ Requested';
    showToast(data.message || `Requested "${item.title}"!`, 'success');
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = originalText;
    showToast(err.message, 'error');
  }
}

function openDetailsModal(item) {
  const modal = document.getElementById('details-modal');
  const content = document.getElementById('details-content');

  content.innerHTML = `
    <div class="details-layout">
      <div>
        <img class="details-poster" src="${escapeHtml(item.coverImage || '')}" alt="${escapeHtml(item.title)}" />
      </div>
      <div class="details-info">
        <h2>${escapeHtml(item.title)}</h2>
        <div class="details-subtitles">
          ${item.titleRomaji && item.titleRomaji !== item.title ? `<div>Romaji: ${escapeHtml(item.titleRomaji)}</div>` : ''}
          ${item.titleNative ? `<div>Native: ${escapeHtml(item.titleNative)}</div>` : ''}
        </div>
        <div class="card-genres" style="margin-bottom:0.65rem;">
          <span class="badge badge-format">${escapeHtml(item.format || 'TV')}</span>
          ${item.score ? `<span class="badge badge-score">★ ${item.score}</span>` : ''}
          ${item.year ? `<span class="badge">${item.season || ''} ${item.year}</span>` : ''}
          ${item.episodes ? `<span class="badge">${item.episodes} Episodes</span>` : ''}
        </div>
        <div class="details-synopsis">${escapeHtml(item.synopsis || 'No synopsis available.')}</div>
        <div style="margin-top: 1rem;">
          ${buildActionButtonsHtml(item)}
        </div>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
}

function populateSettingsForm(cfg) {
  const radios = document.querySelectorAll('input[name="defaultMode"]');
  radios.forEach(r => {
    r.checked = r.value === (cfg.defaultMode || 'both');
  });

  document.getElementById('cfg-seerr-url').value = cfg.seerr?.url || '';
  document.getElementById('cfg-seerr-key').value = cfg.seerr?.apiKey || '';

  document.getElementById('cfg-sonarr-url').value = cfg.sonarr?.url || '';
  document.getElementById('cfg-sonarr-key').value = cfg.sonarr?.apiKey || '';
  document.getElementById('cfg-sonarr-profile').value = cfg.sonarr?.qualityProfileId || '';
  document.getElementById('cfg-sonarr-root').value = cfg.sonarr?.rootFolderPath || '';
  document.getElementById('cfg-sonarr-type').value = cfg.sonarr?.seriesType || 'anime';
  document.getElementById('cfg-sonarr-search').checked = cfg.sonarr?.searchOnAdd !== false;

  document.getElementById('cfg-radarr-url').value = cfg.radarr?.url || '';
  document.getElementById('cfg-radarr-key').value = cfg.radarr?.apiKey || '';
  document.getElementById('cfg-radarr-profile').value = cfg.radarr?.qualityProfileId || '';
  document.getElementById('cfg-radarr-root').value = cfg.radarr?.rootFolderPath || '';
  document.getElementById('cfg-radarr-search').checked = cfg.radarr?.searchOnAdd !== false;
}

async function testIntegration(service) {
  const feedbackEl = document.getElementById(`test-result-${service}`);
  feedbackEl.textContent = 'Testing connection...';
  feedbackEl.style.color = '#94a3b8';

  let customConfig = {};
  if (service === 'seerr') {
    customConfig = {
      url: document.getElementById('cfg-seerr-url').value,
      apiKey: document.getElementById('cfg-seerr-key').value
    };
  } else if (service === 'sonarr') {
    customConfig = {
      url: document.getElementById('cfg-sonarr-url').value,
      apiKey: document.getElementById('cfg-sonarr-key').value
    };
  } else if (service === 'radarr') {
    customConfig = {
      url: document.getElementById('cfg-radarr-url').value,
      apiKey: document.getElementById('cfg-radarr-key').value
    };
  }

  try {
    const res = await fetch('/api/integrations/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service, config: customConfig })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Connection test failed');

    feedbackEl.style.color = '#10b981';
    feedbackEl.textContent = `✓ Connected (v${data.version})`;

    if ((service === 'sonarr' || service === 'radarr') && data.qualityProfiles) {
      const profileSelect = document.getElementById(`select-${service}-profile`);
      const profileInput = document.getElementById(`cfg-${service}-profile`);
      profileSelect.innerHTML = data.qualityProfiles
        .map(p => `<option value="${p.id}">${escapeHtml(p.name)} (#${p.id})</option>`)
        .join('');
      profileSelect.classList.remove('hidden');
      if (!profileInput.value && data.qualityProfiles[0]) {
        profileInput.value = data.qualityProfiles[0].id;
      }
      profileSelect.onchange = () => {
        profileInput.value = profileSelect.value;
      };

      const rootSelect = document.getElementById(`select-${service}-root`);
      const rootInput = document.getElementById(`cfg-${service}-root`);
      rootSelect.innerHTML = data.rootFolders
        .map(r => `<option value="${escapeHtml(r.path)}">${escapeHtml(r.path)}</option>`)
        .join('');
      rootSelect.classList.remove('hidden');
      if (!rootInput.value && data.rootFolders[0]) {
        rootInput.value = data.rootFolders[0].path;
      }
      rootSelect.onchange = () => {
        rootInput.value = rootSelect.value;
      };
    }
  } catch (err) {
    feedbackEl.style.color = '#ef4444';
    feedbackEl.textContent = `✗ ${err.message}`;
  }
}

function bindEvents() {
  // Source switcher (AniList vs MAL)
  document.querySelectorAll('.source-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.source = btn.dataset.source;
      state.page = 1;
      fetchDiscover();
    });
  });

  // Feed tabs
  document.querySelectorAll('.feed-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.feed-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.feed = tab.dataset.feed;
      state.page = 1;
      fetchDiscover();
    });
  });

  // Search
  const searchInput = document.getElementById('search-input');
  document.getElementById('btn-search').addEventListener('click', () => {
    state.search = searchInput.value.trim();
    state.page = 1;
    fetchDiscover();
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      state.search = searchInput.value.trim();
      state.page = 1;
      fetchDiscover();
    }
  });

  // Filters
  ['season', 'year', 'format', 'genre'].forEach(key => {
    document.getElementById(`filter-${key}`).addEventListener('change', e => {
      state[key] = e.target.value;
      state.page = 1;
      fetchDiscover();
    });
  });

  document.getElementById('toggle-hide-in-library').addEventListener('change', e => {
    state.hideInLibrary = e.target.checked;
    renderGrid();
  });

  // Pagination
  document.getElementById('btn-prev-page').addEventListener('click', () => {
    if (state.page > 1) {
      state.page--;
      fetchDiscover();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
  document.getElementById('btn-next-page').addEventListener('click', () => {
    if (state.hasNextPage) {
      state.page++;
      fetchDiscover();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  // Watchlist drawer
  const watchlistDrawer = document.getElementById('watchlist-drawer');
  document.getElementById('btn-open-watchlist').addEventListener('click', () => {
    watchlistDrawer.classList.toggle('hidden');
  });
  document.getElementById('btn-close-watchlist').addEventListener('click', () => {
    watchlistDrawer.classList.add('hidden');
  });
  document.getElementById('btn-run-watchlist').addEventListener('click', async () => {
    const username = document.getElementById('watchlist-username').value.trim();
    const listStatus = document.getElementById('watchlist-status').value;
    if (!username) {
      showToast('Enter an AniList username first', 'error');
      return;
    }
    const summary = document.getElementById('results-summary');
    summary.textContent = `Scanning ${username}'s AniList (${listStatus})...`;
    try {
      const res = await fetch(`/api/watchlist?source=anilist&username=${encodeURIComponent(username)}&status=${encodeURIComponent(listStatus)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load watchlist');
      state.items = data.items || [];
      renderGrid();
      summary.textContent = `Loaded ${state.items.length} anime from ${username}'s AniList (${listStatus})`;
    } catch (err) {
      showToast(err.message, 'error');
      summary.textContent = `Watchlist scan error: ${err.message}`;
    }
  });

  // Delegated clicks on grid and details modal
  document.body.addEventListener('click', e => {
    const reqBtn = e.target.closest('[data-action="request"]');
    if (reqBtn) {
      const uid = reqBtn.dataset.uid;
      const target = reqBtn.dataset.target;
      const item = state.items.find(i => i.uid === uid);
      if (item) handleRequestClick(reqBtn, item, target);
      return;
    }

    const detailsTrigger = e.target.closest('[data-action="details"]');
    if (detailsTrigger) {
      const uid = detailsTrigger.dataset.uid;
      const item = state.items.find(i => i.uid === uid);
      if (item) openDetailsModal(item);
    }
  });

  // Close details modal
  const detailsModal = document.getElementById('details-modal');
  document.getElementById('btn-close-details').addEventListener('click', () => {
    detailsModal.classList.add('hidden');
  });
  detailsModal.addEventListener('click', e => {
    if (e.target === detailsModal) detailsModal.classList.add('hidden');
  });

  // Settings modal
  const settingsModal = document.getElementById('settings-modal');
  document.getElementById('btn-open-settings').addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
  });
  document.getElementById('btn-close-settings').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });
  document.getElementById('btn-cancel-settings').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  document.getElementById('btn-test-seerr').addEventListener('click', () => testIntegration('seerr'));
  document.getElementById('btn-test-sonarr').addEventListener('click', () => testIntegration('sonarr'));
  document.getElementById('btn-test-radarr').addEventListener('click', () => testIntegration('radarr'));

  document.getElementById('settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    const selectedMode = document.querySelector('input[name="defaultMode"]:checked')?.value || 'both';
    const payload = {
      defaultMode: selectedMode,
      seerr: {
        url: document.getElementById('cfg-seerr-url').value.trim(),
        apiKey: document.getElementById('cfg-seerr-key').value.trim()
      },
      sonarr: {
        url: document.getElementById('cfg-sonarr-url').value.trim(),
        apiKey: document.getElementById('cfg-sonarr-key').value.trim(),
        qualityProfileId: Number(document.getElementById('cfg-sonarr-profile').value) || null,
        rootFolderPath: document.getElementById('cfg-sonarr-root').value.trim(),
        seriesType: document.getElementById('cfg-sonarr-type').value,
        searchOnAdd: document.getElementById('cfg-sonarr-search').checked
      },
      radarr: {
        url: document.getElementById('cfg-radarr-url').value.trim(),
        apiKey: document.getElementById('cfg-radarr-key').value.trim(),
        qualityProfileId: Number(document.getElementById('cfg-radarr-profile').value) || null,
        rootFolderPath: document.getElementById('cfg-radarr-root').value.trim(),
        searchOnAdd: document.getElementById('cfg-radarr-search').checked
      }
    };

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error || 'Failed to save settings');
      state.config = updated;
      updateStatusPills();
      renderGrid();
      settingsModal.classList.add('hidden');
      showToast('Integration settings saved!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  initYearDropdown();
  bindEvents();
  await loadConfig();
  await fetchDiscover();
});
