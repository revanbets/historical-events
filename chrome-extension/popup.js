// ============================================================
// Historical Events Research Assistant — Popup Script
// ============================================================

const WEB_APP_URL = 'https://historical-events-databse.netlify.app/';

// ─── Utility ──────────────────────────────────────────────────
function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, resp => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (resp && resp.error) return reject(new Error(resp.error));
      resolve(resp);
    });
  });
}

function $(id) { return document.getElementById(id); }

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  return Math.floor(diff / 3600000) + 'h ago';
}

function truncate(str, n) {
  if (!str) return '';
  return str.length <= n ? str : str.slice(0, n) + '…';
}

function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); }
  catch { return url; }
}

// ─── State ────────────────────────────────────────────────────
let state = {
  session: null,
  trail: [],
  capturedItems: [],
  sessionActive: false,
  sessionName: '',
  sessionPaused: false
};

// Video range capture state (for popup panel)
let vcStart = null;  // seconds
let vcEnd = null;    // seconds (optional)

let currentTab = 'captured';

// ─── Sessions history state ─────────────────────────────────────
let sessionHistory = [];
let expandedSessionId = null;
let sessionsFilter = { search: '', date: 'all', captures: 'any', pages: 'any', sort: 'newest' };
let confirmBackUpSessionId = null;

// ─── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Show extension version in footer
  try {
    const { version } = chrome.runtime.getManifest();
    $('ext-version-display').textContent = `HDB Research Extension  v${version}`;
  } catch(e) {}

  await loadState();
  bindEvents();
  await loadCurrentPageInfo();
});

async function loadState() {
  try {
    state = await send({ type: 'GET_STATE' });
  } catch (e) {
    console.error('Failed to load state:', e);
  }
  render();
}

// ─── Current page info ─────────────────────────────────────────
async function loadCurrentPageInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    $('page-title').textContent = truncate(tab.title || tab.url, 48);
    $('page-url').textContent = getDomain(tab.url || '');

    if (tab.favIconUrl) {
      const img = $('page-favicon');
      img.src = tab.favIconUrl;
      img.style.display = '';
      img.onerror = () => { img.style.display = 'none'; };
    }

    // Store tab info for capture-url button
    $('capture-url-btn').dataset.url = tab.url || '';
    $('capture-url-btn').dataset.title = tab.title || '';
    $('capture-url-btn').dataset.favicon = tab.favIconUrl || '';

    // Show video capture panel if on a video page
    const isVideo = tab.url && (
      tab.url.includes('youtube.com') ||
      tab.url.includes('youtu.be') ||
      tab.url.includes('vimeo.com') ||
      tab.url.includes('twitch.tv')
    );
    $('video-capture-panel').style.display = (isVideo && state.session) ? '' : 'none';
  } catch (e) {
    console.warn('Could not get current tab info:', e);
  }
}

// ─── Render ────────────────────────────────────────────────────
function render() {
  if (!state.session) {
    $('login-screen').style.display = '';
    $('main-screen').style.display = 'none';
  } else {
    $('login-screen').style.display = 'none';
    $('main-screen').style.display = '';
    renderHeader();
    renderSessionBar();
    renderCapturedItems();
    renderTrail();
  }
}

function renderHeader() {
  const u = state.session;
  $('header-user').textContent = `${u.username} · ${u.role}`;
  $('open-app-btn').href = WEB_APP_URL;
}

function renderSessionBar() {
  const dot = $('session-dot');
  const nameDisplay = $('session-name-display');
  const countDisplay = $('session-trail-count');
  const toggleBtn = $('session-toggle-btn');
  const renameBtn = $('rename-session-btn');
  const pauseBtn = $('session-pause-btn');

  if (state.sessionActive) {
    dot.classList.add('active');
    // Count only real pages (not pause/resume markers)
    const realPages = (state.trail || []).filter(e => e.type !== 'pause' && e.type !== 'resume');
    countDisplay.textContent = `${realPages.length} page${realPages.length !== 1 ? 's' : ''} visited`;
    countDisplay.style.display = '';
    toggleBtn.textContent = 'End';
    toggleBtn.className = 'btn-session-end';
    renameBtn.style.display = '';
    pauseBtn.style.display = '';

    if (state.sessionPaused) {
      dot.classList.add('paused');
      nameDisplay.textContent = '⏸ ' + (state.sessionName || 'Session paused');
      pauseBtn.textContent = '▶ Resume';
      pauseBtn.className = 'btn-session-resume';
      pauseBtn.title = 'Resume session — trail tracking will restart';
    } else {
      dot.classList.remove('paused');
      nameDisplay.textContent = state.sessionName || 'Active session';
      pauseBtn.textContent = '⏸';
      pauseBtn.className = 'btn-session-pause';
      pauseBtn.title = 'Pause session — stops tracking pages until resumed';
    }
  } else {
    dot.classList.remove('active');
    dot.classList.remove('paused');
    nameDisplay.textContent = 'No active session';
    countDisplay.style.display = 'none';
    toggleBtn.textContent = 'Start Session';
    toggleBtn.className = 'btn-session-start';
    renameBtn.style.display = 'none';
    pauseBtn.style.display = 'none';
  }
}

function renderCapturedItems() {
  const list = $('captured-list');
  const empty = $('captured-empty');
  const badge = $('captured-count-badge');
  const items = state.capturedItems || [];

  // Badge
  if (items.length > 0) {
    badge.textContent = items.length;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }

  // Empty state vs list
  if (items.length === 0) {
    empty.style.display = '';
    list.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  list.style.display = '';

  // Render in reverse-chronological order
  const sorted = [...items].reverse();
  list.innerHTML = sorted.map(item => renderCaptureCard(item)).join('');

  // Attach events
  list.querySelectorAll('.btn-save-db').forEach(btn => {
    btn.addEventListener('click', () => handleSaveToDb(btn.dataset.id));
  });
  list.querySelectorAll('.card-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteCapture(btn.dataset.id));
  });
}

function renderCaptureCard(item) {
  const typeIcon = item.type === 'video' ? '🎬' : item.type === 'url' ? '🔗' : '📝';

  const faviconHtml = item.favIconUrl
    ? `<img class="card-favicon" src="${escHtml(item.favIconUrl)}" alt="" onerror="this.style.display='none'" />`
    : '';

  const timecodeHtml = item.timecode
    ? `<span class="card-timecode">⏱ ${escHtml(item.timecode)}${item.timecodeEnd ? ' → ' + escHtml(item.timecodeEnd) : ''}</span>`
    : '';

  const framesHtml = item.frames && item.frames.length > 0
    ? `<div class="card-frames">
        ${item.frames.slice(0, 5).map(f =>
          `<img class="card-frame-thumb" src="${escHtml(f.dataUrl)}" alt="@${escHtml(f.timecode)}" title="Frame at ${escHtml(f.timecode)}" />`
        ).join('')}
        ${item.frames.length > 5 ? `<span class="card-frames-more">+${item.frames.length - 5} more</span>` : ''}
      </div>`
    : '';

  const savedHtml = item.saved
    ? `<div class="saved-badge">
        ✓ Saved
        <a href="${WEB_APP_URL}#account" target="_blank" title="View in Account → My Uploads">↗ My Uploads</a>
       </div>`
    : `<button class="btn-save-db" data-id="${escHtml(item.id)}">
        <span>Add to DB</span>
       </button>`;

  return `
    <div class="capture-card ${item.saved ? 'saved' : ''}" data-id="${escHtml(item.id)}">
      <div class="card-top">
        <span class="card-type-icon">${typeIcon}</span>
        <div class="card-text">${escHtml(item.text || item.url)}</div>
        <button class="card-delete-btn" data-id="${escHtml(item.id)}" title="Remove">✕</button>
      </div>
      <div class="card-meta">
        ${faviconHtml}
        <a class="card-source card-source-link" href="${escHtml(item.url)}" target="_blank" title="${escHtml(item.url)}">${escHtml(truncate(item.pageTitle || getDomain(item.url), 36))}</a>
        ${timecodeHtml}
      </div>
      ${framesHtml}
      <div class="card-footer">
        <span class="card-timestamp">${timeAgo(item.timestamp)}</span>
        ${savedHtml}
      </div>
    </div>
  `;
}

function renderTrail() {
  const list = $('trail-list');
  const empty = $('trail-empty');
  const badge = $('trail-count-badge');
  const clearBtn = $('clear-trail-btn');
  const trailHeader = document.querySelector('.trail-header');
  const trail = state.trail || [];

  if (trail.length > 0) {
    badge.textContent = trail.length;
    badge.style.display = '';
    clearBtn.style.display = '';
  } else {
    badge.style.display = 'none';
    clearBtn.style.display = 'none';
  }

  if (trail.length === 0) {
    empty.style.display = '';
    list.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  list.style.display = '';

  // Track which non-marker entry is "first" for the green dot
  const realEntries = trail.filter(e => e.type !== 'pause' && e.type !== 'resume');
  const firstRealId = realEntries[0]?.id;

  list.innerHTML = trail.map((entry, idx) => {
    // ── Pause marker ──
    if (entry.type === 'pause') {
      return `
        <div class="trail-pause-marker">
          <span>⏸</span>
          <span class="trail-marker-label">Session paused</span>
          <span class="trail-time">${timeAgo(entry.timestamp)}</span>
        </div>
      `;
    }
    // ── Resume marker ──
    if (entry.type === 'resume') {
      return `
        <div class="trail-resume-marker">
          <span>▶</span>
          <span class="trail-marker-label">Session resumed</span>
          <span class="trail-time">${timeAgo(entry.timestamp)}</span>
        </div>
      `;
    }

    // ── Regular trail entry ──
    const isFirst = entry.id === firstRealId;
    const isLast = idx === trail.length - 1;
    const faviconHtml = entry.favIconUrl
      ? `<img class="trail-favicon" src="${escHtml(entry.favIconUrl)}" alt="" onerror="this.style.display='none'" />`
      : `<div class="trail-favicon" style="background:rgba(96,165,250,0.1);border-radius:3px;"></div>`;

    const connectorHtml = isLast ? '' : '<div class="trail-connector"></div>';

    return `
      <div class="trail-entry">
        <div class="trail-line-col">
          <div class="trail-dot ${isFirst ? 'first' : ''}"></div>
          ${connectorHtml}
        </div>
        ${faviconHtml}
        <div class="trail-info">
          <a class="trail-title trail-title-link" href="${escHtml(entry.url)}" target="_blank" title="${escHtml(entry.url)}">${escHtml(truncate(entry.title || entry.url, 42))}</a>
          <div class="trail-url">${escHtml(getDomain(entry.url))}</div>
        </div>
        <div class="trail-time">${timeAgo(entry.timestamp)}</div>
      </div>
    `;
  }).join('');
}

// ─── Event Binding ─────────────────────────────────────────────
function bindEvents() {
  // Login
  $('login-btn').addEventListener('click', handleLogin);
  $('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });

  // Logout
  $('logout-btn').addEventListener('click', handleLogout);

  // Open app
  $('open-app-btn').setAttribute('href', WEB_APP_URL);

  // Capture current URL
  $('capture-url-btn').addEventListener('click', handleCaptureUrl);

  // Session toggle
  $('session-toggle-btn').addEventListener('click', handleSessionToggle);

  // Rename session
  $('rename-session-btn').addEventListener('click', () => {
    $('rename-row').style.display = '';
    $('rename-input').value = state.sessionName || '';
    $('rename-input').focus();
  });
  $('rename-confirm-btn').addEventListener('click', handleRenameSession);
  $('rename-cancel-btn').addEventListener('click', () => {
    $('rename-row').style.display = 'none';
  });
  $('rename-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleRenameSession();
    if (e.key === 'Escape') $('rename-row').style.display = 'none';
  });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      $('tab-' + currentTab).style.display = '';
      if (currentTab === 'sessions') loadSessions();
    });
  });

  // Sessions filter toggle
  $('sessions-filter-toggle').addEventListener('click', () => {
    const panel = $('sessions-filter-panel');
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : '';
    $('sessions-filter-toggle').classList.toggle('active', !open);
    $('sessions-filter-toggle').textContent = open ? '⚙ Filters' : '✕ Filters';
  });

  // Sessions keyword search
  $('sessions-search').addEventListener('input', () => {
    sessionsFilter.search = $('sessions-search').value;
    renderSessions();
  });

  // Filter pills (date / captures / pages)
  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const filterKey = btn.dataset.filter;
      const value = btn.dataset.value;
      sessionsFilter[filterKey] = value;
      document.querySelectorAll(`.filter-pill[data-filter="${filterKey}"]`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderSessions();
    });
  });

  // Sessions sort
  $('sessions-sort').addEventListener('change', () => {
    sessionsFilter.sort = $('sessions-sort').value;
    renderSessions();
  });

  // Pause / Resume session
  $('session-pause-btn').addEventListener('click', handlePauseResume);

  // Clear trail
  $('clear-trail-btn').addEventListener('click', handleClearTrail);

  // Video range capture panel
  $('vc-mark-start').addEventListener('click', handleVcMarkStart);
  $('vc-mark-end').addEventListener('click', handleVcMarkEnd);
  $('vc-capture-btn').addEventListener('click', handleVcCapture);
}

// ─── Handlers ──────────────────────────────────────────────────
async function handleLogin() {
  const username = $('login-username').value.trim();
  const password = $('login-password').value;
  const errorEl = $('login-error');
  const btn = $('login-btn');

  if (!username || !password) {
    showError(errorEl, 'Please enter username and password.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Logging in…';
  errorEl.style.display = 'none';

  try {
    const resp = await send({ type: 'LOGIN', username, password });
    state.session = resp.user;
    state.trail = [];
    state.capturedItems = [];
    state.sessionActive = false;
    state.sessionName = '';
    render();
    await loadCurrentPageInfo();
  } catch (e) {
    showError(errorEl, e.message || 'Login failed. Check your credentials.');
    btn.disabled = false;
    btn.textContent = 'Log In';
  }
}

async function handleLogout() {
  try {
    await send({ type: 'LOGOUT' });
    state = { session: null, trail: [], capturedItems: [], sessionActive: false, sessionName: '' };
    render();
  } catch (e) {
    console.error('Logout failed:', e);
  }
}

async function handleSessionToggle() {
  if (state.sessionActive) {
    // End session
    const btn = $('session-toggle-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await send({ type: 'END_SESSION' });
      state.sessionActive = false;
      state.sessionName = '';
      state.trail = [];
      renderSessionBar();
      renderTrail();
      renderCapturedItems();
    } catch (e) {
      console.error('End session failed:', e);
    } finally {
      btn.disabled = false;
      if (currentTab === 'sessions') loadSessions();
    }
  } else {
    // Start session
    try {
      const resp = await send({ type: 'START_SESSION' });
      state.sessionActive = true;
      state.sessionPaused = false;
      state.sessionName = resp.name;
      state.trail = [];
      state.capturedItems = [];
      renderSessionBar();
      renderCapturedItems();
      renderTrail();
      if (currentTab === 'sessions') renderSessions();
    } catch (e) {
      console.error('Start session failed:', e);
    }
  }
}

async function handleRenameSession() {
  const name = $('rename-input').value.trim();
  if (!name) return;
  try {
    await send({ type: 'RENAME_SESSION', name });
    state.sessionName = name;
    $('rename-row').style.display = 'none';
    renderSessionBar();
  } catch (e) {
    console.error('Rename failed:', e);
  }
}

async function handleCaptureUrl() {
  const btn = $('capture-url-btn');
  const url = btn.dataset.url;
  const title = btn.dataset.title;
  const favicon = btn.dataset.favicon;

  if (!url) return;

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const resp = await send({ type: 'CAPTURE_URL', url, pageTitle: title, favIconUrl: favicon });
    state.capturedItems = [...(state.capturedItems || []), resp.item];
    renderCapturedItems();

    btn.textContent = '✓ Saved';
    setTimeout(() => {
      btn.textContent = 'Save Page';
      btn.disabled = false;
    }, 1500);
  } catch (e) {
    console.error('Capture URL failed:', e);
    btn.textContent = 'Error';
    setTimeout(() => {
      btn.textContent = 'Save Page';
      btn.disabled = false;
    }, 2000);
  }
}

async function handleSaveToDb(itemId) {
  const card = document.querySelector(`.capture-card[data-id="${itemId}"]`);
  if (!card) return;

  const saveBtn = card.querySelector('.btn-save-db');
  if (!saveBtn) return;

  // Show loading state
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span><span>Saving…</span>';

  try {
    const resp = await send({ type: 'SAVE_TO_DB', id: itemId });

    // Update local state
    state.capturedItems = state.capturedItems.map(i =>
      i.id === itemId ? { ...i, saved: true, savedEventId: resp.eventId } : i
    );

    // Update card UI without full re-render
    const footer = card.querySelector('.card-footer');
    footer.querySelector('.btn-save-db').outerHTML = `
      <div class="saved-badge">
        ✓ Saved
        <a href="${WEB_APP_URL}#account" target="_blank" title="View in Account → My Uploads">↗ My Uploads</a>
      </div>
    `;
    card.classList.add('saved');

  } catch (e) {
    console.error('Save to DB failed:', e);
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<span>Retry</span>';
    saveBtn.title = e.message || 'Save failed';
  }
}

async function handleDeleteCapture(itemId) {
  try {
    await send({ type: 'DELETE_CAPTURED', id: itemId });
    state.capturedItems = state.capturedItems.filter(i => i.id !== itemId);
    renderCapturedItems();
  } catch (e) {
    console.error('Delete failed:', e);
  }
}

async function handlePauseResume() {
  const btn = $('session-pause-btn');
  btn.disabled = true;
  try {
    if (state.sessionPaused) {
      await send({ type: 'RESUME_SESSION' });
      state.sessionPaused = false;
    } else {
      await send({ type: 'PAUSE_SESSION' });
      state.sessionPaused = true;
    }
    // Refresh trail to show the pause/resume marker
    const fresh = await send({ type: 'GET_STATE' });
    state.trail = fresh.trail;
    state.sessionPaused = fresh.sessionPaused;
    renderSessionBar();
    renderTrail();
    if (currentTab === 'sessions') renderSessions();
  } catch(e) {
    console.error('Pause/resume failed:', e);
  } finally {
    btn.disabled = false;
  }
}

async function handleClearTrail() {
  try {
    await send({ type: 'CLEAR_TRAIL' });
    state.trail = [];
    renderTrail();
    renderSessionBar();
  } catch (e) {
    console.error('Clear trail failed:', e);
  }
}

// ─── Utilities ─────────────────────────────────────────────────
function showError(el, msg) {
  el.textContent = msg;
  el.style.display = '';
}

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Video Range Capture ────────────────────────────────────────
async function handleVcMarkStart() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_VIDEO_TIME' });
    if (resp && resp.timecode) {
      vcStart = resp.secs;
      $('vc-start-display').textContent = resp.timecode;
      $('vc-capture-btn').disabled = false;
    }
  } catch (e) {
    console.warn('[HDB] Could not get video time:', e);
  }
}

async function handleVcMarkEnd() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_VIDEO_TIME' });
    if (resp && resp.timecode) {
      vcEnd = resp.secs;
      $('vc-end-display').textContent = resp.timecode;
    }
  } catch (e) {
    console.warn('[HDB] Could not get video time:', e);
  }
}

async function handleVcCapture() {
  if (vcStart === null) return;

  const btn = $('vc-capture-btn');
  const status = $('vc-status');

  btn.disabled = true;
  btn.textContent = '⏳ Capturing…';
  status.style.display = '';
  status.textContent = 'Seeking and capturing frames…';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Ask content script to capture frames across the range
    const frameResp = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'CAPTURE_FRAMES_IN_RANGE',
        startSecs: vcStart,
        endSecs: vcEnd !== null ? vcEnd : vcStart
      }, resp => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(resp);
      });
    });

    const frames = frameResp?.frames || [];
    status.textContent = `Got ${frames.length} frame${frames.length !== 1 ? 's' : ''}… saving`;

    const startTc = $('vc-start-display').textContent;
    const endTc = $('vc-end-display').textContent;

    // Save as a captured item
    const result = await send({
      type: 'CAPTURE_TEXT',
      text: '',
      url: tab.url || '',
      pageTitle: tab.title || '',
      favIconUrl: tab.favIconUrl || '',
      timecode: startTc !== '—' ? startTc : null,
      timecodeEnd: (endTc !== '—' && endTc !== startTc) ? endTc : null,
      frames
    });

    state.capturedItems = [...(state.capturedItems || []), result.item];
    renderCapturedItems();

    // Reset panel
    vcStart = null;
    vcEnd = null;
    $('vc-start-display').textContent = '—';
    $('vc-end-display').textContent = '—';

    status.textContent = `✓ ${frames.length} frame${frames.length !== 1 ? 's' : ''} captured`;
    setTimeout(() => {
      status.style.display = 'none';
      btn.textContent = '📷 Capture Frames';
      btn.disabled = true;
    }, 2500);

  } catch (e) {
    console.error('[HDB] Video range capture failed:', e);
    status.textContent = 'Capture failed — try again';
    btn.textContent = '📷 Capture Frames';
    btn.disabled = vcStart === null;
  }
}

async function handleStartBackUp(sess) {
  try {
    const resp = await send({ type: 'START_BACK_UP', prevSession: sess });
    state.sessionActive = true;
    state.sessionPaused = false;
    state.sessionName = resp.name;
    state.trail = resp.trail || [];
    state.capturedItems = resp.capturedItems || [];
    renderSessionBar();
    renderCapturedItems();
    renderTrail();
    renderSessions();
    await loadCurrentPageInfo();
  } catch (e) {
    console.error('Start back up failed:', e);
  }
}

// ─── Sessions ──────────────────────────────────────────────────
async function loadSessions() {
  const hasData = sessionHistory.length > 0;
  if (!hasData) {
    $('sessions-loading').style.display = '';
    $('sessions-list').style.display = 'none';
    $('sessions-empty').style.display = 'none';
  }
  try {
    const resp = await send({ type: 'GET_SESSIONS' });
    sessionHistory = resp.sessions || [];
    renderSessions();
  } catch (e) {
    console.error('Failed to load sessions:', e);
    if (!hasData) {
      $('sessions-loading').style.display = 'none';
      $('sessions-empty').style.display = '';
    }
  }
}

function sessionRealPages(sess) {
  return (sess.trail || []).filter(e => e.type !== 'pause' && e.type !== 'resume').length;
}

function applySessionFilters(sessions) {
  let r = [...sessions];

  // Keyword search
  if (sessionsFilter.search) {
    const q = sessionsFilter.search.toLowerCase();
    r = r.filter(s =>
      (s.session_name || '').toLowerCase().includes(q) ||
      (s.trail || []).some(t =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.url || '').toLowerCase().includes(q)
      )
    );
  }

  // Date range
  const now = Date.now();
  if (sessionsFilter.date === 'today') {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    r = r.filter(s => new Date(s.ended_at) >= startOfDay);
  } else if (sessionsFilter.date === 'week') {
    r = r.filter(s => new Date(s.ended_at) >= new Date(now - 7 * 24 * 60 * 60 * 1000));
  } else if (sessionsFilter.date === 'month') {
    r = r.filter(s => new Date(s.ended_at) >= new Date(now - 30 * 24 * 60 * 60 * 1000));
  }

  // Captures filter
  if (sessionsFilter.captures === 'has') {
    r = r.filter(s => (s.captured_items || []).length > 0);
  } else if (sessionsFilter.captures === 'none') {
    r = r.filter(s => (s.captured_items || []).length === 0);
  }

  // Page count filter
  if (sessionsFilter.pages === '1-5') {
    r = r.filter(s => { const n = sessionRealPages(s); return n >= 1 && n <= 5; });
  } else if (sessionsFilter.pages === '6-20') {
    r = r.filter(s => { const n = sessionRealPages(s); return n >= 6 && n <= 20; });
  } else if (sessionsFilter.pages === '20+') {
    r = r.filter(s => sessionRealPages(s) > 20);
  }

  // Sort
  if (sessionsFilter.sort === 'oldest') {
    r.sort((a, b) => new Date(a.ended_at) - new Date(b.ended_at));
  } else if (sessionsFilter.sort === 'most-pages') {
    r.sort((a, b) => sessionRealPages(b) - sessionRealPages(a));
  } else if (sessionsFilter.sort === 'most-captures') {
    r.sort((a, b) => (b.captured_items || []).length - (a.captured_items || []).length);
  } else {
    r.sort((a, b) => new Date(b.ended_at) - new Date(a.ended_at));
  }

  return r;
}

function renderSessions() {
  const list = $('sessions-list');
  const empty = $('sessions-empty');
  const loading = $('sessions-loading');
  const badge = $('sessions-count-badge');

  loading.style.display = 'none';

  const filtered = applySessionFilters(sessionHistory);

  // Badge shows total unfiltered count
  const total = sessionHistory.length;
  badge.textContent = total;
  badge.style.display = total > 0 ? '' : 'none';

  const activeHtml = renderActiveSessionCard();

  if (!activeHtml && filtered.length === 0) {
    empty.style.display = '';
    list.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  list.style.display = '';
  list.innerHTML = activeHtml + filtered.map(s => renderSessionCard(s)).join('');

  // Bind expand/collapse for past session cards
  list.querySelectorAll('.session-card-header').forEach(header => {
    header.addEventListener('click', () => {
      const id = String(header.dataset.id);
      expandedSessionId = (expandedSessionId === id) ? null : id;
      renderSessions();
    });
  });

  // Active session: End button
  const endBtn = list.querySelector('#sessions-tab-end-btn');
  if (endBtn) {
    endBtn.addEventListener('click', async () => {
      endBtn.disabled = true;
      endBtn.textContent = '⏳ Ending…';
      await handleSessionToggle();
      loadSessions();
    });
  }

  // Active session: Pause/Resume button
  const pauseBtn = list.querySelector('#sessions-tab-pause-btn');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', async () => {
      pauseBtn.disabled = true;
      await handlePauseResume();
    });
  }

  // Past sessions: Continue button
  list.querySelectorAll('.btn-continue-session').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const sess = sessionHistory.find(s => String(s.id) === id);
      if (!sess) return;
      if (state.sessionActive) {
        confirmBackUpSessionId = (confirmBackUpSessionId === id) ? null : id;
        renderSessions();
      } else {
        handleStartBackUp(sess);
      }
    });
  });

  // Confirm: Yes — end current session and start back up
  list.querySelectorAll('.btn-confirm-continue').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const sess = sessionHistory.find(s => String(s.id) === id);
      if (!sess) return;
      btn.disabled = true;
      btn.textContent = 'Working…';
      try {
        await send({ type: 'END_SESSION' });
        state.sessionActive = false;
        state.sessionName = '';
        state.trail = [];
        state.capturedItems = [];
        renderSessionBar();
        renderTrail();
        renderCapturedItems();
        confirmBackUpSessionId = null;
        await handleStartBackUp(sess);
        loadSessions();
      } catch (err) {
        console.error('Continue session failed:', err);
        btn.disabled = false;
        btn.textContent = 'Yes, continue';
      }
    });
  });

  // Confirm: Cancel
  list.querySelectorAll('.btn-cancel-continue').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmBackUpSessionId = null;
      renderSessions();
    });
  });
}

function renderActiveSessionCard() {
  if (!state.sessionActive) return '';

  const realPages = (state.trail || []).filter(e => e.type !== 'pause' && e.type !== 'resume').length;
  const captures = (state.capturedItems || []).length;

  const statusLabel = state.sessionPaused ? '⏸ Paused' : '● Active';
  const statusClass = state.sessionPaused ? 'paused' : 'active';
  const pauseBtnLabel = state.sessionPaused ? '▶ Resume' : '⏸ Pause';
  const pauseBtnClass = state.sessionPaused ? 'btn-session-resume' : 'btn-session-pause';

  return `
    <div class="active-session-card">
      <div class="active-session-top">
        <span class="active-session-status ${statusClass}">${statusLabel}</span>
        <span class="active-session-name">${escHtml(state.sessionName || 'Active Session')}</span>
      </div>
      <div class="active-session-stats">
        ${realPages} page${realPages !== 1 ? 's' : ''} visited · ${captures} item${captures !== 1 ? 's' : ''} captured
      </div>
      <div class="active-session-actions">
        <button class="${pauseBtnClass} active-session-btn" id="sessions-tab-pause-btn">${pauseBtnLabel}</button>
        <button class="btn-session-end active-session-btn" id="sessions-tab-end-btn">⏹ End Session</button>
      </div>
    </div>
  `;
}

function renderSessionCard(sess) {
  const id = String(sess.id);
  const isExpanded = expandedSessionId === id;
  const isConfirming = confirmBackUpSessionId === id;
  const pages = sessionRealPages(sess);
  const captures = (sess.captured_items || []).length;

  const endDate = sess.ended_at ? new Date(sess.ended_at) : null;
  const startDate = sess.started_at ? new Date(sess.started_at) : null;

  const dateStr = endDate
    ? endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const timeStr = endDate
    ? endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';

  let durationStr = '';
  if (startDate && endDate) {
    const mins = Math.round((endDate - startDate) / 60000);
    durationStr = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  const expandIcon = isExpanded ? '▼' : '▶';
  const detailHtml = isExpanded ? renderSessionDetail(sess) : '';

  const confirmHtml = isConfirming ? `
    <div class="confirm-continue-bar">
      <span class="confirm-text">⚠ End current session to continue this one?</span>
      <div class="confirm-btns">
        <button class="btn-cancel-continue btn-ghost btn-sm" data-id="${escHtml(id)}">Cancel</button>
        <button class="btn-confirm-continue btn-primary btn-sm" data-id="${escHtml(id)}">Yes, continue</button>
      </div>
    </div>
  ` : '';

  return `
    <div class="session-card ${isExpanded ? 'expanded' : ''}${isConfirming ? ' confirming' : ''}">
      <div class="session-card-header" data-id="${escHtml(id)}">
        <span class="session-expand-icon">${expandIcon}</span>
        <div class="session-card-info">
          <div class="session-card-name">${escHtml(sess.session_name || 'Unnamed Session')}</div>
          <div class="session-card-meta">
            ${dateStr ? `<span>${escHtml(dateStr)}</span>` : ''}
            ${timeStr ? `<span>${escHtml(timeStr)}</span>` : ''}
            ${durationStr ? `<span class="session-duration">${escHtml(durationStr)}</span>` : ''}
          </div>
          <div class="session-card-bottom">
            <div class="session-card-stats">
              <span class="session-stat">${pages} page${pages !== 1 ? 's' : ''}</span>
              <span class="session-stat-dot">·</span>
              <span class="session-stat">${captures} capture${captures !== 1 ? 's' : ''}</span>
            </div>
            <button class="btn-continue-session" data-id="${escHtml(id)}" title="Pick up this session where you left off — old trail and captures are imported">↩ Continue</button>
          </div>
        </div>
      </div>
      ${confirmHtml}
      ${detailHtml}
    </div>
  `;
}

function renderSessionDetail(sess) {
  const trail = (sess.trail || []).filter(e => e.type !== 'pause' && e.type !== 'resume');
  const captured = sess.captured_items || [];

  let trailHtml = '';
  if (trail.length > 0) {
    trailHtml = `
      <div class="session-detail-section">
        <div class="session-detail-label">Trail <span class="session-detail-count">${trail.length}</span></div>
        <div class="session-trail-list">
          ${trail.map(entry => `
            <a class="session-trail-entry" href="${escHtml(entry.url)}" target="_blank" title="${escHtml(entry.url)}">
              ${entry.favIconUrl
                ? `<img class="session-trail-favicon" src="${escHtml(entry.favIconUrl)}" alt="" onerror="this.style.display='none'" />`
                : `<div class="session-trail-favicon-empty"></div>`}
              <div class="session-trail-info">
                <div class="session-trail-title">${escHtml(truncate(entry.title || entry.url, 40))}</div>
                <div class="session-trail-domain">${escHtml(getDomain(entry.url))}</div>
              </div>
              <div class="session-trail-time">${formatTime(entry.timestamp)}</div>
            </a>
          `).join('')}
        </div>
      </div>
    `;
  }

  let capturedHtml = '';
  if (captured.length > 0) {
    capturedHtml = `
      <div class="session-detail-section">
        <div class="session-detail-label">Captured <span class="session-detail-count">${captured.length}</span></div>
        <div class="session-captured-list">
          ${captured.map(item => {
            const typeIcon = item.type === 'video' ? '🎬' : item.type === 'url' ? '🔗' : '📝';
            return `
              <div class="session-captured-item">
                <span class="session-captured-icon">${typeIcon}</span>
                <div class="session-captured-body">
                  <div class="session-captured-text">${escHtml(truncate(item.text || item.pageTitle || item.url, 52))}</div>
                  <a class="session-captured-source" href="${escHtml(item.url)}" target="_blank">${escHtml(getDomain(item.url))}</a>
                </div>
                ${item.saved ? `<span class="session-saved-tag">✓</span>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  if (!trailHtml && !capturedHtml) {
    return '<div class="session-detail-empty">No data recorded for this session.</div>';
  }

  return `<div class="session-detail">${trailHtml}${capturedHtml}</div>`;
}

// ─── Auto-refresh state when popup is open ─────────────────────
// Refresh state every 3 seconds while popup is open (for trail updates)
let refreshInterval = setInterval(async () => {
  if (!state.session) return;
  try {
    const fresh = await send({ type: 'GET_STATE' });
    const trailChanged = JSON.stringify(fresh.trail) !== JSON.stringify(state.trail);
    const itemsChanged = JSON.stringify(fresh.capturedItems) !== JSON.stringify(state.capturedItems);
    const sessionStatusChanged = fresh.sessionActive !== state.sessionActive || fresh.sessionPaused !== state.sessionPaused;
    state = fresh;
    if (trailChanged) {
      renderTrail();
      if (state.sessionActive) renderSessionBar();
    }
    if (itemsChanged) renderCapturedItems();
    if (currentTab === 'sessions' && (trailChanged || itemsChanged || sessionStatusChanged)) {
      renderSessions();
    }
  } catch {}
}, 3000);

// Clean up interval when popup closes (best effort)
window.addEventListener('unload', () => clearInterval(refreshInterval));
