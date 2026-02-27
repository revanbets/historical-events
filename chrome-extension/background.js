// ============================================================
// Historical Events Research Assistant — Background Service Worker
// ============================================================

const SUPABASE_URL = 'https://dfkxdbkjrfarjudlpqbw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRma3hkYmtqcmZhcmp1ZGxwcWJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NDQzMzIsImV4cCI6MjA4NzUyMDMzMn0.A5XuY5C9X5Il6EizS84tKY1Ls3Jyl6Xmi0hKbqQg2qo';
const API_BASE = 'https://historical-events-api-n45u.onrender.com';
const WEB_APP_URL = 'https://historical-events-databse.netlify.app/';

// ─── Supabase REST helpers ────────────────────────────────────
async function sbFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation',
    ...options.headers
  };
  const resp = await fetch(url, { ...options, headers });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase error ${resp.status}: ${text}`);
  }
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

// ─── Auth ─────────────────────────────────────────────────────
async function loginUser(username, password) {
  const rows = await sbFetch(
    `/users?username=eq.${encodeURIComponent(username.toLowerCase())}&password=eq.${encodeURIComponent(password)}&select=username,role`,
    { method: 'GET' }
  );
  if (!rows || rows.length === 0) throw new Error('Invalid credentials');
  return { username: rows[0].username, role: rows[0].role };
}

// ─── Storage helpers ──────────────────────────────────────────
async function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}
async function setStorage(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}
async function getSession() {
  const { hdb_ext_session } = await getStorage(['hdb_ext_session']);
  return hdb_ext_session || null;
}

// ─── ID generation ────────────────────────────────────────────
function randomHex(n) {
  const arr = new Uint8Array(n / 2);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}
function generateEventId() {
  return 'EVT-' + randomHex(8);
}
function generateCaptureId() {
  return 'CAP-' + randomHex(6);
}

// ─── Session name generator ───────────────────────────────────
function generateSessionName() {
  const now = new Date();
  const opts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  return 'Session — ' + now.toLocaleString('en-US', opts);
}

// ─── Navigation tracking ──────────────────────────────────────
// Track tab URL changes to build the research trail
let lastUrlByTab = {}; // tabId → last url

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

  const { hdb_session_active, hdb_session_paused } = await getStorage(['hdb_session_active', 'hdb_session_paused']);
  if (!hdb_session_active || hdb_session_paused) return; // skip if no session or session is paused

  const fromUrl = lastUrlByTab[tabId] || null;
  lastUrlByTab[tabId] = tab.url;

  const { hdb_current_trail = [] } = await getStorage(['hdb_current_trail']);

  // Don't duplicate the same URL back-to-back in trail
  const last = hdb_current_trail[hdb_current_trail.length - 1];
  if (last && last.url === tab.url) return;

  const entry = {
    id: generateCaptureId(),
    url: tab.url,
    title: tab.title || tab.url,
    favIconUrl: tab.favIconUrl || '',
    timestamp: new Date().toISOString(),
    fromUrl
  };

  await setStorage({ hdb_current_trail: [...hdb_current_trail, entry] });
});

// ─── Event object builder ─────────────────────────────────────
function buildEventObject(captured, aiData, session) {
  const isVideo = captured.url && (
    captured.url.includes('youtube.com') ||
    captured.url.includes('youtu.be') ||
    captured.url.includes('vimeo.com')
  );

  // Use first line of captured text as title, or page title
  let title = captured.pageTitle || 'Captured from ' + (captured.url || 'extension');
  if (captured.text) {
    const firstLine = captured.text.split('\n')[0].trim().slice(0, 120);
    if (firstLine.length > 10) title = firstLine;
  }

  if (aiData && aiData.title) title = aiData.title;

  return {
    id: generateEventId(),
    title,
    description: captured.text || aiData?.description || '',
    date: '',
    date_uploaded: new Date().toISOString(),
    topics: aiData?.topics || [],
    people: aiData?.people || [],
    organizations: aiData?.organizations || [],
    links: captured.url ? [captured.url] : [],
    research_level: 2,
    source_type: 'Extension Capture',
    source: captured.pageTitle || '',
    primary_source: '',
    source_sheet: '',
    main_link: captured.url || '',
    connections: [],
    ai_summary: aiData?.summary || '',
    is_major_event: false,
    uploaded_by: session.username,
    is_public: true,
    event_status: 'unverified',
    backend_id: aiData?.id || null,
    ai_analyzed: !!aiData,
    analysis_mode: aiData ? 'url' : null,
    has_frames: aiData?.has_frames || false,
    visual_content: '',
    frames_data: aiData?.frames || [],
    transcript_file: aiData?.transcript_file || null,
    attachments: [],
    backend_file_name: null,
    is_video: isVideo,
    transcription: captured.timecode
      ? { timecode: captured.timecode, url: captured.url }
      : null
  };
}

// ─── Save event to Supabase ───────────────────────────────────
async function saveEventToSupabase(eventObj) {
  const result = await sbFetch('/events', {
    method: 'POST',
    prefer: 'return=representation',
    body: JSON.stringify(eventObj)
  });
  return result?.[0] || result;
}

// ─── AI Analysis via backend ──────────────────────────────────
async function analyzeWithBackend(url, searchFocus) {
  const body = {
    url,
    mode: 'full',
    skip_frames: true,
    skip_analysis: false,
    search_focus: searchFocus || ''
  };
  const resp = await fetch(`${API_BASE}/api/analyze-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error(`Backend error ${resp.status}`);
  const data = await resp.json();
  return data.record || data;
}

// ─── Message handler ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch(err => {
    console.error('[HDB Extension] Error:', err);
    sendResponse({ error: err.message });
  });
  return true; // async response
});

async function handleMessage(msg, sender) {
  switch (msg.type) {

    case 'GET_STATE': {
      const data = await getStorage([
        'hdb_ext_session',
        'hdb_current_trail',
        'hdb_captured_items',
        'hdb_session_active',
        'hdb_session_name',
        'hdb_session_paused'
      ]);
      return {
        session: data.hdb_ext_session || null,
        trail: data.hdb_current_trail || [],
        capturedItems: data.hdb_captured_items || [],
        sessionActive: data.hdb_session_active || false,
        sessionName: data.hdb_session_name || '',
        sessionPaused: data.hdb_session_paused || false
      };
    }

    case 'LOGIN': {
      const { username, password } = msg;
      const user = await loginUser(username, password);
      await setStorage({ hdb_ext_session: user });
      return { ok: true, user };
    }

    case 'LOGOUT': {
      await setStorage({
        hdb_ext_session: null,
        hdb_session_active: false,
        hdb_session_paused: false,
        hdb_session_name: '',
        hdb_current_trail: [],
        hdb_captured_items: []
      });
      lastUrlByTab = {};
      return { ok: true };
    }

    case 'START_SESSION': {
      const name = msg.name || generateSessionName();
      await setStorage({
        hdb_session_active: true,
        hdb_session_paused: false,
        hdb_session_name: name,
        hdb_current_trail: [],
        hdb_captured_items: []
      });
      lastUrlByTab = {};
      return { ok: true, name };
    }

    case 'RENAME_SESSION': {
      await setStorage({ hdb_session_name: msg.name });
      return { ok: true };
    }

    case 'END_SESSION': {
      const session = await getSession();
      if (!session) throw new Error('Not logged in');

      const { hdb_current_trail = [], hdb_captured_items = [], hdb_session_name } = await getStorage([
        'hdb_current_trail', 'hdb_captured_items', 'hdb_session_name'
      ]);

      // Save to Supabase research_sessions table
      const sessionRecord = {
        session_name: hdb_session_name || generateSessionName(),
        uploaded_by: session.username,
        started_at: hdb_current_trail[0]?.timestamp || new Date().toISOString(),
        ended_at: new Date().toISOString(),
        trail: hdb_current_trail,
        captured_items: hdb_captured_items
      };

      let savedSession = null;
      try {
        savedSession = await sbFetch('/research_sessions', {
          method: 'POST',
          prefer: 'return=representation',
          body: JSON.stringify(sessionRecord)
        });
      } catch (e) {
        console.warn('[HDB] Could not save session to Supabase (table may not exist yet):', e.message);
      }

      await setStorage({
        hdb_session_active: false,
        hdb_session_paused: false,
        hdb_session_name: '',
        hdb_current_trail: [],
        hdb_captured_items: []
      });
      lastUrlByTab = {};

      return { ok: true, savedSession };
    }

    case 'CAPTURE_TEXT': {
      const { hdb_captured_items = [] } = await getStorage(['hdb_captured_items']);
      const item = {
        id: generateCaptureId(),
        type: msg.timecode ? 'video' : 'text',
        text: msg.text || '',
        url: msg.url || '',
        pageTitle: msg.pageTitle || '',
        favIconUrl: msg.favIconUrl || '',
        timecode: msg.timecode || null,
        timestamp: new Date().toISOString(),
        saved: false,
        savedEventId: null
      };
      await setStorage({ hdb_captured_items: [...hdb_captured_items, item] });
      return { ok: true, item };
    }

    case 'CAPTURE_URL': {
      const { hdb_captured_items = [] } = await getStorage(['hdb_captured_items']);
      const item = {
        id: generateCaptureId(),
        type: 'url',
        text: msg.pageTitle || msg.url,
        url: msg.url || '',
        pageTitle: msg.pageTitle || '',
        favIconUrl: msg.favIconUrl || '',
        timecode: null,
        timestamp: new Date().toISOString(),
        saved: false,
        savedEventId: null
      };
      await setStorage({ hdb_captured_items: [...hdb_captured_items, item] });
      return { ok: true, item };
    }

    case 'DELETE_CAPTURED': {
      const { hdb_captured_items = [] } = await getStorage(['hdb_captured_items']);
      const updated = hdb_captured_items.filter(i => i.id !== msg.id);
      await setStorage({ hdb_captured_items: updated });
      return { ok: true };
    }

    case 'SAVE_TO_DB': {
      const session = await getSession();
      if (!session) throw new Error('Not logged in');

      const { hdb_captured_items = [] } = await getStorage(['hdb_captured_items']);
      const captured = hdb_captured_items.find(i => i.id === msg.id);
      if (!captured) throw new Error('Capture item not found');

      // Fast metadata-only save — no AI analysis.
      // Use "Save Session to DB" in the companion app for full AI analysis of a whole session.
      const eventObj = buildEventObject(captured, null, session);
      const saved = await saveEventToSupabase(eventObj);

      // Mark item as saved
      const updated = hdb_captured_items.map(i =>
        i.id === msg.id
          ? { ...i, saved: true, savedEventId: eventObj.id }
          : i
      );
      await setStorage({ hdb_captured_items: updated });

      return { ok: true, eventId: eventObj.id, event: saved };
    }

    case 'PAUSE_SESSION': {
      const { hdb_session_active, hdb_current_trail: trail1 = [] } = await getStorage(['hdb_session_active', 'hdb_current_trail']);
      if (!hdb_session_active) throw new Error('No active session to pause');
      const pauseMarker = {
        id: generateCaptureId(),
        type: 'pause',
        url: null,
        title: 'Session paused',
        favIconUrl: '',
        timestamp: new Date().toISOString()
      };
      await setStorage({ hdb_session_paused: true, hdb_current_trail: [...trail1, pauseMarker] });
      return { ok: true };
    }

    case 'RESUME_SESSION': {
      const { hdb_current_trail: trail2 = [] } = await getStorage(['hdb_current_trail']);
      const resumeMarker = {
        id: generateCaptureId(),
        type: 'resume',
        url: null,
        title: 'Session resumed',
        favIconUrl: '',
        timestamp: new Date().toISOString()
      };
      await setStorage({ hdb_session_paused: false, hdb_current_trail: [...trail2, resumeMarker] });
      lastUrlByTab = {}; // reset so next page visited is freshly added
      return { ok: true };
    }

    case 'CLEAR_TRAIL': {
      await setStorage({ hdb_current_trail: [] });
      lastUrlByTab = {};
      return { ok: true };
    }

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}

// ─── Context menu: "Save to Historical Events DB" ─────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'hdb-save-selection',
    title: 'Save to Historical Events DB',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'hdb-save-page',
    title: 'Save Page to Historical Events DB',
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const session = await getSession();
  if (!session) {
    // Notify user to log in
    chrome.action.openPopup?.();
    return;
  }

  if (info.menuItemId === 'hdb-save-selection' && info.selectionText) {
    await handleMessage({
      type: 'CAPTURE_TEXT',
      text: info.selectionText,
      url: tab.url,
      pageTitle: tab.title,
      favIconUrl: tab.favIconUrl
    }, { tab });
  } else if (info.menuItemId === 'hdb-save-page') {
    await handleMessage({
      type: 'CAPTURE_URL',
      url: tab.url,
      pageTitle: tab.title,
      favIconUrl: tab.favIconUrl
    }, { tab });
  }
});
