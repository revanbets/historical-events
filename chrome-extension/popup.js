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
  sessionName: ''
};

let currentTab = 'captured';

// ─── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
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

  if (state.sessionActive) {
    dot.classList.add('active');
    nameDisplay.textContent = state.sessionName || 'Active session';
    const pagesCount = state.trail.length;
    countDisplay.textContent = `${pagesCount} page${pagesCount !== 1 ? 's' : ''} visited`;
    countDisplay.style.display = '';
    toggleBtn.textContent = 'End Session';
    toggleBtn.className = 'btn-session-end';
    renameBtn.style.display = '';
  } else {
    dot.classList.remove('active');
    nameDisplay.textContent = 'No active session';
    countDisplay.style.display = 'none';
    toggleBtn.textContent = 'Start Session';
    toggleBtn.className = 'btn-session-start';
    renameBtn.style.display = 'none';
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
    ? `<span class="card-timecode">⏱ ${escHtml(item.timecode)}</span>`
    : '';

  const savedHtml = item.saved
    ? `<div class="saved-badge">
        ✓ Saved
        <a href="${WEB_APP_URL}" target="_blank" title="Open database">↗ View</a>
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
        <span class="card-source" title="${escHtml(item.url)}">${escHtml(truncate(item.pageTitle || getDomain(item.url), 36))}</span>
        ${timecodeHtml}
      </div>
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

  list.innerHTML = trail.map((entry, idx) => {
    const isFirst = idx === 0;
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
          <div class="trail-title" title="${escHtml(entry.url)}">${escHtml(truncate(entry.title || entry.url, 42))}</div>
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
    });
  });

  // Clear trail
  $('clear-trail-btn').addEventListener('click', handleClearTrail);
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
    }
  } else {
    // Start session
    try {
      const resp = await send({ type: 'START_SESSION' });
      state.sessionActive = true;
      state.sessionName = resp.name;
      state.trail = [];
      state.capturedItems = [];
      renderSessionBar();
      renderCapturedItems();
      renderTrail();
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
  saveBtn.innerHTML = '<span class="spinner"></span><span>Analyzing…</span>';

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
        <a href="${WEB_APP_URL}" target="_blank" title="Open database">↗ View</a>
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

// ─── Auto-refresh state when popup is open ─────────────────────
// Refresh state every 3 seconds while popup is open (for trail updates)
let refreshInterval = setInterval(async () => {
  if (!state.session) return;
  try {
    const fresh = await send({ type: 'GET_STATE' });
    const trailChanged = JSON.stringify(fresh.trail) !== JSON.stringify(state.trail);
    const itemsChanged = JSON.stringify(fresh.capturedItems) !== JSON.stringify(state.capturedItems);
    state = fresh;
    if (trailChanged) {
      renderTrail();
      if (state.sessionActive) renderSessionBar();
    }
    if (itemsChanged) renderCapturedItems();
  } catch {}
}, 3000);

// Clean up interval when popup closes (best effort)
window.addEventListener('unload', () => clearInterval(refreshInterval));
